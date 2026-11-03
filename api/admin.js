import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import { requireAdmin, createResetToken } from "../lib/auth.js";
import { getCatalog, ALL_IDS } from "../lib/catalog.js";
import { normalizeCode, publicCoupon, couponUsageDelta } from "../lib/coupons.js";
import { orderFields } from "../lib/orders.js";
import { getDelivery, cleanDelivery } from "../lib/settings.js";

const STATUSES = new Set(["pendiente", "confirmado", "enviado", "entregado", "cancelado"]);
const num = (v) => Number(v ?? 0);

// GET /api/admin?view=stats|orders|users|products
export const GET = handle(async (request) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  const db = await getDb();

  if (view === "stats") {
    const [totals, daily, top] = await db.batch([
      `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-30 days')) AS new_users,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM orders WHERE status = 'pendiente') AS pending,
        (SELECT COUNT(*) FROM orders WHERE status != 'cancelado') AS valid_orders,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'cancelado') AS revenue,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'cancelado' AND created_at >= datetime('now', '-30 days')) AS revenue30`,
      `SELECT date(created_at) AS day, SUM(total) AS total, COUNT(*) AS orders
        FROM orders WHERE status != 'cancelado' AND created_at >= date('now', '-13 days')
        GROUP BY day ORDER BY day`,
      `SELECT i.product_id, i.name, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS revenue
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.status != 'cancelado'
        GROUP BY i.product_id ORDER BY qty DESC LIMIT 5`,
    ], "read");
    const t = totals.rows[0];
    return json({
      stats: {
        users: num(t.users), newUsers: num(t.new_users), orders: num(t.orders), pending: num(t.pending),
        revenue: num(t.revenue), revenue30: num(t.revenue30),
        avgTicket: num(t.valid_orders) ? Math.round(num(t.revenue) / num(t.valid_orders)) : 0,
      },
      daily: daily.rows.map((r) => ({ day: r.day, total: num(r.total), orders: num(r.orders) })),
      top: top.rows.map((r) => ({ productId: r.product_id, name: r.name, qty: num(r.qty), revenue: num(r.revenue) })),
    });
  }

  if (view === "orders") {
    const status = STATUSES.has(params.get("status")) ? params.get("status") : "";
    const q = str(params.get("q"), 80);
    const idMatch = /^#?(hz-?)?0*(\d+)$/i.exec(q);
    const { rows } = await db.execute({
      sql: `SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id
            WHERE (:status = '' OR o.status = :status)
              AND (:q = '' OR o.id = :id OR u.email LIKE :like OR o.ship_name LIKE :like OR o.ship_phone LIKE :like)
            ORDER BY o.id DESC LIMIT 200`,
      args: { status, q, id: idMatch ? Number(idMatch[2]) : -1, like: `%${q}%` },
    });
    const ids = rows.map((o) => Number(o.id));
    const items = ids.length
      ? (await db.execute({ sql: `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, args: ids })).rows
      : [];
    return json({
      orders: rows.map((o) => ({
        ...orderFields(o),
        email: o.email,
        items: items.filter((i) => Number(i.order_id) === Number(o.id))
          .map((i) => ({ productId: i.product_id, name: i.name, price: num(i.price), qty: num(i.qty) })),
      })),
    });
  }

  if (view === "users") {
    const q = str(params.get("q"), 80);
    const { rows } = await db.execute({
      sql: `SELECT u.id, u.email, u.name, u.phone, u.city, u.province, u.goal, u.newsletter, u.role, u.created_at,
              COUNT(o.id) AS orders,
              COALESCE(SUM(CASE WHEN o.status != 'cancelado' THEN o.total END), 0) AS spent,
              MAX(o.created_at) AS last_order
            FROM users u LEFT JOIN orders o ON o.user_id = u.id
            WHERE (:q = '' OR u.email LIKE :like OR u.name LIKE :like OR u.phone LIKE :like)
            GROUP BY u.id ORDER BY u.id DESC LIMIT 500`,
      args: { q, like: `%${q}%` },
    });
    return json({
      users: rows.map((u) => ({
        id: Number(u.id), email: u.email, name: u.name, phone: u.phone, city: u.city, province: u.province,
        goal: u.goal, newsletter: Boolean(u.newsletter), role: u.role, createdAt: u.created_at,
        orders: num(u.orders), spent: num(u.spent), lastOrder: u.last_order,
      })),
    });
  }

  if (view === "products") {
    const [{ products, combos }, sold] = await Promise.all([
      getCatalog({ includeHidden: true }),
      db.execute(`SELECT i.product_id, SUM(i.qty) AS qty FROM order_items i JOIN orders o ON o.id = i.order_id
                  WHERE o.status != 'cancelado' GROUP BY i.product_id`),
    ]);
    const soldBy = new Map(sold.rows.map((r) => [r.product_id, num(r.qty)]));
    const withSold = (p) => ({ ...p, sold: soldBy.get(p.id) || 0 });
    return json({ products: products.map(withSold), combos: combos.map(withSold) });
  }

  if (view === "delivery") return json({ delivery: await getDelivery(db) });

  if (view === "coupons") {
    const { rows } = await db.execute(`
      SELECT c.*, COALESCE(SUM(CASE WHEN o.status != 'cancelado' THEN o.discount END), 0) AS discounted
      FROM coupons c LEFT JOIN orders o ON o.coupon_code = c.code
      GROUP BY c.code ORDER BY c.created_at DESC`);
    return json({ coupons: rows.map((r) => ({ ...publicCoupon(r), discounted: num(r.discounted) })) });
  }

  throw new HttpError(400, "Vista desconocida");
});

// POST /api/admin { action, ... }
export const POST = handle(async (request) => {
  const admin = await requireAdmin(request);
  const body = await readJson(request);
  const db = await getDb();

  switch (body.action) {
    case "order-status": {
      if (!STATUSES.has(body.status)) throw new HttpError(400, "Estado inválido");
      const { rows } = await db.execute({ sql: "SELECT status, coupon_code FROM orders WHERE id = ?", args: [Number(body.id)] });
      if (!rows[0]) throw new HttpError(404, "Pedido no encontrado");
      // Cancelar devuelve el uso del cupón; reactivar lo vuelve a contar
      const wasCancelled = rows[0].status === "cancelado";
      const isCancelled = body.status === "cancelado";
      await db.batch([
        { sql: "UPDATE orders SET status = ? WHERE id = ?", args: [body.status, Number(body.id)] },
        wasCancelled !== isCancelled ? couponUsageDelta(rows[0].coupon_code, isCancelled ? -1 : 1) : null,
      ].filter(Boolean), "write");
      return json({ ok: true });
    }

    case "user-role": {
      if (!["admin", "customer"].includes(body.role)) throw new HttpError(400, "Rol inválido");
      if (Number(body.id) === admin.id) throw new HttpError(400, "No podés cambiar tu propio rol");
      const { rowsAffected } = await db.execute({ sql: "UPDATE users SET role = ? WHERE id = ?", args: [body.role, Number(body.id)] });
      if (!rowsAffected) throw new HttpError(404, "Usuario no encontrado");
      return json({ ok: true });
    }

    case "product": {
      if (!ALL_IDS.has(body.id)) throw new HttpError(400, "Producto inválido");
      const price = Math.round(Number(body.price));
      const old = body.old === "" || body.old == null ? null : Math.round(Number(body.old));
      if (!(price > 0 && price < 100_000_000)) throw new HttpError(400, "Precio inválido");
      if (old !== null && !(old > price)) throw new HttpError(400, "El precio anterior tiene que ser mayor al actual");
      await db.execute({
        sql: `INSERT INTO product_overrides (product_id, price, old_price, active, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(product_id) DO UPDATE SET price = excluded.price, old_price = excluded.old_price,
                active = excluded.active, updated_at = excluded.updated_at`,
        args: [body.id, price, old, body.active ? 1 : 0],
      });
      return json({ ok: true });
    }

    case "product-reset": {
      await db.execute({ sql: "DELETE FROM product_overrides WHERE product_id = ?", args: [String(body.id)] });
      return json({ ok: true });
    }

    case "coupon-save": {
      const code = normalizeCode(body.code);
      if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new HttpError(400, "El código debe tener 3 a 30 letras o números, sin espacios");
      if (!["percent", "fixed"].includes(body.type)) throw new HttpError(400, "Tipo de descuento inválido");
      const value = Math.round(Number(body.value));
      if (body.type === "percent" && !(value >= 1 && value <= 100)) throw new HttpError(400, "El porcentaje tiene que estar entre 1 y 100");
      if (body.type === "fixed" && !(value >= 1 && value < 100_000_000)) throw new HttpError(400, "Monto de descuento inválido");
      const minTotal = Math.max(0, Math.round(Number(body.minTotal) || 0));
      const maxUses = body.maxUses === "" || body.maxUses == null ? null : Math.round(Number(body.maxUses));
      if (maxUses !== null && !(maxUses >= 1)) throw new HttpError(400, "El límite de usos tiene que ser 1 o más");
      const expiresAt = body.expiresAt ? String(body.expiresAt).slice(0, 10) : null;
      if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new HttpError(400, "Fecha de vencimiento inválida");
      const args = [body.type, value, minTotal, maxUses, body.oncePerUser ? 1 : 0, expiresAt, body.active === false ? 0 : 1, code];
      if (body.isNew) {
        const exists = await db.execute({ sql: "SELECT 1 FROM coupons WHERE code = ?", args: [code] });
        if (exists.rows.length) throw new HttpError(409, "Ya existe un cupón con ese código");
        await db.execute({
          sql: "INSERT INTO coupons (type, value, min_total, max_uses, once_per_user, expires_at, active, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          args,
        });
      } else {
        const { rowsAffected } = await db.execute({
          sql: "UPDATE coupons SET type = ?, value = ?, min_total = ?, max_uses = ?, once_per_user = ?, expires_at = ?, active = ? WHERE code = ?",
          args,
        });
        if (!rowsAffected) throw new HttpError(404, "Cupón no encontrado");
      }
      return json({ ok: true });
    }

    case "delivery-save": {
      const delivery = cleanDelivery(body.delivery || {});
      await db.execute({
        sql: `INSERT INTO settings (key, value, updated_at) VALUES ('delivery', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        args: [JSON.stringify(delivery)],
      });
      return json({ delivery });
    }

    case "coupon-delete": {
      // Los pedidos conservan el código usado; solo se borra la definición del cupón
      await db.execute({ sql: "DELETE FROM coupons WHERE code = ?", args: [normalizeCode(body.code)] });
      return json({ ok: true });
    }

    case "reset-link": {
      const { rows } = await db.execute({ sql: "SELECT id, name, phone FROM users WHERE id = ?", args: [Number(body.id)] });
      if (!rows[0]) throw new HttpError(404, "Usuario no encontrado");
      const { token, expiresAt } = await createResetToken(Number(rows[0].id));
      const url = `${new URL(request.url).origin}/restablecer.html#${token}`;
      return json({ url, expiresAt, name: rows[0].name, phone: rows[0].phone });
    }

    default:
      throw new HttpError(400, "Acción desconocida");
  }
});

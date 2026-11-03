import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { getCatalog, ALL_IDS } from "../lib/catalog.js";

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
        id: Number(o.id), status: o.status, total: num(o.total), notes: o.notes, email: o.email,
        shipName: o.ship_name, shipPhone: o.ship_phone, shipAddress: o.ship_address, createdAt: o.created_at,
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
      const { rowsAffected } = await db.execute({ sql: "UPDATE orders SET status = ? WHERE id = ?", args: [body.status, Number(body.id)] });
      if (!rowsAffected) throw new HttpError(404, "Pedido no encontrado");
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

    default:
      throw new HttpError(400, "Acción desconocida");
  }
});

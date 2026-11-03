import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { buildLines } from "../lib/catalog.js";
import { validateCoupon, couponUsageDelta } from "../lib/coupons.js";

function shippingAddress(u) {
  return [u.address, u.city, u.province, u.zip && `CP ${u.zip}`].filter(Boolean).join(", ");
}

// GET /api/orders → historial de pedidos con sus productos
export const GET = handle(async (request) => {
  const user = await requireUser(request);
  const db = await getDb();
  const [orders, items] = await db.batch([
    { sql: "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", args: [user.id] },
    {
      sql: `SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id
            WHERE o.user_id = ? ORDER BY i.id`,
      args: [user.id],
    },
  ], "read");

  const byOrder = new Map();
  for (const i of items.rows) {
    const list = byOrder.get(Number(i.order_id)) || [];
    list.push({ productId: i.product_id, name: i.name, price: Number(i.price), qty: Number(i.qty) });
    byOrder.set(Number(i.order_id), list);
  }
  return json({
    orders: orders.rows.map((o) => ({
      id: Number(o.id),
      status: o.status,
      total: Number(o.total),
      discount: Number(o.discount),
      couponCode: o.coupon_code,
      notes: o.notes,
      shipName: o.ship_name,
      shipPhone: o.ship_phone,
      shipAddress: o.ship_address,
      createdAt: o.created_at,
      items: byOrder.get(Number(o.id)) || [],
    })),
  });
});

// POST /api/orders { items: [{ id, qty }], notes, coupon } → registra el pedido con precios del servidor
export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  const { lines, subtotal } = await buildLines(body.items);

  const db = await getDb();
  let coupon = null;
  let discount = 0;
  if (body.coupon) ({ coupon, discount } = await validateCoupon(db, user.id, body.coupon, subtotal));
  const total = subtotal - discount;

  // Un solo batch = una transacción atómica: pedido, ítems y uso del cupón se guardan juntos o nada.
  const [created] = await db.batch([
    {
      sql: `INSERT INTO orders (user_id, total, discount, coupon_code, notes, ship_name, ship_phone, ship_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, status, created_at`,
      args: [user.id, total, discount, coupon?.code || "", str(body.notes, 500), user.name, user.phone, shippingAddress(user)],
    },
    ...lines.map((l) => ({
      sql: `INSERT INTO order_items (order_id, product_id, name, price, qty)
            VALUES ((SELECT MAX(id) FROM orders WHERE user_id = ?), ?, ?, ?, ?)`,
      args: [user.id, l.id, l.name, l.price, l.qty],
    })),
    ...(coupon ? [couponUsageDelta(coupon.code, 1)] : []),
  ], "write");

  const row = created.rows[0];
  return json({
    order: {
      id: Number(row.id), status: row.status, total, subtotal, discount, couponCode: coupon?.code || "",
      createdAt: row.created_at, shipName: user.name, shipPhone: user.phone, shipAddress: shippingAddress(user),
      items: lines.map((l) => ({ productId: l.id, name: l.name, price: l.price, qty: l.qty })),
    },
  }, 201);
});

// PATCH /api/orders { id, action: "cancel" } → cancela un pedido pendiente
export const PATCH = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  if (body.action !== "cancel") throw new HttpError(400, "Acción desconocida");
  const db = await getDb();
  const { rows } = await db.execute({
    sql: "SELECT coupon_code FROM orders WHERE id = ? AND user_id = ? AND status = 'pendiente'",
    args: [Number(body.id), user.id],
  });
  if (!rows.length) throw new HttpError(400, "Solo se pueden cancelar pedidos pendientes");
  await db.batch([
    { sql: "UPDATE orders SET status = 'cancelado' WHERE id = ? AND user_id = ? AND status = 'pendiente'", args: [Number(body.id), user.id] },
    couponUsageDelta(rows[0].coupon_code, -1),
  ].filter(Boolean), "write");
  return json({ ok: true });
});

import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { buildLines } from "../lib/catalog.js";
import { validateCoupon, couponUsageDelta } from "../lib/coupons.js";
import { getDelivery, quoteDelivery } from "../lib/settings.js";
import { orderFields } from "../lib/orders.js";
import { expand, getInventory, checkStock, deductStatements, restockStatements, isStockConflict } from "../lib/stock.js";
import { limit } from "../lib/ratelimit.js";

const MAX_PENDING = 3;

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
    orders: orders.rows.map((o) => ({ ...orderFields(o), items: byOrder.get(Number(o.id)) || [] })),
  });
});

// POST /api/orders { items: [{ id, qty }], notes, coupon, delivery: { method, zoneId, address, timeSlot, cashWith } }
// → registra el pedido con precios, descuento y envío calculados en el servidor
export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  const { lines, subtotal } = await buildLines(body.items);

  const db = await getDb();

  // Anti-abuso: nadie puede "reservar" stock acumulando pedidos sin confirmar
  const { rows: [open] } = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pendiente'",
    args: [user.id],
  });
  if (Number(open.n) >= MAX_PENDING) {
    throw new HttpError(429, `Tenés ${MAX_PENDING} pedidos pendientes. Esperá a que te los confirmemos por WhatsApp o cancelá alguno desde Mi cuenta.`);
  }
  await limit(db, `orders:user:${user.id}`, 10, 60 * 60, "Hiciste demasiados pedidos seguidos");

  let coupon = null;
  let discount = 0;
  if (body.coupon) ({ coupon, discount } = await validateCoupon(db, user.id, body.coupon, subtotal));
  const delivery = quoteDelivery(await getDelivery(db), body.delivery, subtotal);
  const total = subtotal - discount + delivery.shipping;

  // Pago en efectivo: con cuánto paga (vacío = pago justo)
  const rawCash = body.delivery?.cashWith;
  const cashWith = rawCash === "" || rawCash == null ? null : Math.round(Number(rawCash));
  if (cashWith !== null && !(cashWith >= total)) throw new HttpError(400, `El monto con el que pagás tiene que ser de al menos $${total.toLocaleString("es-AR")}`);

  const shipAddress = delivery.method === "retiro" ? "Retiro en el local" : delivery.address;
  const shipPhone = str(body.delivery?.phone, 40) || user.phone;

  // Stock: verificamos con mensaje claro y descontamos en el mismo batch (el CHECK cubre ventas simultáneas)
  const need = expand(lines);
  const inv = await getInventory(db);
  checkStock(need, inv);

  // Un solo batch = una transacción atómica: pedido, ítems, stock y uso del cupón se guardan juntos o nada.
  const [created] = await db.batch([
    {
      sql: `INSERT INTO orders (user_id, total, discount, coupon_code, notes, ship_name, ship_phone, ship_address,
              delivery_method, zone, shipping, time_slot, cash_with)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        user.id, total, discount, coupon?.code || "", str(body.notes, 500), user.name, shipPhone, shipAddress,
        delivery.method, delivery.zone, delivery.shipping, delivery.timeSlot, cashWith,
      ],
    },
    ...lines.map((l) => ({
      sql: `INSERT INTO order_items (order_id, product_id, name, price, qty)
            VALUES ((SELECT MAX(id) FROM orders WHERE user_id = ?), ?, ?, ?, ?)`,
      args: [user.id, l.id, l.name, l.price, l.qty],
    })),
    ...(coupon ? [couponUsageDelta(coupon.code, 1)] : []),
    // Si el cliente no tenía dirección o teléfono en su perfil, guardamos los que usó
    ...(delivery.method === "envio" && !user.address
      ? [{ sql: "UPDATE users SET address = ? WHERE id = ? AND address = ''", args: [delivery.address, user.id] }]
      : []),
    ...(shipPhone && !user.phone ? [{ sql: "UPDATE users SET phone = ? WHERE id = ? AND phone = ''", args: [shipPhone, user.id] }] : []),
    ...deductStatements(need, inv, { orderIdSql: "(SELECT MAX(id) FROM orders WHERE user_id = ?)", orderIdArgs: [user.id], by: user.name }),
  ], "write").catch((err) => {
    if (isStockConflict(err)) throw new HttpError(409, "Uno de los productos se agotó mientras comprabas. Revisá el carrito.");
    throw err;
  });

  return json({
    order: {
      ...orderFields(created.rows[0]),
      subtotal,
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
    {
      sql: "UPDATE orders SET status = 'cancelado', status_updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pendiente'",
      args: [Number(body.id), user.id],
    },
    couponUsageDelta(rows[0].coupon_code, -1),
    ...(await restockStatements(db, Number(body.id), user.name)),
  ].filter(Boolean), "write");
  return json({ ok: true });
});

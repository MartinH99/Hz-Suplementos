import { createRequire } from "node:module";
import { HttpError } from "./http.js";

// Stock por producto. Los combos no tienen stock propio: se arman con sus productos.
const base = createRequire(import.meta.url)("../data/catalog.json");
const COMBO_ITEMS = new Map(base.combos.map((c) => [c.id, c.items || []]));
const NAMES = new Map([...base.products, ...base.combos].map((p) => [p.id, p.name]));
export const comboItems = (id) => COMBO_ITEMS.get(id) || null;
export const productName = (id) => NAMES.get(id) || id;

// Unidades de cada producto que consume un carrito ([{ id, qty }]), con los combos desarmados
export function expand(lines) {
  const need = new Map();
  for (const { id, qty } of lines) {
    for (const part of COMBO_ITEMS.get(id) || [{ id, qty: 1 }]) {
      need.set(part.id, (need.get(part.id) || 0) + part.qty * qty);
    }
  }
  return need;
}

export async function getInventory(db) {
  const { rows } = await db.execute("SELECT product_id, qty, low_alert FROM inventory");
  return new Map(rows.map((r) => [r.product_id, { qty: Number(r.qty), lowAlert: Number(r.low_alert) }]));
}

// Unidades disponibles de un producto o combo (null = sin control de stock)
export function available(id, inv) {
  let min = null;
  for (const part of COMBO_ITEMS.get(id) || [{ id, qty: 1 }]) {
    const s = inv.get(part.id);
    if (!s) continue;
    const n = Math.floor(s.qty / part.qty);
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

// Datos públicos de disponibilidad (no exponemos el stock exacto salvo cuando queda poco)
export function stockInfo(id, inv) {
  const n = available(id, inv);
  if (n === null) return { soldOut: false, lowStock: null };
  const parts = COMBO_ITEMS.get(id) || [{ id }];
  const alert = Math.max(...parts.map((p) => inv.get(p.id)?.lowAlert ?? 0));
  return { soldOut: n === 0, lowStock: n > 0 && n <= alert ? n : null };
}

export function checkStock(need, inv) {
  for (const [id, n] of need) {
    const s = inv.get(id);
    if (s && s.qty < n) {
      throw new HttpError(409, s.qty
        ? `Solo ${s.qty === 1 ? "queda 1 unidad" : `quedan ${s.qty} unidades`} de ${productName(id)}. Ajustá la cantidad en el carrito.`
        : `${productName(id)} está sin stock. Quitalo del carrito para continuar.`);
    }
  }
}

// Sentencias que descuentan stock y registran el movimiento.
// orderIdSql permite referenciar un pedido creado en el mismo batch.
export function deductStatements(need, inv, { orderIdSql = "?", orderIdArgs = [], reason = "venta", by = "" } = {}) {
  const stmts = [];
  for (const [id, n] of need) {
    if (!inv.has(id)) continue;
    stmts.push(
      { sql: "UPDATE inventory SET qty = qty - ?, updated_at = datetime('now') WHERE product_id = ?", args: [n, id] },
      {
        sql: `INSERT INTO stock_movements (product_id, delta, reason, order_id, created_by) VALUES (?, ?, ?, ${orderIdSql}, ?)`,
        args: [id, -n, reason, ...orderIdArgs, by],
      },
    );
  }
  return stmts;
}

// Devuelve al stock lo que un pedido descontó (según sus movimientos)
export async function restockStatements(db, orderId, by) {
  const [{ rows }, inv] = await Promise.all([
    db.execute({ sql: "SELECT product_id, SUM(delta) AS net FROM stock_movements WHERE order_id = ? GROUP BY product_id", args: [orderId] }),
    getInventory(db),
  ]);
  const stmts = [];
  for (const r of rows) {
    const back = -Number(r.net);
    if (back <= 0 || !inv.has(r.product_id)) continue;
    stmts.push(
      { sql: "UPDATE inventory SET qty = qty + ?, updated_at = datetime('now') WHERE product_id = ?", args: [back, r.product_id] },
      { sql: "INSERT INTO stock_movements (product_id, delta, reason, order_id, created_by) VALUES (?, ?, 'cancelacion', ?, ?)", args: [r.product_id, back, orderId, by] },
    );
  }
  return stmts;
}

// Vuelve a descontar el stock de un pedido cancelado que se reactiva
export async function redeductStatements(db, orderId, by) {
  const [{ rows }, inv] = await Promise.all([
    db.execute({ sql: "SELECT product_id, qty FROM order_items WHERE order_id = ?", args: [orderId] }),
    getInventory(db),
  ]);
  const need = expand(rows.map((r) => ({ id: r.product_id, qty: Number(r.qty) })));
  try {
    checkStock(need, inv);
  } catch (err) {
    throw new HttpError(409, `No se puede reactivar el pedido: ${err.message.split(". ")[0]}.`);
  }
  return deductStatements(need, inv, { orderIdArgs: [orderId], reason: "reactivacion", by });
}

// Si una venta concurrente dejó el stock en negativo, el CHECK hace fallar todo el batch
export function isStockConflict(err) {
  return /CHECK constraint/i.test(String(err?.message));
}

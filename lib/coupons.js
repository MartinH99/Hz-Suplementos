import { HttpError } from "./http.js";

export const normalizeCode = (code) => String(code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 30);

export function calcDiscount(coupon, subtotal) {
  if (subtotal < coupon.minTotal) return 0;
  return coupon.type === "percent"
    ? Math.round((subtotal * coupon.value) / 100)
    : Math.min(coupon.value, subtotal);
}

export function publicCoupon(row) {
  return {
    code: row.code,
    type: row.type,
    value: Number(row.value),
    minTotal: Number(row.min_total),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    uses: Number(row.uses),
    oncePerUser: Boolean(row.once_per_user),
    expiresAt: row.expires_at,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

// Valida que el usuario pueda usar el cupón con ese subtotal. Lanza HttpError con el motivo si no.
export async function validateCoupon(db, userId, rawCode, subtotal) {
  const code = normalizeCode(rawCode);
  const { rows } = await db.execute({ sql: "SELECT * FROM coupons WHERE code = ?", args: [code] });
  const row = rows[0];
  if (!row || !row.active) throw new HttpError(400, "El cupón no existe o no está activo");
  if (row.expires_at) {
    const { rows: [t] } = await db.execute({ sql: "SELECT date('now', '-3 hours') > ? AS expired", args: [row.expires_at] });
    if (Number(t.expired)) throw new HttpError(400, "Este cupón ya venció");
  }
  if (row.max_uses != null && Number(row.uses) >= Number(row.max_uses)) {
    throw new HttpError(400, "Este cupón ya alcanzó su límite de usos");
  }
  if (row.once_per_user) {
    const used = await db.execute({
      sql: "SELECT 1 FROM orders WHERE user_id = ? AND coupon_code = ? AND status != 'cancelado' LIMIT 1",
      args: [userId, code],
    });
    if (used.rows.length) throw new HttpError(400, "Ya usaste este cupón en otra compra");
  }
  const coupon = publicCoupon(row);
  if (subtotal < coupon.minTotal) {
    throw new HttpError(400, `Este cupón requiere una compra mínima de $${coupon.minTotal.toLocaleString("es-AR")}`);
  }
  return { coupon, discount: calcDiscount(coupon, subtotal) };
}

// Al cancelar un pedido (o reactivarlo) se devuelve (o vuelve a contar) el uso del cupón.
export function couponUsageDelta(code, delta) {
  return code
    ? { sql: "UPDATE coupons SET uses = MAX(uses + ?, 0) WHERE code = ?", args: [delta, code] }
    : null;
}

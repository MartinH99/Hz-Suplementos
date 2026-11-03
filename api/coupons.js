import { getDb } from "../lib/db.js";
import { json, readJson, handle } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { buildLines } from "../lib/catalog.js";
import { validateCoupon } from "../lib/coupons.js";

// POST /api/coupons { code, items } → valida el cupón para el carrito actual y calcula el descuento.
// El descuento final se vuelve a calcular al crear el pedido.
export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  const { subtotal } = await buildLines(body.items);
  const db = await getDb();
  const { coupon, discount } = await validateCoupon(db, user.id, body.code, subtotal);
  return json({
    coupon: { code: coupon.code, type: coupon.type, value: coupon.value, minTotal: coupon.minTotal },
    subtotal,
    discount,
  });
});

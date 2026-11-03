// Formato común de un pedido para el cliente (Mi cuenta) y el panel admin
export const orderFields = (o) => ({
  id: Number(o.id),
  status: o.status,
  total: Number(o.total),
  discount: Number(o.discount),
  couponCode: o.coupon_code,
  deliveryMethod: o.delivery_method,
  zone: o.zone,
  shipping: Number(o.shipping),
  timeSlot: o.time_slot,
  cashWith: o.cash_with == null ? null : Number(o.cash_with),
  notes: o.notes,
  shipName: o.ship_name,
  shipPhone: o.ship_phone,
  shipAddress: o.ship_address,
  createdAt: o.created_at,
});

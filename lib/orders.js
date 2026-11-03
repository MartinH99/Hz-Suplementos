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
  deliveredAt: o.delivered_at ?? null,
});

// Hora local de Argentina (UTC-3) para agrupar la caja por día
export const LOCAL_OFFSET = "-3 hours";

// Cambia el estado de un pedido registrando cuándo se entregó (para la caja)
export const statusUpdateSql = `
  UPDATE orders SET
    delivered_at = CASE WHEN :status = 'entregado' THEN COALESCE(CASE WHEN status = 'entregado' THEN delivered_at END, datetime('now')) END,
    status = :status,
    status_updated_at = datetime('now')
  WHERE id = :id`;

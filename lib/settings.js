import { HttpError, str } from "./http.js";

// Configuración de entregas (editable en el panel admin → Entregas).
// Valores de ejemplo hasta que el admin cargue los reales.
export const DEFAULT_DELIVERY = {
  pickup: { enabled: true, address: "", hours: "Lunes a viernes de 10 a 19 h · Sábados de 10 a 13 h" },
  zones: [
    { id: "centro", name: "Centro / Macrocentro", price: 2000 },
    { id: "barrios", name: "Barrios", price: 3500 },
    { id: "alrededores", name: "Batán / Sierra de los Padres", price: 5000 },
  ],
  freeShippingFrom: 50000,
  timeSlots: ["Mañana (9 a 13 h)", "Tarde (14 a 18 h)", "Noche (18 a 21 h)"],
};

export async function getDelivery(db) {
  const { rows } = await db.execute({ sql: "SELECT value FROM settings WHERE key = 'delivery'" });
  if (!rows[0]) return DEFAULT_DELIVERY;
  try {
    return { ...DEFAULT_DELIVERY, ...JSON.parse(rows[0].value) };
  } catch {
    return DEFAULT_DELIVERY;
  }
}

const slug = (s, i) => (s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "zona") + "-" + i;

// Valida y normaliza lo que manda el panel admin
export function cleanDelivery(input) {
  const zones = (Array.isArray(input.zones) ? input.zones : []).slice(0, 30).map((z, i) => {
    const name = str(z.name, 60);
    const price = Math.round(Number(z.price));
    if (!name) throw new HttpError(400, `La zona ${i + 1} no tiene nombre`);
    if (!(price >= 0 && price < 10_000_000)) throw new HttpError(400, `Precio inválido en la zona "${name}"`);
    return { id: str(z.id, 80) || slug(name, i), name, price };
  });
  const pickupEnabled = Boolean(input.pickup?.enabled);
  if (!zones.length && !pickupEnabled) throw new HttpError(400, "Tiene que haber al menos una zona de envío o el retiro activado");
  const free = input.freeShippingFrom === "" || input.freeShippingFrom == null ? null : Math.round(Number(input.freeShippingFrom));
  if (free !== null && !(free >= 0)) throw new HttpError(400, "Monto de envío gratis inválido");
  const timeSlots = (Array.isArray(input.timeSlots) ? input.timeSlots : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 10);
  return {
    pickup: { enabled: pickupEnabled, address: str(input.pickup?.address, 160), hours: str(input.pickup?.hours, 160) },
    zones,
    freeShippingFrom: free,
    timeSlots,
  };
}

// Calcula el envío de un pedido. subtotal = productos, antes de cupones.
export function quoteDelivery(delivery, raw = {}, subtotal) {
  const method = raw.method === "retiro" ? "retiro" : "envio";
  const timeSlot = delivery.timeSlots.includes(raw.timeSlot) ? raw.timeSlot : "";
  if (method === "retiro") {
    if (!delivery.pickup.enabled) throw new HttpError(400, "El retiro en el local no está disponible");
    return { method, zone: "", shipping: 0, timeSlot, address: "" };
  }
  const zone = delivery.zones.find((z) => z.id === raw.zoneId);
  if (!zone) throw new HttpError(400, "Elegí la zona de envío");
  const address = str(raw.address, 160);
  if (address.length < 5) throw new HttpError(400, "Ingresá la dirección de entrega");
  const free = delivery.freeShippingFrom != null && subtotal >= delivery.freeShippingFrom;
  return { method, zone: zone.name, shipping: free ? 0 : zone.price, timeSlot, address };
}

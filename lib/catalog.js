import { createRequire } from "node:module";
import { getDb } from "./db.js";

// Catálogo base del repo; el panel admin guarda cambios de precio/visibilidad en product_overrides.
const base = createRequire(import.meta.url)("../data/catalog.json");

export const PRODUCT_IDS = new Set(base.products.map((p) => p.id));
export const ALL_IDS = new Set([...PRODUCT_IDS, ...base.combos.map((c) => c.id)]);

// Devuelve el catálogo con los cambios del admin aplicados.
// Con includeHidden también trae los productos pausados (para el panel admin).
export async function getCatalog({ includeHidden = false } = {}) {
  const db = await getDb();
  const { rows } = await db.execute("SELECT product_id, price, old_price, active FROM product_overrides");
  const overrides = new Map(rows.map((r) => [r.product_id, r]));

  const apply = (item) => {
    const o = overrides.get(item.id);
    if (!o) return { ...item, active: true, edited: false };
    const out = { ...item, price: Number(o.price), active: Boolean(o.active), edited: true };
    if (o.old_price == null) delete out.old;
    else out.old = Number(o.old_price);
    // Las etiquetas de descuento ("-15%") se recalculan con los precios editados
    if (/^-\d+%$/.test(out.badge || "")) {
      if (out.old) out.badge = `-${Math.round((1 - out.price / out.old) * 100)}%`;
      else delete out.badge;
    }
    return out;
  };
  const visible = (item) => includeHidden || item.active;
  return {
    products: base.products.map(apply).filter(visible),
    combos: base.combos.map(apply).filter(visible),
  };
}

// Productos y combos que se pueden comprar ahora, por id (precios del servidor).
export async function getPurchasable() {
  const { products, combos } = await getCatalog();
  return new Map([...products, ...combos].map((p) => [p.id, p]));
}

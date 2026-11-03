import { json, handle } from "../lib/http.js";
import { getDb } from "../lib/db.js";
import { getCatalog } from "../lib/catalog.js";
import { getDelivery } from "../lib/settings.js";

// GET /api/catalog → catálogo público con precios y productos activos, más las opciones de entrega
export const GET = handle(async () => {
  const [catalog, delivery] = await Promise.all([getCatalog(), getDb().then(getDelivery)]);
  return json({ ...catalog, delivery }, 200, { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" });
});

import { json, handle } from "../lib/http.js";
import { getDb } from "../lib/db.js";
import { getCatalog } from "../lib/catalog.js";
import { getDelivery } from "../lib/settings.js";

// GET /api/catalog → catálogo público con precios y productos activos, más las opciones de entrega
export const GET = handle(async () => {
  const [catalog, delivery] = await Promise.all([getCatalog(), getDb().then(getDelivery)]);
  // El navegador siempre pide datos frescos (stock); la CDN de Vercel cachea unos segundos
  return json({ ...catalog, delivery }, 200, {
    "cache-control": "public, max-age=0, must-revalidate",
    "vercel-cdn-cache-control": "s-maxage=10, stale-while-revalidate=20",
  });
});

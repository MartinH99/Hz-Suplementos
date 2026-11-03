import { json, handle } from "../lib/http.js";
import { getCatalog } from "../lib/catalog.js";

// GET /api/catalog → catálogo público con los precios y productos activos actuales
export const GET = handle(async () =>
  json(await getCatalog(), 200, { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" })
);

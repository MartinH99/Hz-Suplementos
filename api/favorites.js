import { getDb } from "../lib/db.js";
import { json, readJson, handle, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { PRODUCT_IDS } from "../lib/catalog.js";

// GET /api/favorites → ids de productos favoritos
export const GET = handle(async (request) => {
  const user = await requireUser(request);
  const db = await getDb();
  const { rows } = await db.execute({
    sql: "SELECT product_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
    args: [user.id],
  });
  return json({ favorites: rows.map((r) => r.product_id) });
});

// POST /api/favorites { productId } → agrega o quita de favoritos
export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const { productId } = await readJson(request);
  if (!PRODUCT_IDS.has(productId)) throw new HttpError(400, "Producto inválido");
  const db = await getDb();
  const removed = await db.execute({
    sql: "DELETE FROM favorites WHERE user_id = ? AND product_id = ?",
    args: [user.id, productId],
  });
  if (removed.rowsAffected) return json({ favorite: false });
  await db.execute({ sql: "INSERT INTO favorites (user_id, product_id) VALUES (?, ?)", args: [user.id, productId] });
  return json({ favorite: true });
});

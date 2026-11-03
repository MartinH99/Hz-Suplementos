import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import { requireUser, verifyPassword, destroySession, publicUser, USER_FIELDS } from "../lib/auth.js";

const GOALS = new Set(["", "volumen", "definicion", "rendimiento", "salud"]);

// GET /api/profile → datos del usuario + estadísticas de compras
export const GET = handle(async (request) => {
  const user = await requireUser(request);
  const db = await getDb();
  const { rows } = await db.execute({
    sql: `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS spent
          FROM orders WHERE user_id = ? AND status != 'cancelado'`,
    args: [user.id],
  });
  return json({ user, stats: { orders: Number(rows[0].orders), spent: Number(rows[0].spent) } });
});

// PUT /api/profile → actualiza datos personales y de envío
export const PUT = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  const name = str(body.name, 80);
  const goal = str(body.goal, 20);
  if (!name) throw new HttpError(400, "El nombre no puede quedar vacío");
  if (!GOALS.has(goal)) throw new HttpError(400, "Objetivo inválido");

  const db = await getDb();
  const { rows } = await db.execute({
    sql: `UPDATE users SET name = ?, phone = ?, address = ?, city = ?, province = ?, zip = ?, goal = ?, newsletter = ?
          WHERE id = ? RETURNING ${USER_FIELDS}`,
    args: [
      name, str(body.phone, 40), str(body.address, 160), str(body.city, 80),
      str(body.province, 80), str(body.zip, 12), goal, body.newsletter ? 1 : 0, user.id,
    ],
  });
  return json({ user: publicUser(rows[0]) });
});

// DELETE /api/profile { password } → elimina la cuenta y todos sus datos
export const DELETE = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request);
  const db = await getDb();
  const { rows } = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [user.id] });
  if (!(await verifyPassword(String(body.password || ""), rows[0].password_hash))) {
    throw new HttpError(400, "La contraseña no es correcta");
  }
  const cookie = await destroySession(request);
  await db.batch([
    { sql: "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)", args: [user.id] },
    { sql: "DELETE FROM orders WHERE user_id = ?", args: [user.id] },
    { sql: "DELETE FROM favorites WHERE user_id = ?", args: [user.id] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", args: [user.id] },
    { sql: "DELETE FROM users WHERE id = ?", args: [user.id] },
  ], "write");
  return json({ ok: true }, 200, { "set-cookie": cookie });
});

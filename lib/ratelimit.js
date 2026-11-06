import { HttpError } from "./http.js";

// Límites de uso guardados en la base (sirven entre instancias de Vercel).
// Cada clave cuenta eventos dentro de una ventana de tiempo fija.

export function clientIp(request) {
  const h = request.headers;
  return h.get("x-real-ip") || (h.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}

const minutesLeft = (resetAt) => Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));

// Suma un evento y devuelve cuántos lleva en la ventana actual
export async function hit(db, key, windowSec) {
  const now = Date.now();
  const resetAt = now + windowSec * 1000;
  const { rows } = await db.execute({
    sql: `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
          RETURNING count, reset_at`,
    args: [key, resetAt, now, now],
  });
  // Limpieza ocasional de ventanas vencidas
  if (Math.random() < 0.02) db.execute({ sql: "DELETE FROM rate_limits WHERE reset_at <= ?", args: [now] }).catch(() => {});
  return { count: Number(rows[0].count), resetAt: Number(rows[0].reset_at) };
}

// Cuenta un evento y corta con 429 si se pasó del límite
export async function limit(db, key, max, windowSec, message = "Demasiados intentos") {
  const { count, resetAt } = await hit(db, key, windowSec);
  if (count > max) throw new HttpError(429, `${message}. Probá de nuevo en ${minutesLeft(resetAt)} min.`);
}

// Para intentos fallidos: consulta sin sumar (se suma solo cuando falla)
export async function assertNotBlocked(db, key, max, message = "Demasiados intentos fallidos") {
  const { rows } = await db.execute({ sql: "SELECT count, reset_at FROM rate_limits WHERE key = ?", args: [key] });
  const r = rows[0];
  if (r && Number(r.reset_at) > Date.now() && Number(r.count) >= max) {
    throw new HttpError(429, `${message}. Probá de nuevo en ${minutesLeft(Number(r.reset_at))} min.`);
  }
}

export async function clear(db, key) {
  await db.execute({ sql: "DELETE FROM rate_limits WHERE key = ?", args: [key] });
}

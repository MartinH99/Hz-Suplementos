import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db.js";
import { getCookie, HttpError } from "./http.js";

const scryptAsync = promisify(scrypt);
const COOKIE = "hz_session";
const SESSION_DAYS = 30;

export const USER_FIELDS = "id, email, name, phone, address, city, province, zip, goal, newsletter, role, created_at";

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = String(stored).split("$");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const key = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(key, expected);
}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// Crea una sesión en la base y devuelve el header Set-Cookie.
export async function createSession(userId) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db.batch([
    { sql: "DELETE FROM sessions WHERE user_id = ? AND expires_at < ?", args: [userId, Date.now()] },
    { sql: "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", args: [hashToken(token), userId, Date.now() + maxAge * 1000] },
  ], "write");
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function destroySession(request) {
  const token = getCookie(request, COOKIE);
  if (token) {
    const db = await getDb();
    await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hashToken(token)] });
  }
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// Borra todas las sesiones del usuario excepto la actual (tras cambiar la contraseña).
export async function revokeOtherSessions(request, userId) {
  const db = await getDb();
  const token = getCookie(request, COOKIE) || "";
  await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", args: [userId, hashToken(token)] });
}

// ===== Recuperación de contraseña =====
const RESET_HOURS = 24;

// Crea un link de un solo uso (invalida los anteriores del mismo usuario). Devuelve el token en claro.
export async function createResetToken(userId) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + RESET_HOURS * 60 * 60 * 1000;
  await db.batch([
    { sql: "DELETE FROM password_resets WHERE user_id = ?", args: [userId] },
    { sql: "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)", args: [hashToken(token), userId, expiresAt] },
  ], "write");
  return { token, expiresAt };
}

// Devuelve el usuario dueño de un token vigente y sin usar, o lanza un error.
export async function findResetUser(token) {
  const db = await getDb();
  const { rows } = await db.execute({
    sql: `SELECT u.id, u.name, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`,
    args: [hashToken(String(token || "")), Date.now()],
  });
  if (!rows[0]) throw new HttpError(400, "El link no es válido o ya venció. Pedí uno nuevo por WhatsApp.");
  return { id: Number(rows[0].id), name: rows[0].name, email: rows[0].email, tokenHash: hashToken(String(token)) };
}

export async function getUser(request) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const db = await getDb();
  const { rows } = await db.execute({
    sql: `SELECT ${USER_FIELDS.split(", ").map((f) => "u." + f).join(", ")}
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [hashToken(token), Date.now()],
  });
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function requireUser(request) {
  const user = await getUser(request);
  if (!user) throw new HttpError(401, "Tenés que iniciar sesión");
  return user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "No tenés permisos de administrador");
  return user;
}

export function publicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    phone: row.phone,
    address: row.address,
    city: row.city,
    province: row.province,
    zip: row.zip,
    goal: row.goal,
    newsletter: Boolean(row.newsletter),
    role: row.role,
    createdAt: row.created_at,
  };
}

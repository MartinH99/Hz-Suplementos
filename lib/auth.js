import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { getDb } from "./db.js";
import { getCookie, HttpError } from "./http.js";

const scryptAsync = promisify(scrypt);
const COOKIE = "hz_session";
const SESSION_DAYS = 30;

export const USER_FIELDS = "id, email, name, phone, address, city, province, zip, goal, newsletter, created_at";

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
    createdAt: row.created_at,
  };
}

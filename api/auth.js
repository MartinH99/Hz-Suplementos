import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import {
  hashPassword, verifyPassword, createSession, destroySession, revokeOtherSessions,
  getUser, requireUser, publicUser, findResetUser, USER_FIELDS,
} from "../lib/auth.js";
import { clientIp, limit, hit, assertNotBlocked, clear } from "../lib/ratelimit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN = 60;

// Hash de relleno: si el email no existe igual calculamos un hash, para que el tiempo
// de respuesta no revele qué emails están registrados.
let dummyHash;
const getDummyHash = async () => (dummyHash ||= await hashPassword("hz-dummy-password"));

function checkPassword(password) {
  if (typeof password !== "string" || password.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres");
  if (password.length > 200) throw new HttpError(400, "La contraseña es demasiado larga");
}

// GET /api/auth → usuario de la sesión actual (o null)
export const GET = handle(async (request) => json({ user: await getUser(request) }));

// POST /api/auth { action: "register" | "login" | "logout" | "password", ... }
export const POST = handle(async (request) => {
  const body = await readJson(request);
  const db = await getDb();

  switch (body.action) {
    case "register": {
      const email = str(body.email, 120).toLowerCase();
      const name = str(body.name, 80);
      if (!EMAIL_RE.test(email)) throw new HttpError(400, "Ingresá un email válido");
      if (!name) throw new HttpError(400, "Ingresá tu nombre");
      checkPassword(body.password);
      await limit(db, `register:ip:${clientIp(request)}`, 5, 60 * MIN, "Se crearon demasiadas cuentas desde esta conexión");

      const exists = await db.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [email] });
      if (exists.rows.length) throw new HttpError(409, "Ya existe una cuenta con ese email");

      const { rows } = await db.execute({
        sql: `INSERT INTO users (email, password_hash, name, phone, newsletter) VALUES (?, ?, ?, ?, ?) RETURNING ${USER_FIELDS}`,
        args: [email, await hashPassword(body.password), name, str(body.phone, 40), body.newsletter ? 1 : 0],
      });
      const user = publicUser(rows[0]);
      return json({ user }, 201, { "set-cookie": await createSession(user.id) });
    }

    case "login": {
      const email = str(body.email, 120).toLowerCase();
      // Bloqueo temporal tras varios intentos fallidos: 5 por cuenta y 20 por conexión cada 15 min
      const emailKey = `login-fail:email:${email}`;
      const ipKey = `login-fail:ip:${clientIp(request)}`;
      await assertNotBlocked(db, emailKey, 5);
      await assertNotBlocked(db, ipKey, 20);

      const { rows } = await db.execute({ sql: `SELECT password_hash, ${USER_FIELDS} FROM users WHERE email = ?`, args: [email] });
      const password = typeof body.password === "string" ? body.password : "";
      const ok = await verifyPassword(password, rows[0]?.password_hash || (await getDummyHash()));
      if (!rows[0] || !ok) {
        await Promise.all([hit(db, emailKey, 15 * MIN), hit(db, ipKey, 15 * MIN)]);
        throw new HttpError(401, "Email o contraseña incorrectos");
      }
      await clear(db, emailKey);
      const user = publicUser(rows[0]);
      return json({ user }, 200, { "set-cookie": await createSession(user.id) });
    }

    case "logout":
      return json({ ok: true }, 200, { "set-cookie": await destroySession(request) });

    case "password": {
      const user = await requireUser(request);
      const failKey = `password-fail:user:${user.id}`;
      await assertNotBlocked(db, failKey, 5);
      const { rows } = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [user.id] });
      if (!(await verifyPassword(String(body.current || ""), rows[0].password_hash))) {
        await hit(db, failKey, 15 * MIN);
        throw new HttpError(400, "La contraseña actual no es correcta");
      }
      await clear(db, failKey);
      checkPassword(body.password);
      await db.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [await hashPassword(body.password), user.id] });
      await revokeOtherSessions(request, user.id);
      return json({ ok: true });
    }

    // Recuperación con link de un solo uso (lo genera el admin y lo envía por WhatsApp)
    case "reset-check": {
      await limit(db, `reset:ip:${clientIp(request)}`, 20, 15 * MIN);
      const target = await findResetUser(body.token);
      return json({ name: target.name.split(" ")[0], email: target.email });
    }

    case "reset": {
      await limit(db, `reset:ip:${clientIp(request)}`, 20, 15 * MIN);
      const target = await findResetUser(body.token);
      checkPassword(body.password);
      await db.batch([
        { sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [await hashPassword(body.password), target.id] },
        { sql: "UPDATE password_resets SET used_at = ? WHERE token_hash = ?", args: [Date.now(), target.tokenHash] },
        { sql: "DELETE FROM sessions WHERE user_id = ?", args: [target.id] },
      ], "write");
      const { rows } = await db.execute({ sql: `SELECT ${USER_FIELDS} FROM users WHERE id = ?`, args: [target.id] });
      return json({ user: publicUser(rows[0]) }, 200, { "set-cookie": await createSession(target.id) });
    }

    default:
      throw new HttpError(400, "Acción desconocida");
  }
});

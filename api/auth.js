import { getDb } from "../lib/db.js";
import { json, readJson, handle, str, HttpError } from "../lib/http.js";
import {
  hashPassword, verifyPassword, createSession, destroySession, revokeOtherSessions,
  getUser, requireUser, publicUser, USER_FIELDS,
} from "../lib/auth.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      const { rows } = await db.execute({ sql: `SELECT password_hash, ${USER_FIELDS} FROM users WHERE email = ?`, args: [email] });
      const ok = rows[0] && typeof body.password === "string" && (await verifyPassword(body.password, rows[0].password_hash));
      if (!ok) throw new HttpError(401, "Email o contraseña incorrectos");
      const user = publicUser(rows[0]);
      return json({ user }, 200, { "set-cookie": await createSession(user.id) });
    }

    case "logout":
      return json({ ok: true }, 200, { "set-cookie": await destroySession(request) });

    case "password": {
      const user = await requireUser(request);
      const { rows } = await db.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [user.id] });
      if (!(await verifyPassword(String(body.current || ""), rows[0].password_hash))) {
        throw new HttpError(400, "La contraseña actual no es correcta");
      }
      checkPassword(body.password);
      await db.execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [await hashPassword(body.password), user.id] });
      await revokeOtherSessions(request, user.id);
      return json({ ok: true });
    }

    default:
      throw new HttpError(400, "Acción desconocida");
  }
});

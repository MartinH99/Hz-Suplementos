import { createClient } from "@libsql/client";

// Esquema de la base. Se aplica una vez por instancia (CREATE ... IF NOT EXISTS).
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    province TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    newsletter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pendiente',
    total INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    ship_name TEXT NOT NULL DEFAULT '',
    ship_phone TEXT NOT NULL DEFAULT '',
    ship_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id)`,
  `CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, product_id)
  )`,
  // Cambios de precio/visibilidad hechos desde el panel admin sobre data/catalog.json
  `CREATE TABLE IF NOT EXISTS product_overrides (
    product_id TEXT PRIMARY KEY,
    price INTEGER NOT NULL,
    old_price INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

// Migraciones sobre tablas existentes. La columna "role" se agregó después del lanzamiento:
// al crearla, si hay un único usuario registrado, ese usuario pasa a ser el administrador.
async function migrate(client) {
  const { rows } = await client.execute("PRAGMA table_info(users)");
  if (rows.some((c) => c.name === "role")) return;
  try {
    await client.batch([
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'",
      "UPDATE users SET role = 'admin' WHERE (SELECT COUNT(*) FROM users) = 1",
    ], "write");
  } catch (err) {
    // Otra instancia pudo haber aplicado la migración al mismo tiempo
    if (!/duplicate column/i.test(String(err.message))) throw err;
  }
}

let client;
let ready;

export async function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("Falta la variable TURSO_DATABASE_URL");
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (!ready) {
    ready = client.batch(["PRAGMA foreign_keys = ON", ...SCHEMA], "write").then(() => migrate(client)).catch((err) => {
      ready = undefined;
      throw err;
    });
  }
  await ready;
  return client;
}

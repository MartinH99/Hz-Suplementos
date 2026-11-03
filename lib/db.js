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
  // Cupones: type 'percent' (value = %) o 'fixed' (value = pesos)
  `CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value INTEGER NOT NULL,
    min_total INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    once_per_user INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // El cupón que anuncia la landing: 10% en la primera compra
  `INSERT OR IGNORE INTO coupons (code, type, value, once_per_user) VALUES ('HZ10', 'percent', 10, 1)`,
  // Configuración general en JSON (por ahora: entregas)
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Cierres de caja diarios (day = fecha local AAAA-MM-DD)
  `CREATE TABLE IF NOT EXISTS cash_closings (
    day TEXT PRIMARY KEY,
    expected INTEGER NOT NULL,
    counted INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    closed_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Stock: solo los productos con fila acá tienen control de stock (el resto es ilimitado).
  // El CHECK hace fallar (y revertir) cualquier venta que dejaría el stock en negativo.
  `CREATE TABLE IF NOT EXISTS inventory (
    product_id TEXT PRIMARY KEY,
    qty INTEGER NOT NULL CHECK (qty >= 0),
    low_alert INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Historial de movimientos: venta, cancelacion, reactivacion, ingreso, ajuste
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    order_id INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS stock_movements_order ON stock_movements(order_id)`,
  `CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(product_id, id)`,
  // Links de un solo uso para elegir una contraseña nueva
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  )`,
];

// Columnas agregadas después del lanzamiento (ALTER TABLE no admite IF NOT EXISTS).
const COLUMNS = [
  // Al crear "role", si hay un único usuario registrado, ese usuario pasa a ser el administrador.
  ["users", "role", "TEXT NOT NULL DEFAULT 'customer'", "UPDATE users SET role = 'admin' WHERE (SELECT COUNT(*) FROM users) = 1"],
  ["orders", "discount", "INTEGER NOT NULL DEFAULT 0"],
  ["orders", "coupon_code", "TEXT NOT NULL DEFAULT ''"],
  // Entrega y pago en efectivo
  ["orders", "delivery_method", "TEXT NOT NULL DEFAULT ''"],
  ["orders", "zone", "TEXT NOT NULL DEFAULT ''"],
  ["orders", "shipping", "INTEGER NOT NULL DEFAULT 0"],
  ["orders", "time_slot", "TEXT NOT NULL DEFAULT ''"],
  ["orders", "cash_with", "INTEGER"],
  // Caja: cuándo se entregó (y cobró) cada pedido. Los ya entregados toman la fecha del pedido.
  ["orders", "delivered_at", "TEXT", "UPDATE orders SET delivered_at = created_at WHERE status = 'entregado'"],
  ["orders", "status_updated_at", "TEXT"],
];

async function migrate(client) {
  for (const [table, column, definition, after] of COLUMNS) {
    const { rows } = await client.execute(`PRAGMA table_info(${table})`);
    if (rows.some((c) => c.name === column)) continue;
    try {
      await client.batch([`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, ...(after ? [after] : [])], "write");
    } catch (err) {
      // Otra instancia pudo haber aplicado la migración al mismo tiempo
      if (!/duplicate column/i.test(String(err.message))) throw err;
    }
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

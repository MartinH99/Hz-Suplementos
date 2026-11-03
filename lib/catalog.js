import { createRequire } from "node:module";

const catalog = createRequire(import.meta.url)("../data/catalog.json");

// Precios de referencia del servidor: el total de un pedido nunca se toma del navegador.
export const ITEMS = new Map([...catalog.products, ...catalog.combos].map((p) => [p.id, p]));
export const PRODUCT_IDS = new Set(catalog.products.map((p) => p.id));

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// Solo aceptamos JSON en las mutaciones: un formulario de otro sitio no puede
// mandar este content-type sin preflight, lo que nos protege de CSRF.
export async function readJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new HttpError(415, "Formato no soportado");
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object") return body;
  } catch {}
  throw new HttpError(400, "Datos inválidos");
}

export function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Envuelve un handler para convertir errores en respuestas JSON.
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Error interno, probá de nuevo en un momento" }, 500);
    }
  };
}

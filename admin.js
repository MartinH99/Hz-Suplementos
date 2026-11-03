// Panel de administración: usa api(), money(), esc() y toast() de script.js.
// La seguridad real está en /api/admin (solo responde a usuarios con rol admin).
const STATUS_OPTIONS = ["pendiente", "confirmado", "enviado", "entregado", "cancelado"];
const STATUS_TEXT = { pendiente: "Pendiente", confirmado: "Confirmado", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };
const STATUS_MSG = {
  confirmado: "¡Confirmamos tu pedido! Ya lo estamos preparando 💪",
  enviado: "¡Tu pedido ya está en camino! 🚚",
  entregado: "Tu pedido figura como entregado. ¡Que lo disfrutes! Cualquier cosa, escribinos.",
  cancelado: "Tu pedido fue cancelado. Si fue un error, escribinos y lo resolvemos.",
  pendiente: "Recibimos tu pedido y en breve lo confirmamos.",
};
const code = (id) => `#HZ-${String(id).padStart(5, "0")}`;
const toDate = (s) => new Date(s.replace(" ", "T") + "Z");
const shortDate = (s) => (s ? toDate(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const dateTime = (s) => toDate(s).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Teléfono argentino a formato internacional para wa.me
function waPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) return d;
  d = d.replace(/^0/, "");
  return d.length === 10 ? "549" + d : d;
}

// Entrega, franja y efectivo de un pedido (los pedidos viejos no tienen método de entrega)
function deliveryLines(o) {
  const lines = [];
  if (o.deliveryMethod === "retiro") lines.push("🏪 <b>Retira en el local</b>");
  else lines.push(o.shipAddress ? `📍 ${esc(o.shipAddress)}` : "📍 Sin dirección cargada");
  if (o.timeSlot) lines.push(`🕐 ${esc(o.timeSlot)}`);
  if (o.deliveryMethod) {
    lines.push(o.cashWith && o.cashWith > o.total
      ? `💵 Paga con ${money(o.cashWith)} → <b>llevar ${money(o.cashWith - o.total)} de vuelto</b>`
      : "💵 Paga justo en efectivo");
  }
  return lines.map((l) => `<div>${l}</div>`).join("");
}

let me = null;
let orderFilter = { status: "", q: "" };
let ordersCache = [];

// ===== Resumen =====
async function loadStats() {
  const { stats, daily, top } = await api("admin?view=stats");
  const kpis = [
    [money(stats.revenue), "Ventas totales"],
    [money(stats.revenue30), "Ventas 30 días"],
    [stats.orders, "Pedidos"],
    [stats.pending, "Pendientes"],
    [money(stats.avgTicket), "Ticket promedio"],
    [`${stats.users}<small> +${stats.newUsers} en 30d</small>`, "Clientes"],
  ];
  $("#kpis").innerHTML = kpis.map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");

  const badge = $("#pendingBadge");
  badge.hidden = !stats.pending;
  badge.textContent = stats.pending;

  // Completa los 14 días aunque no haya ventas
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, total: byDay.get(d)?.total || 0, orders: byDay.get(d)?.orders || 0 });
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  $("#salesChart").innerHTML = days.map((d) => `
    <div class="bar" title="${d.day.split("-").reverse().join("/")}: ${money(d.total)} (${d.orders} pedidos)">
      <span class="bar__fill" style="height:${Math.max((d.total / max) * 100, d.total ? 4 : 1)}%"></span>
      <span class="bar__label">${d.day.slice(8)}</span>
    </div>`).join("");

  $("#topList").innerHTML = top.length
    ? top.map((p) => `<li><span>${esc(p.name)}</span><b>${p.qty} u.</b><small>${money(p.revenue)}</small></li>`).join("")
    : `<li class="muted">Todavía no hay ventas.</li>`;
}

// ===== Pedidos =====
async function loadOrders() {
  const qs = new URLSearchParams({ view: "orders", ...orderFilter });
  ({ orders: ordersCache } = await api(`admin?${qs}`));
  const list = $("#adminOrders");
  if (!ordersCache.length) {
    list.innerHTML = `<div class="empty"><span>📭</span>No hay pedidos con este filtro.</div>`;
    return;
  }
  list.innerHTML = ordersCache.map((o) => `
    <article class="order">
      <div class="order__head">
        <div>
          <div class="order__id">${code(o.id)}</div>
          <div class="order__date">${dateTime(o.createdAt)}</div>
        </div>
        <label class="status-select status--${o.status}">
          <select data-status-for="${o.id}" aria-label="Estado del pedido ${code(o.id)}">
            ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${STATUS_TEXT[s]}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="order__customer">
        <span><b>${esc(o.shipName)}</b> · ${esc(o.email)}${o.shipPhone ? ` · ${esc(o.shipPhone)}` : ""}</span>
        ${deliveryLines(o)}
      </div>
      <ul class="order__items">
        ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}
        ${o.discount ? `<li class="order__discount"><span>🎟️ Cupón ${esc(o.couponCode)}</span><span>-${money(o.discount)}</span></li>` : ""}
        ${o.deliveryMethod === "envio" ? `<li><span>🚚 Envío${o.zone ? ` (${esc(o.zone)})` : ""}</span><span>${o.shipping ? money(o.shipping) : "Gratis"}</span></li>` : ""}
      </ul>
      ${o.notes ? `<div class="order__meta"><span>📝 ${esc(o.notes)}</span></div>` : ""}
      <div class="order__foot">
        <span class="order__total">${money(o.total)}</span>
        <div class="order__actions">
          ${waPhone(o.shipPhone) ? `<button class="btn btn--primary btn--sm" data-notify="${o.id}">Avisar por WhatsApp</button>` : `<span class="muted small">Sin teléfono</span>`}
        </div>
      </div>
    </article>`).join("");
}

async function changeStatus(select) {
  const id = Number(select.dataset.statusFor);
  select.disabled = true;
  try {
    await api("admin", { method: "POST", body: { action: "order-status", id, status: select.value } });
    ordersCache.find((o) => o.id === id).status = select.value;
    select.parentElement.className = `status-select status--${select.value}`;
    toast(`${code(id)} → ${STATUS_TEXT[select.value]}`);
    loadStats();
  } catch (err) {
    toast(err.message);
    select.value = ordersCache.find((o) => o.id === id).status;
  } finally {
    select.disabled = false;
  }
}

function notifyCustomer(id) {
  const o = ordersCache.find((x) => x.id === id);
  const pickupReady = o.deliveryMethod === "retiro" && ["confirmado", "enviado"].includes(o.status);
  const status = pickupReady ? "¡Tu pedido ya está listo para retirar! 🏪" : STATUS_MSG[o.status];
  const toPay = ["pendiente", "confirmado", "enviado"].includes(o.status) ? `\n\nTotal a pagar en efectivo: ${money(o.total)}` : "";
  const text = `¡Hola ${o.shipName.split(" ")[0]}! Te escribimos de HZ Suplementos por tu pedido ${code(o.id)}.\n\n${status}${toPay}`;
  window.open(`https://wa.me/${waPhone(o.shipPhone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

// ===== Clientes =====
async function loadUsers(q = "") {
  const { users } = await api(`admin?${new URLSearchParams({ view: "users", q })}`);
  $("#usersCount").textContent = `${users.length} cliente${users.length === 1 ? "" : "s"}`;
  $("#usersBody").innerHTML = users.length
    ? users.map((u) => `
      <tr>
        <td data-label="Cliente"><b>${esc(u.name)}</b>${u.newsletter ? ' <span title="Suscripto al newsletter">📧</span>' : ""}</td>
        <td data-label="Contacto">${esc(u.email)}${u.phone ? `<br /><small>${esc(u.phone)}</small>` : ""}</td>
        <td data-label="Ubicación">${esc([u.city, u.province].filter(Boolean).join(", ")) || "—"}</td>
        <td data-label="Pedidos">${u.orders}${u.lastOrder ? `<br /><small>último ${shortDate(u.lastOrder)}</small>` : ""}</td>
        <td data-label="Total">${money(u.spent)}</td>
        <td data-label="Alta">${shortDate(u.createdAt)}</td>
        <td data-label="Rol">${u.id === me.id
          ? `<span class="role role--admin">Admin (vos)</span>`
          : `<button class="role role--${u.role}" data-role-for="${u.id}" data-role="${u.role === "admin" ? "customer" : "admin"}" title="Cambiar rol">${u.role === "admin" ? "Admin" : "Cliente"}</button>`}</td>
        <td data-label="Contraseña"><button class="btn btn--ghost btn--sm" data-reset-for="${u.id}" title="Genera un link de un solo uso, válido 24 h">🔑 Link de acceso</button></td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="muted">No se encontraron clientes.</td></tr>`;
}

async function changeRole(btn) {
  const makeAdmin = btn.dataset.role === "admin";
  const name = btn.closest("tr").querySelector("b").textContent;
  if (!confirm(makeAdmin ? `¿Darle permisos de administrador a ${name}?` : `¿Quitarle los permisos de administrador a ${name}?`)) return;
  btn.disabled = true;
  try {
    await api("admin", { method: "POST", body: { action: "user-role", id: Number(btn.dataset.roleFor), role: btn.dataset.role } });
    toast(makeAdmin ? `${name} ahora es administrador` : `${name} ahora es cliente`);
    loadUsers($("#userSearch").value);
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

// Link para que el cliente elija una contraseña nueva: se envía por WhatsApp o se copia
async function sendResetLink(btn) {
  btn.disabled = true;
  try {
    const { url, name, phone } = await api("admin", { method: "POST", body: { action: "reset-link", id: Number(btn.dataset.resetFor) } });
    const text = `¡Hola ${name.split(" ")[0]}! Te escribimos de HZ Suplementos 💪\n\nEntrá a este link para crear tu nueva contraseña (vale por 24 horas y se usa una sola vez):\n${url}`;
    if (waPhone(phone)) {
      window.open(`https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      toast("Link generado: se abrió WhatsApp para enviarlo");
    } else {
      await navigator.clipboard.writeText(url).then(
        () => toast("El cliente no tiene teléfono: copiamos el link al portapapeles"),
        () => prompt("Copiá este link y envíaselo al cliente:", url)
      );
    }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===== Cupones =====
let couponsCache = [];
const couponLabel = (c) => (c.type === "percent" ? `${c.value}% OFF` : `${money(c.value)} OFF`);

async function loadCoupons() {
  ({ coupons: couponsCache } = await api("admin?view=coupons"));
  $("#couponsBody").innerHTML = couponsCache.length
    ? couponsCache.map((c) => {
        const expired = c.expiresAt && c.expiresAt < new Date().toISOString().slice(0, 10);
        const conditions = [c.minTotal ? `Mín. ${money(c.minTotal)}` : "", c.oncePerUser ? "1 por cliente" : ""].filter(Boolean).join(" · ") || "—";
        return `
        <tr data-coupon="${esc(c.code)}" class="${c.active && !expired ? "" : "is-paused"}">
          <td data-label="Código"><b class="coupon-code">${esc(c.code)}</b></td>
          <td data-label="Descuento">${couponLabel(c)}</td>
          <td data-label="Condiciones">${conditions}</td>
          <td data-label="Usos">${c.uses}${c.maxUses ? ` / ${c.maxUses}` : ""}</td>
          <td data-label="Ahorro dado">${money(c.discounted)}</td>
          <td data-label="Vence">${c.expiresAt ? c.expiresAt.split("-").reverse().join("/") + (expired ? " <small>(vencido)</small>" : "") : "—"}</td>
          <td data-label="Activo"><label class="switch"><input type="checkbox" data-coupon-toggle ${c.active ? "checked" : ""} /><span></span></label></td>
          <td class="row-actions">
            <button class="btn btn--ghost btn--sm" data-coupon-edit>Editar</button>
            <button class="btn btn--danger btn--sm" data-coupon-delete>Borrar</button>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="8" class="muted">Todavía no hay cupones.</td></tr>`;
}

function editCoupon(code) {
  const c = couponsCache.find((x) => x.code === code);
  const f = $("#couponForm");
  f.elements.code.value = c.code;
  f.elements.code.readOnly = true;
  f.elements.type.value = c.type;
  f.elements.value.value = c.value;
  f.elements.minTotal.value = c.minTotal || "";
  f.elements.maxUses.value = c.maxUses ?? "";
  f.elements.expiresAt.value = c.expiresAt || "";
  f.elements.oncePerUser.checked = c.oncePerUser;
  f.elements.active.checked = c.active;
  f.dataset.editing = c.code;
  $("#couponFormTitle").textContent = `EDITAR ${c.code}`;
  $("#couponCancel").hidden = false;
  f.scrollIntoView({ behavior: "smooth" });
}

function resetCouponForm() {
  const f = $("#couponForm");
  f.reset();
  f.elements.code.readOnly = false;
  delete f.dataset.editing;
  $("#couponFormTitle").textContent = "NUEVO CUPÓN";
  $("#couponCancel").hidden = true;
  f.querySelector(".form-error").textContent = "";
}

async function saveCoupon(c, changes = {}) {
  await api("admin", { method: "POST", body: { action: "coupon-save", ...c, ...changes } });
}

// ===== Reparto =====
const TZ = "America/Argentina/Buenos_Aires";
const changeFor = (o) => (o.cashWith && o.cashWith > o.total ? o.cashWith - o.total : 0);
// Los pedidos anteriores a las opciones de entrega no tienen zona
const zoneOf = (o) => (o.deliveryMethod ? o.zone || "Sin zona" : "Entrega a coordinar");
let routeCache = [];
let routeFilter = "todos";

async function loadRoute() {
  ({ orders: routeCache } = await api("admin?view=route"));
  const zones = [...new Set(routeCache.filter((o) => o.deliveryMethod !== "retiro").map(zoneOf))];
  const sel = $("#routeZone");
  const current = sel.value;
  sel.innerHTML = `<option value="">Todas las zonas</option>` +
    zones.map((z) => `<option>${esc(z)}</option>`).join("") + `<option value="__retiro">Solo retiros</option>`;
  sel.value = [...sel.options].some((o) => o.value === current) ? current : "";
  renderRoute();
}

function routeVisible() {
  const zone = $("#routeZone").value;
  return routeCache
    .filter((o) => routeFilter === "todos" || o.status === routeFilter)
    .filter((o) => !zone || (zone === "__retiro" ? o.deliveryMethod === "retiro" : o.deliveryMethod !== "retiro" && zoneOf(o) === zone));
}

function routeTable(title, list) {
  if (!list.length) return "";
  const rows = list.map((o, i) => `
    <tr>
      <td data-label="#">${i + 1}</td>
      <td data-label="Pedido"><b>${code(o.id)}</b><br /><span class="status status--${o.status}">${STATUS_TEXT[o.status]}</span></td>
      <td data-label="Cliente"><b>${esc(o.shipName)}</b>${o.shipPhone ? `<br />📞 ${esc(o.shipPhone)}` : ""}</td>
      <td data-label="Entrega">${o.deliveryMethod === "retiro" ? "🏪 Retira en el local" : `📍 ${esc(o.shipAddress) || "—"}`}${o.timeSlot ? `<br />🕐 ${esc(o.timeSlot)}` : ""}${o.notes ? `<br />📝 ${esc(o.notes)}` : ""}</td>
      <td data-label="Productos" class="route-items">${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join("<br />")}</td>
      <td data-label="Cobrar"><b class="route-amount">${money(o.total)}</b></td>
      <td data-label="Vuelto">${changeFor(o) ? `Paga con ${money(o.cashWith)}<br /><b>Vuelto ${money(changeFor(o))}</b>` : "Justo"}</td>
      <td data-label="Acciones" class="row-actions no-print">
        ${o.status === "confirmado" && o.deliveryMethod !== "retiro" ? `<button class="btn btn--ghost btn--sm" data-route-status="enviado" data-id="${o.id}">🚚 Enviado</button>` : ""}
        <button class="btn btn--primary btn--sm" data-route-status="entregado" data-id="${o.id}">✔ Entregado</button>
      </td>
      <td class="print-only route-check">☐</td>
    </tr>`).join("");
  return `
    <h4 class="route-group">${title} <small>${list.length} pedido${list.length === 1 ? "" : "s"} · ${money(list.reduce((s, o) => s + o.total, 0))}</small></h4>
    <div class="table-wrap">
      <table class="table route-table">
        <thead><tr><th>#</th><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Productos</th><th>Cobrar</th><th>Vuelto</th><th class="no-print"></th><th class="print-only">Entregado</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderRoute() {
  const list = routeVisible();
  const sheet = $("#routeSheet");
  if (!list.length) {
    sheet.innerHTML = `<div class="empty"><span>🛵</span>No hay pedidos confirmados ni en camino.<br /><small>Confirmá pedidos en la pestaña Pedidos para que aparezcan acá.</small></div>`;
    return;
  }
  const envios = list.filter((o) => o.deliveryMethod !== "retiro");
  const retiros = list.filter((o) => o.deliveryMethod === "retiro");
  const zones = [...new Set(envios.map(zoneOf))];
  const totalChange = envios.reduce((s, o) => s + changeFor(o), 0);
  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  sheet.innerHTML = `
    <div class="route-head">
      <div><h3>HOJA DE REPARTO</h3><p class="muted">${today}</p></div>
      <div class="route-totals">
        <div><span>Pedidos</span><b>${list.length}</b></div>
        <div><span>A cobrar</span><b>${money(list.reduce((s, o) => s + o.total, 0))}</b></div>
        <div><span>Cambio a llevar</span><b>${money(totalChange)}</b></div>
      </div>
    </div>
    ${zones.map((z) => routeTable(`🚚 ${esc(z)}`, envios.filter((o) => zoneOf(o) === z))).join("")}
    ${routeTable("🏪 Retiros en el local", retiros)}
    <p class="print-only route-sign">Repartidor: ______________________ &nbsp; Efectivo rendido: $ ____________</p>`;
}

async function routeStatus(btn) {
  btn.disabled = true;
  try {
    await api("admin", { method: "POST", body: { action: "order-status", id: Number(btn.dataset.id), status: btn.dataset.routeStatus } });
    toast(`${code(btn.dataset.id)} → ${STATUS_TEXT[btn.dataset.routeStatus]}`);
    loadRoute();
    loadStats().catch(() => {});
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

async function markAllSent() {
  const ids = routeVisible().filter((o) => o.status === "confirmado" && o.deliveryMethod !== "retiro").map((o) => o.id);
  if (!ids.length) return toast("No hay envíos por salir en esta vista");
  if (!confirm(`¿Marcar ${ids.length} pedido${ids.length === 1 ? "" : "s"} como enviado${ids.length === 1 ? "" : "s"}?`)) return;
  try {
    await api("admin", { method: "POST", body: { action: "order-status-bulk", ids, status: "enviado" } });
    toast(`🚚 ${ids.length} pedido${ids.length === 1 ? "" : "s"} en camino`);
    loadRoute();
  } catch (err) {
    toast(err.message);
  }
}

function printRoute() {
  if (!routeVisible().length) return toast("No hay pedidos para imprimir");
  document.body.classList.add("printing-route");
  window.print();
  document.body.classList.remove("printing-route");
}

// ===== Caja =====
const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
let cashData = null;

async function loadCash() {
  const input = $("#cashDay");
  if (!input.value) input.value = todayLocal();
  input.max = todayLocal();
  cashData = await api(`admin?view=cash&day=${input.value}`);
  const { collected, pending, orders, closing, history } = cashData;

  $("#cashKpis").innerHTML = [
    [money(collected.total), `Cobrado · ${collected.count} pedido${collected.count === 1 ? "" : "s"}`],
    [money(collected.shipping), "Envíos cobrados"],
    [money(collected.discount), "Descuentos dados"],
    [`${money(pending.enviado.total)}<small>${pending.enviado.count} en camino</small>`, "En la calle (ahora)"],
    [money(pending.enviado.change), "Cambio que llevan"],
    [`${money(pending.confirmado.total)}<small>${pending.confirmado.count} pedidos</small>`, "Por salir (ahora)"],
  ].map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");

  $("#cashBreakdown").textContent = `🚚 ${collected.envio.count} envíos (${money(collected.envio.total)}) · 🏪 ${collected.retiro.count} retiros (${money(collected.retiro.total)})`;
  $("#cashOrders").innerHTML = orders.length
    ? orders.map((o) => `
      <tr>
        <td data-label="Pedido"><b>${code(o.id)}</b></td>
        <td data-label="Cliente">${esc(o.shipName)}</td>
        <td data-label="Entrega">${o.deliveryMethod === "retiro" ? "🏪 Retiro" : `🚚 ${esc(o.zone) || "Envío"}`}</td>
        <td data-label="Hora">${toDate(o.deliveredAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })}</td>
        <td data-label="Monto"><b>${money(o.total)}</b></td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="muted">No hay pedidos entregados este día.</td></tr>`;

  const f = $("#cashClose");
  $("#cashExpected").textContent = money(collected.total);
  f.elements.counted.value = closing ? closing.counted : "";
  f.elements.notes.value = closing ? closing.notes : "";
  f.querySelector(".form-error").textContent = "";
  f.querySelector(".form-ok").textContent = "";
  $("#cashCloseBtn").textContent = closing ? "Actualizar cierre" : "Cerrar caja";
  $("#cashClosedInfo").innerHTML = closing
    ? `Cerrada por ${esc(closing.closedBy)} el ${toDate(closing.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ })}` +
      (closing.expected !== collected.total ? ` <b class="warn">Después del cierre se entregaron más pedidos: actualizalo.</b>` : "")
    : "";
  renderCashDiff();

  $("#cashHistory").innerHTML = history.length
    ? history.map((c) => `
      <tr>
        <td data-label="Día">${c.day.split("-").reverse().join("/")}</td>
        <td data-label="Esperado">${money(c.expected)}</td>
        <td data-label="Contado">${money(c.counted)}</td>
        <td data-label="Diferencia"><b class="${c.difference < 0 ? "diff--minus" : c.difference > 0 ? "diff--plus" : "diff--ok"}">${c.difference === 0 ? "✔ $0" : (c.difference > 0 ? "+" : "-") + money(Math.abs(c.difference))}</b></td>
        <td data-label="Notas">${esc(c.notes) || "—"}</td>
        <td data-label="Cerró">${esc(c.closedBy)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">Todavía no hay cierres.</td></tr>`;
}

function renderCashDiff() {
  const raw = $("#cashClose").elements.counted.value;
  const el = $("#cashDiff");
  if (raw === "" || !cashData) { el.textContent = ""; el.className = "cash-diff"; return; }
  const diff = Number(raw) - cashData.collected.total;
  el.className = "cash-diff " + (diff === 0 ? "diff--ok" : diff > 0 ? "diff--plus" : "diff--minus");
  el.textContent = diff === 0 ? "✔ La caja cuadra perfecto" : diff > 0 ? `Sobran ${money(diff)}` : `Faltan ${money(-diff)}`;
}

async function closeCash(e) {
  e.preventDefault();
  const f = e.target;
  const btn = $("#cashCloseBtn");
  f.querySelector(".form-error").textContent = "";
  btn.disabled = true;
  try {
    await api("admin", { method: "POST", body: { action: "cash-close", day: $("#cashDay").value, counted: f.elements.counted.value, notes: f.elements.notes.value } });
    toast("✔ Caja cerrada");
    await loadCash();
    f.querySelector(".form-ok").textContent = "✔ Cierre guardado";
  } catch (err) {
    f.querySelector(".form-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ===== Stock =====
const MOVE_REASON = { venta: "Venta", cancelacion: "Cancelación", reactivacion: "Pedido reactivado", ingreso: "Ingreso", ajuste: "Ajuste" };
const stockLevel = (p) => (p.qty === 0 ? "out" : p.qty <= p.lowAlert ? "low" : "ok");

async function loadStock() {
  const { products, combos, movements } = await api("admin?view=stock");
  updateStockBadge(products);
  $("#stockBody").innerHTML = products.map((p) => `
    <tr data-stock="${p.id}">
      <td data-label="Producto"><b>${esc(p.name)}</b><br /><small>${CAT_LABEL[p.cat]}${p.active ? "" : " · pausado"}</small></td>
      <td data-label="Stock">${p.tracked
        ? `<span class="stock-qty stock-qty--${stockLevel(p)}">${p.qty}</span> <small>${stockLevel(p) === "out" ? "sin stock" : stockLevel(p) === "low" ? "stock bajo" : "u."}</small>`
        : `<span class="muted">Sin control</span>`}</td>
      <td data-label="Alerta si quedan">${p.tracked
        ? `<input class="mini-input" type="number" min="0" value="${p.lowAlert}" data-stock-alert aria-label="Alerta de stock bajo de ${esc(p.name)}" style="width:80px" />`
        : "—"}</td>
      <td data-label="Vendidos 30 días">${p.tracked ? p.sold30 : "—"}</td>
      <td class="row-actions">
        <div class="stock-actions">
          ${p.tracked
            ? `<input class="mini-input" type="number" min="0" placeholder="Cant." data-stock-qty aria-label="Cantidad para ${esc(p.name)}" />
               <button class="btn btn--primary btn--sm" data-stock-move="add" title="Suma unidades (llegó mercadería)">+ Ingreso</button>
               <button class="btn btn--ghost btn--sm" data-stock-move="set" title="Corrige el stock al número exacto que contaste">Ajustar a</button>
               <button class="link small" data-stock-untrack>Quitar control</button>`
            : `<input class="mini-input" type="number" min="0" placeholder="Stock" data-stock-qty aria-label="Stock inicial de ${esc(p.name)}" />
               <button class="btn btn--ghost btn--sm" data-stock-track>Controlar stock</button>`}
        </div>
      </td>
    </tr>`).join("");

  $("#comboStockBody").innerHTML = combos.map((c) => `
    <tr>
      <td data-label="Combo"><b>${esc(c.name)}</b>${c.active ? "" : "<br /><small>pausado</small>"}</td>
      <td data-label="Se pueden armar">${c.available === null ? `<span class="muted">Sin control</span>` : `<span class="stock-qty stock-qty--${c.available === 0 ? "out" : c.available <= 3 ? "low" : "ok"}">${c.available}</span>`}</td>
      <td data-label="Productos">${c.parts.map((p) => `${p.qty}× ${esc(p.name)} <small>(${p.stock === null ? "sin control" : `stock ${p.stock}`})</small>`).join("<br />")}</td>
    </tr>`).join("");

  $("#movesBody").innerHTML = movements.length
    ? movements.map((m) => `
      <tr>
        <td data-label="Fecha">${dateTime(m.createdAt)}</td>
        <td data-label="Producto">${esc(m.name)}</td>
        <td data-label="Cantidad"><span class="${m.delta > 0 ? "move-in" : "move-out"}">${m.delta > 0 ? "+" : ""}${m.delta}</span></td>
        <td data-label="Motivo">${MOVE_REASON[m.reason] || esc(m.reason)}</td>
        <td data-label="Detalle">${m.orderId ? code(m.orderId) : ""}${m.note ? esc(m.note) : ""}${!m.orderId && !m.note ? "—" : ""}</td>
        <td data-label="Por">${esc(m.by) || "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">Todavía no hay movimientos.</td></tr>`;
}

function updateStockBadge(products) {
  const alerts = products.filter((p) => p.tracked && p.active && stockLevel(p) !== "ok").length;
  const badge = $("#stockBadge");
  badge.hidden = !alerts;
  badge.textContent = alerts;
}

async function stockAction(row, body, okMsg) {
  row.querySelectorAll("button, input").forEach((el) => (el.disabled = true));
  try {
    await api("admin", { method: "POST", body: { id: row.dataset.stock, ...body } });
    toast(okMsg);
    await loadStock();
  } catch (err) {
    toast(err.message);
    row.querySelectorAll("button, input").forEach((el) => (el.disabled = false));
  }
}

function onStockClick(e) {
  const row = e.target.closest("[data-stock]");
  if (!row) return;
  const qty = row.querySelector("[data-stock-qty]")?.value ?? "";
  const name = row.querySelector("b").textContent;
  if (e.target.closest("[data-stock-track]")) {
    if (qty === "") return toast("Ingresá cuántas unidades tenés hoy");
    stockAction(row, { action: "stock-track", qty }, `Control de stock activado para ${name}`);
  }
  const move = e.target.closest("[data-stock-move]");
  if (move) {
    if (qty === "") return toast("Ingresá una cantidad");
    const add = move.dataset.stockMove === "add";
    const note = add ? "" : prompt(`Motivo del ajuste de ${name} (opcional):`, "Conteo de inventario");
    if (note === null) return;
    stockAction(row, { action: "stock-move", mode: add ? "add" : "set", qty, note }, add ? `+${qty} unidades de ${name}` : `Stock de ${name} ajustado a ${qty}`);
  }
  if (e.target.closest("[data-stock-untrack]") && confirm(`¿Dejar de controlar el stock de ${name}? Se va a poder vender sin límite.`)) {
    stockAction(row, { action: "stock-untrack" }, `${name} ya no controla stock`);
  }
}

// ===== Entregas =====
function zoneRow(z = { id: "", name: "", price: "" }) {
  return `
    <div class="zone-row" data-zone-id="${esc(z.id)}">
      <input class="mini-input zone-name" value="${esc(z.name)}" placeholder="Nombre de la zona" maxlength="60" aria-label="Nombre de la zona" />
      <input class="mini-input zone-price" type="number" min="0" step="100" value="${z.price}" placeholder="Precio" aria-label="Precio de envío" />
      <button type="button" class="icon-btn" data-remove-zone aria-label="Quitar zona">✕</button>
    </div>`;
}

async function loadDelivery() {
  const { delivery } = await api("admin?view=delivery");
  const f = $("#deliverySettings");
  $("#zonesList").innerHTML = delivery.zones.map(zoneRow).join("");
  f.elements.freeShippingFrom.value = delivery.freeShippingFrom ?? "";
  f.elements.pickupEnabled.checked = delivery.pickup.enabled;
  f.elements.pickupAddress.value = delivery.pickup.address;
  f.elements.pickupHours.value = delivery.pickup.hours;
  f.elements.timeSlots.value = delivery.timeSlots.join("\n");
}

async function saveDelivery(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  const errorEl = f.querySelector(".form-error");
  const okEl = f.querySelector(".form-ok");
  errorEl.textContent = okEl.textContent = "";
  const delivery = {
    zones: [...document.querySelectorAll(".zone-row")]
      .map((row) => ({ id: row.dataset.zoneId, name: row.querySelector(".zone-name").value, price: row.querySelector(".zone-price").value }))
      .filter((z) => z.name.trim() || z.price !== ""),
    freeShippingFrom: f.elements.freeShippingFrom.value,
    pickup: { enabled: f.elements.pickupEnabled.checked, address: f.elements.pickupAddress.value, hours: f.elements.pickupHours.value },
    timeSlots: f.elements.timeSlots.value.split("\n"),
  };
  btn.disabled = true;
  try {
    await api("admin", { method: "POST", body: { action: "delivery-save", delivery } });
    okEl.textContent = "✔ Guardado. La tienda se actualiza en menos de un minuto.";
    loadDelivery();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

// ===== Productos =====
async function loadProducts() {
  const { products, combos } = await api("admin?view=products");
  const row = (p, label) => `
    <tr data-product="${p.id}" class="${p.active ? "" : "is-paused"}">
      <td data-label="Producto"><b>${esc(p.name)}</b><br /><small>${label}${p.edited ? " · <span class='accent'>editado</span>" : ""}</small></td>
      <td data-label="Vendidos">${p.sold}</td>
      <td data-label="Precio"><input class="mini-input" name="price" type="number" min="1" step="100" value="${p.price}" aria-label="Precio de ${esc(p.name)}" /></td>
      <td data-label="Precio anterior"><input class="mini-input" name="old" type="number" min="1" step="100" value="${p.old ?? ""}" placeholder="—" aria-label="Precio anterior de ${esc(p.name)}" /></td>
      <td data-label="Visible"><label class="switch"><input type="checkbox" name="active" ${p.active ? "checked" : ""} /><span></span></label></td>
      <td class="row-actions">
        <button class="btn btn--primary btn--sm" data-save-product>Guardar</button>
        ${p.edited ? `<button class="btn btn--ghost btn--sm" data-reset-product title="Volver al precio original">Restablecer</button>` : ""}
      </td>
    </tr>`;
  $("#productsBody").innerHTML =
    products.map((p) => row(p, CAT_LABEL[p.cat])).join("") +
    `<tr class="table__group"><td colspan="6">Combos</td></tr>` +
    combos.map((c) => row(c, "Combo")).join("");
}

async function saveProduct(tr, reset = false) {
  const get = (n) => tr.querySelector(`[name=${n}]`);
  const body = reset
    ? { action: "product-reset", id: tr.dataset.product }
    : { action: "product", id: tr.dataset.product, price: get("price").value, old: get("old").value, active: get("active").checked };
  tr.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await api("admin", { method: "POST", body });
    toast(reset ? "Producto restablecido" : "✔ Producto actualizado");
    loadProducts();
  } catch (err) {
    toast(err.message);
    tr.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

// ===== Eventos =====
let searchTimer;
const debounce = (fn) => { clearTimeout(searchTimer); searchTimer = setTimeout(fn, 300); };
const loaders = { resumen: loadStats, pedidos: loadOrders, clientes: () => loadUsers($("#userSearch").value), productos: loadProducts, cupones: loadCoupons, entregas: loadDelivery, reparto: loadRoute, caja: loadCash, stock: loadStock };
let currentTab = "resumen";

function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  history.replaceState(null, "", `#${name}`);
  loaders[name]().catch((err) => toast(err.message));
}

function bindEvents() {
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) showTab(tab.dataset.tab);
  });
  $("#refresh").addEventListener("click", () => showTab(currentTab));

  $("#statusFilter").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-status]");
    if (!chip) return;
    document.querySelectorAll("#statusFilter .filter").forEach((c) => c.classList.toggle("active", c === chip));
    orderFilter.status = chip.dataset.status;
    loadOrders().catch((err) => toast(err.message));
  });
  $("#orderSearch").addEventListener("input", (e) => debounce(() => {
    orderFilter.q = e.target.value.trim();
    loadOrders().catch((err) => toast(err.message));
  }));
  $("#userSearch").addEventListener("input", (e) => debounce(() => loadUsers(e.target.value.trim()).catch((err) => toast(err.message))));

  document.addEventListener("change", async (e) => {
    if (e.target.matches("[data-status-for]")) changeStatus(e.target);
    if (e.target.matches("[data-coupon-toggle]")) {
      const c = couponsCache.find((x) => x.code === e.target.closest("tr").dataset.coupon);
      try {
        await saveCoupon(c, { active: e.target.checked });
        toast(`${c.code} ${e.target.checked ? "activado" : "pausado"}`);
        loadCoupons();
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(err.message);
      }
    }
  });

  $("#couponForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button[type=submit]");
    const errorEl = f.querySelector(".form-error");
    const data = Object.fromEntries(new FormData(f));
    errorEl.textContent = "";
    btn.disabled = true;
    try {
      await saveCoupon({
        ...data,
        isNew: !f.dataset.editing,
        oncePerUser: f.elements.oncePerUser.checked,
        active: f.elements.active.checked,
      });
      toast(`✔ Cupón ${data.code.toUpperCase()} guardado`);
      resetCouponForm();
      loadCoupons();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $("#couponCancel").addEventListener("click", resetCouponForm);

  $("#deliverySettings").addEventListener("submit", saveDelivery);

  $("#stockBody").addEventListener("click", onStockClick);
  $("#stockBody").addEventListener("change", (e) => {
    if (!e.target.matches("[data-stock-alert]")) return;
    const row = e.target.closest("[data-stock]");
    stockAction(row, { action: "stock-alert", lowAlert: e.target.value }, "Alerta actualizada");
  });

  $("#routeFilter").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-route]");
    if (!chip) return;
    document.querySelectorAll("#routeFilter .filter").forEach((c) => c.classList.toggle("active", c === chip));
    routeFilter = chip.dataset.route;
    renderRoute();
  });
  $("#routeZone").addEventListener("change", renderRoute);
  $("#markSent").addEventListener("click", markAllSent);
  $("#printRoute").addEventListener("click", printRoute);
  $("#routeSheet").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-route-status]");
    if (btn) routeStatus(btn);
  });

  $("#cashDay").addEventListener("change", () => loadCash().catch((err) => toast(err.message)));
  $("#cashClose").addEventListener("submit", closeCash);
  $("#cashClose").elements.counted.addEventListener("input", renderCashDiff);
  $("#addZone").addEventListener("click", () => {
    $("#zonesList").insertAdjacentHTML("beforeend", zoneRow());
    $("#zonesList .zone-row:last-child .zone-name").focus();
  });
  $("#zonesList").addEventListener("click", (e) => {
    if (e.target.closest("[data-remove-zone]")) e.target.closest(".zone-row").remove();
  });
  document.addEventListener("click", (e) => {
    const notify = e.target.closest("[data-notify]");
    if (notify) notifyCustomer(Number(notify.dataset.notify));
    const role = e.target.closest("[data-role-for]");
    if (role) changeRole(role);
    const save = e.target.closest("[data-save-product]");
    if (save) saveProduct(save.closest("tr"));
    const reset = e.target.closest("[data-reset-product]");
    if (reset) saveProduct(reset.closest("tr"), true);
    const resetLink = e.target.closest("[data-reset-for]");
    if (resetLink) sendResetLink(resetLink);
    const editC = e.target.closest("[data-coupon-edit]");
    if (editC) editCoupon(editC.closest("tr").dataset.coupon);
    const delC = e.target.closest("[data-coupon-delete]");
    if (delC) {
      const code = delC.closest("tr").dataset.coupon;
      if (confirm(`¿Borrar el cupón ${code}? Los pedidos que ya lo usaron no cambian.`)) {
        api("admin", { method: "POST", body: { action: "coupon-delete", code } })
          .then(() => { toast(`Cupón ${code} borrado`); loadCoupons(); })
          .catch((err) => toast(err.message));
      }
    }
  });
}

(async function init() {
  try {
    const { user } = await api("auth");
    if (!user) return location.replace("/#ingresar");
    if (user.role !== "admin") {
      $("#loading").innerHTML = `No tenés permisos para ver esta página.<br /><br /><a href="/" class="btn btn--primary">Volver a la tienda</a>`;
      return;
    }
    me = user;
    $("#adminWho").textContent = `Sesión de ${user.name} (${user.email})`;
    bindEvents();
    $("#loading").hidden = true;
    $("#adminApp").hidden = false;
    const initial = location.hash.slice(1);
    showTab(loaders[initial] ? initial : "resumen");
    if (initial !== "resumen" && initial in loaders) loadStats().catch(() => {});
    if (initial !== "stock") api("admin?view=stock").then((d) => updateStockBadge(d.products)).catch(() => {});
  } catch (err) {
    $("#loading").textContent = "No pudimos cargar el panel. " + err.message;
  }
})();

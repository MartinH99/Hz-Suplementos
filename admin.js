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
        <b>${esc(o.shipName)}</b> · ${esc(o.email)}${o.shipPhone ? ` · ${esc(o.shipPhone)}` : ""}
        <div>${o.shipAddress ? `📦 ${esc(o.shipAddress)}` : "📦 Sin dirección cargada"}</div>
      </div>
      <ul class="order__items">
        ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}
        ${o.discount ? `<li class="order__discount"><span>🎟️ Cupón ${esc(o.couponCode)}</span><span>-${money(o.discount)}</span></li>` : ""}
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
  const text = `¡Hola ${o.shipName.split(" ")[0]}! Te escribimos de HZ Suplementos por tu pedido ${code(o.id)}.\n\n${STATUS_MSG[o.status]}`;
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
const loaders = { resumen: loadStats, pedidos: loadOrders, clientes: () => loadUsers($("#userSearch").value), productos: loadProducts, cupones: loadCoupons };
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
  } catch (err) {
    $("#loading").textContent = "No pudimos cargar el panel. " + err.message;
  }
})();

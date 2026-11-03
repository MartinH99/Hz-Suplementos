// Página "Mi cuenta": usa api(), money(), esc(), toast(), cart y el catálogo de script.js
const STATUS_LABEL = { pendiente: "Pendiente", confirmado: "Confirmado", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };
const orderCode = (id) => `#HZ-${String(id).padStart(5, "0")}`;
const parseDate = (s) => new Date(s.replace(" ", "T") + "Z");
const fmtDate = (s) => parseDate(s).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

let user = null;
let orders = [];
let favIds = [];

function updateCartCount() {
  $("#cartCount").textContent = Object.values(cart).reduce((s, n) => s + n, 0);
}

function renderHeader(stats) {
  $("#helloName").textContent = user.name.split(" ")[0].toUpperCase();
  $("#helloEmail").textContent = user.email;
  $("#adminLink").hidden = user.role !== "admin";
  $("#statOrders").textContent = stats.orders;
  $("#statSpent").textContent = money(stats.spent);
  $("#statFavs").textContent = favIds.length;
  $("#statSince").textContent = parseDate(user.createdAt).toLocaleDateString("es-AR", { month: "short", year: "numeric" });
}

function renderOrders() {
  const list = $("#ordersList");
  if (!orders.length) {
    list.innerHTML = `<div class="empty"><span>📦</span>Todavía no hiciste ningún pedido.<br /><a href="/#productos" class="btn btn--primary">Ver productos</a></div>`;
    return;
  }
  list.innerHTML = orders.map((o) => `
    <article class="order">
      <div class="order__head">
        <div>
          <div class="order__id">${orderCode(o.id)}</div>
          <div class="order__date">${fmtDate(o.createdAt)}</div>
        </div>
        <span class="status status--${o.status}">${STATUS_LABEL[o.status] || esc(o.status)}</span>
      </div>
      <ul class="order__items">
        ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}
        ${o.discount ? `<li class="order__discount"><span>🎟️ Cupón ${esc(o.couponCode)}</span><span>-${money(o.discount)}</span></li>` : ""}
        ${o.deliveryMethod === "envio" ? `<li><span>🚚 Envío${o.zone ? ` (${esc(o.zone)})` : ""}</span><span>${o.shipping ? money(o.shipping) : "Gratis"}</span></li>` : ""}
      </ul>
      <div class="order__meta">
        ${o.deliveryMethod === "retiro" ? "<span>🏪 Retiro en el local</span>" : o.shipAddress ? `<span>📍 ${esc(o.shipAddress)}</span>` : ""}
        ${o.timeSlot ? `<span>🕐 ${esc(o.timeSlot)}</span>` : ""}
        ${o.deliveryMethod ? `<span>💵 Efectivo${o.cashWith && o.cashWith > o.total ? ` · pagás con ${money(o.cashWith)} (vuelto ${money(o.cashWith - o.total)})` : ""}</span>` : ""}
        ${o.notes ? `<span>📝 ${esc(o.notes)}</span>` : ""}
      </div>
      <div class="order__foot">
        <span class="order__total">${money(o.total)}</span>
        <div class="order__actions">
          <button class="btn btn--primary btn--sm" data-reorder="${o.id}">Repetir pedido</button>
          <button class="btn btn--ghost btn--sm" data-ask="${o.id}">Consultar</button>
          ${o.status === "pendiente" ? `<button class="btn btn--danger btn--sm" data-cancel="${o.id}">Cancelar</button>` : ""}
        </div>
      </div>
    </article>`).join("");
}

function renderFavorites() {
  const list = $("#favsList");
  const items = favIds.map(findItem).filter(Boolean);
  $("#statFavs").textContent = items.length;
  if (!items.length) {
    list.innerHTML = `<div class="empty" style="grid-column:1/-1"><span>❤️</span>Tocá el corazón de un producto para guardarlo acá.<br /><a href="/#productos" class="btn btn--primary">Explorar productos</a></div>`;
    return;
  }
  list.innerHTML = items.map((p) => `
    <div class="fav">
      <div class="fav__thumb" style="background:${p.tint}">${p.icon}</div>
      <div class="fav__info"><h4>${esc(p.name)}</h4><span>${money(p.price)}</span></div>
      <div class="fav__actions">
        <button class="icon-btn" data-fav-add="${p.id}" aria-label="Agregar ${esc(p.name)} al carrito">+</button>
        <button class="icon-btn" data-fav-remove="${p.id}" aria-label="Quitar ${esc(p.name)} de favoritos">✕</button>
      </div>
    </div>`).join("");
}

function fillProfileForm() {
  const f = $("#profileForm");
  for (const key of ["name", "email", "phone", "address", "city", "province", "zip", "goal"]) f.elements[key].value = user[key] || "";
  f.elements.newsletter.checked = user.newsletter;
}

async function refreshStats() {
  const { stats } = await api("profile");
  renderHeader(stats);
}

// Envío de formularios con manejo de errores común
function onSubmit(form, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const errorEl = form.querySelector(".form-error");
    const okEl = form.querySelector(".form-ok");
    errorEl.textContent = "";
    if (okEl) okEl.textContent = "";
    btn.disabled = true;
    try {
      const msg = await fn(Object.fromEntries(new FormData(form)));
      if (okEl && msg) okEl.textContent = msg;
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function bindEvents() {
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `panel-${tab.dataset.tab}`));
    history.replaceState(null, "", `#${tab.dataset.tab}`);
  });

  $("#logout").addEventListener("click", async () => {
    await api("auth", { method: "POST", body: { action: "logout" } }).catch(() => {});
    location.href = "/";
  });

  document.addEventListener("click", async (e) => {
    const reorder = e.target.closest("[data-reorder]");
    if (reorder) {
      const order = orders.find((o) => o.id === Number(reorder.dataset.reorder));
      const available = order.items.filter((i) => findItem(i.productId));
      available.forEach((i) => (cart[i.productId] = (cart[i.productId] || 0) + i.qty));
      saveCart();
      if (available.length < order.items.length) toast("Algunos productos ya no están disponibles");
      location.href = "/#carrito";
    }

    const ask = e.target.closest("[data-ask]");
    if (ask) {
      const text = `¡Hola HZ Suplementos! Quería consultar por mi pedido ${orderCode(ask.dataset.ask)}.`;
      window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    }

    const cancel = e.target.closest("[data-cancel]");
    if (cancel && confirm(`¿Cancelar el pedido ${orderCode(cancel.dataset.cancel)}?`)) {
      cancel.disabled = true;
      try {
        await api("orders", { method: "PATCH", body: { id: Number(cancel.dataset.cancel), action: "cancel" } });
        orders.find((o) => o.id === Number(cancel.dataset.cancel)).status = "cancelado";
        renderOrders();
        refreshStats();
        toast("Pedido cancelado");
      } catch (err) {
        cancel.disabled = false;
        toast(err.message);
      }
    }

    const favAdd = e.target.closest("[data-fav-add]");
    if (favAdd) {
      cart[favAdd.dataset.favAdd] = (cart[favAdd.dataset.favAdd] || 0) + 1;
      saveCart();
      updateCartCount();
      toast(`✔ ${findItem(favAdd.dataset.favAdd).name} agregado al carrito`);
    }

    const favRemove = e.target.closest("[data-fav-remove]");
    if (favRemove) {
      try {
        await api("favorites", { method: "POST", body: { productId: favRemove.dataset.favRemove } });
        favIds = favIds.filter((id) => id !== favRemove.dataset.favRemove);
        renderFavorites();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  onSubmit($("#profileForm"), async (data) => {
    ({ user } = await api("profile", { method: "PUT", body: { ...data, newsletter: data.newsletter === "on" } }));
    $("#helloName").textContent = user.name.split(" ")[0].toUpperCase();
    return "✔ Datos guardados";
  });

  onSubmit($("#passwordForm"), async (data) => {
    if (data.password !== data.confirm) throw new Error("Las contraseñas nuevas no coinciden");
    await api("auth", { method: "POST", body: { action: "password", current: data.current, password: data.password } });
    $("#passwordForm").reset();
    return "✔ Contraseña actualizada";
  });

  onSubmit($("#deleteForm"), async (data) => {
    if (!confirm("¿Seguro que querés eliminar tu cuenta? No se puede deshacer.")) return;
    await api("profile", { method: "DELETE", body: { password: data.password } });
    location.href = "/";
  });
}

(async function init() {
  updateCartCount();
  try {
    await loadCatalog();
    const [{ user: me, stats }, ordersRes, favRes] = await Promise.all([api("profile"), api("orders"), api("favorites")]);
    user = me;
    orders = ordersRes.orders;
    favIds = favRes.favorites;
    renderHeader(stats);
    renderOrders();
    renderFavorites();
    fillProfileForm();
    bindEvents();
    $("#loading").hidden = true;
    $("#accountApp").hidden = false;
    const tab = document.querySelector(`[data-tab="${location.hash.slice(1)}"]`);
    if (tab) tab.click();
  } catch (err) {
    if (err.status === 401) location.replace("/#ingresar");
    else $("#loading").textContent = "No pudimos cargar tu cuenta. " + err.message;
  }
})();

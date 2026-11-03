// Utilidades compartidas con la página de cuenta (cuenta.html)
const money = (n) => "$" + n.toLocaleString("es-AR");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WHATSAPP_NUMBER = "5492236945946";
const CAT_LABEL = { proteinas: "Proteínas", aminoacidos: "Aminoácidos", creatina: "Creatina", preentreno: "Pre-entreno", vitaminas: "Vitaminas" };

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "No se pudo completar la acción"), { status: res.status });
  return data;
}

let PRODUCTS = [];
let COMBOS = {};
async function loadCatalog() {
  // Precios y productos activos vienen de la base (editables en el panel admin);
  // si la API no responde, usamos el catálogo base del repo.
  const data = await api("catalog").catch(() => fetch("/data/catalog.json").then((r) => r.json()));
  PRODUCTS = data.products;
  COMBOS = Object.fromEntries(data.combos.map((c) => [c.id, c]));
  DELIVERY = data.delivery || DELIVERY;
}

// Opciones de entrega (editables en el panel admin → Entregas)
let DELIVERY = { pickup: { enabled: false, address: "", hours: "" }, zones: [], freeShippingFrom: null, timeSlots: [] };

// Textos de la landing que dependen de la configuración de entregas
function renderDeliveryTexts() {
  const free = DELIVERY.freeShippingFrom;
  document.querySelectorAll(".js-free-shipping").forEach((el) => {
    el.hidden = free == null;
    if (free != null) el.innerHTML = free === 0 ? "🚚 ENVÍO GRATIS" : `🚚 ENVÍO GRATIS EN COMPRAS +${money(free)}`;
  });
}

// Actualiza precios de los combos (escritos en el HTML) y oculta los pausados
function renderCombos() {
  document.querySelectorAll(".combo").forEach((card) => {
    const combo = COMBOS[card.querySelector(".add")?.dataset.id];
    card.hidden = !combo;
    if (!combo) return;
    card.querySelector(".combo__price").innerHTML = `${combo.old ? `<s>${money(combo.old)}</s>` : ""}<strong>${money(combo.price)}</strong>`;
  });
}
const findItem = (id) => PRODUCTS.find((p) => p.id === id) || COMBOS[id];

// Toast
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// Carrito (persistido en localStorage, también lo usa "Repetir pedido" en cuenta.html)
let cart = {};
try { cart = JSON.parse(localStorage.getItem("hz-cart")) || {}; } catch { cart = {}; }
function saveCart() {
  try { localStorage.setItem("hz-cart", JSON.stringify(cart)); } catch {}
}

// ===== Sesión de usuario =====
let currentUser = null;
let favorites = new Set();

async function loadSession() {
  try {
    currentUser = (await api("auth")).user;
    favorites = new Set(currentUser ? (await api("favorites")).favorites : []);
  } catch {
    currentUser = null;
  }
  renderAccountButton();
}

function renderAccountButton() {
  const btn = $("#accountBtn");
  if (!btn) return;
  btn.classList.toggle("logged", !!currentUser);
  btn.querySelector(".account-btn__initial").textContent = currentUser ? currentUser.name.trim()[0].toUpperCase() : "";
  btn.setAttribute("aria-label", currentUser ? "Mi cuenta" : "Ingresar");
  const hint = $("#cartHint");
  if (hint) {
    hint.innerHTML = currentUser
      ? `Pedido a nombre de <b>${esc(currentUser.name)}</b>. Se guarda en <a href="/cuenta.html">tu historial</a>.`
      : `<a href="#" data-open-auth="login">Ingresá</a> o <a href="#" data-open-auth="register">creá tu cuenta</a> para guardar tus pedidos.`;
  }
}

// ===== Modal de ingreso / registro =====
const authModal = $("#authModal");

function openAuth(tab = "login", message = "") {
  if (!authModal) return;
  setAuthTab(tab);
  $("#authMessage").textContent = message;
  $("#authMessage").hidden = !message;
  authModal.classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => authModal.querySelector(`#${tab}Form input`)?.focus(), 50);
}
function closeAuth() {
  authModal?.classList.remove("open");
  document.body.style.overflow = "";
}
function setAuthTab(tab) {
  authModal.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === tab));
  $("#loginForm").hidden = tab !== "login";
  $("#registerForm").hidden = tab !== "register";
  authModal.querySelectorAll(".form-error").forEach((e) => (e.textContent = ""));
}

async function submitAuth(form, action) {
  const btn = form.querySelector("button[type=submit]");
  const errorEl = form.querySelector(".form-error");
  const data = Object.fromEntries(new FormData(form));
  errorEl.textContent = "";
  btn.disabled = true;
  try {
    const { user } = await api("auth", { method: "POST", body: { action, ...data, newsletter: data.newsletter === "on" } });
    currentUser = user;
    favorites = new Set((await api("favorites")).favorites);
    form.reset();
    closeAuth();
    renderAccountButton();
    renderProducts(activeFilter);
    renderCart();
    // Si había escrito un cupón antes de ingresar, lo aplicamos
    if ($("#couponInput")?.value.trim()) {
      toggleCart(true);
      applyCoupon();
    }
    toast(action === "register" ? `🎉 ¡Bienvenido/a al Team HZ, ${user.name.split(" ")[0]}!` : `👋 ¡Hola de nuevo, ${user.name.split(" ")[0]}!`);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

if (authModal) {
  authModal.addEventListener("click", (e) => {
    if (e.target === authModal || e.target.closest("[data-close-auth]")) closeAuth();
    const tab = e.target.closest("[data-auth-tab]");
    if (tab) setAuthTab(tab.dataset.authTab);
  });
  $("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); submitAuth(e.target, "login"); });
  $("#registerForm").addEventListener("submit", (e) => { e.preventDefault(); submitAuth(e.target, "register"); });
}

// ===== Landing: productos, filtros, carrito =====
const grid = $("#products");
let activeFilter = "all";

function renderProducts(filter = "all") {
  if (!grid) return;
  activeFilter = filter;
  const list = filter === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.cat === filter);
  grid.innerHTML = list.map((p, i) => `
    <article class="product" style="animation-delay:${i * 50}ms">
      <div class="product__img" style="--tint:${p.tint}">
        ${p.badge ? `<span class="badge ${p.badge === "Nuevo" ? "badge--new" : ""}">${p.badge}</span>` : ""}
        <button class="fav-btn ${favorites.has(p.id) ? "active" : ""}" data-fav="${p.id}" aria-label="Agregar ${p.name} a favoritos" aria-pressed="${favorites.has(p.id)}">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.4h2C13.8 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>
        </button>
        <div class="jar">
          <div class="jar__lid"></div>
          <div class="jar__body">
            <span class="jar__brand">HZ</span>
            <span class="jar__name">${p.short}</span>
          </div>
        </div>
      </div>
      <div class="product__body">
        <span class="product__cat">${CAT_LABEL[p.cat]}</span>
        <h3 class="product__name">${p.name}</h3>
        <p class="product__desc">${p.desc}</p>
        <div class="product__rating">${"★".repeat(Math.round(p.rating))}<span>${p.rating} (${p.reviews})</span></div>
        <div class="product__foot">
          <div class="price">${p.old ? `<s>${money(p.old)}</s>` : ""}<strong>${money(p.price)}</strong></div>
          <button class="add-btn add" data-id="${p.id}" aria-label="Agregar ${p.name} al carrito">+</button>
        </div>
      </div>
    </article>`).join("");
}

function setFilter(filter) {
  document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === filter));
  renderProducts(filter);
}

async function toggleFavorite(btn) {
  if (!currentUser) return openAuth("login", "Ingresá para guardar tus productos favoritos ❤️");
  btn.disabled = true;
  try {
    const { favorite } = await api("favorites", { method: "POST", body: { productId: btn.dataset.fav } });
    favorite ? favorites.add(btn.dataset.fav) : favorites.delete(btn.dataset.fav);
    btn.classList.toggle("active", favorite);
    btn.setAttribute("aria-pressed", favorite);
    toast(favorite ? "❤️ Agregado a favoritos" : "Quitado de favoritos");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===== Carrito en 2 pasos: 1) productos y cupón · 2) entrega y pago en efectivo =====
let checkoutStep = 1;
const isFreeShipping = (subtotal) => DELIVERY.freeShippingFrom != null && subtotal >= DELIVERY.freeShippingFrom;

function deliveryChoice() {
  const f = $("#deliveryForm");
  if (!f) return {};
  const v = (n) => (f.elements[n]?.value || "").trim();
  return {
    method: f.elements.method.value || "envio",
    zoneId: v("zoneId"),
    address: v("address"),
    timeSlot: v("timeSlot"),
    cashWith: v("cashWith"),
    phone: v("phone"),
    name: v("name"),
    notes: v("notes"),
  };
}

// Totales que ve el cliente (el servidor los vuelve a calcular al guardar el pedido)
function computeTotals() {
  const ids = Object.keys(cart).filter((id) => findItem(id));
  const count = ids.reduce((s, id) => s + cart[id], 0);
  const subtotal = ids.reduce((s, id) => s + findItem(id).price * cart[id], 0);
  const discount = couponDiscount(subtotal);
  let shipping = null; // null = todavía no eligió zona
  if (checkoutStep === 2) {
    const d = deliveryChoice();
    const zone = DELIVERY.zones.find((z) => z.id === d.zoneId);
    if (d.method === "retiro") shipping = 0;
    else if (zone) shipping = isFreeShipping(subtotal) ? 0 : zone.price;
  }
  return { ids, count, subtotal, discount, shipping, total: subtotal - discount + (shipping || 0) };
}

function renderCart() {
  if (!$("#cartItems")) return;
  const { ids, count, subtotal, discount, shipping, total } = computeTotals();
  $("#cartCount").textContent = count;
  $("#cartTotal").textContent = money(total);
  renderCoupon(subtotal, discount);
  $("#subtotalLine").hidden = !(discount || checkoutStep === 2);
  $("#cartSubtotal").textContent = money(subtotal);
  $("#shippingLine").hidden = checkoutStep !== 2;
  $("#cartShipping").textContent = shipping == null ? "Elegí tu zona" : shipping === 0 ? "Gratis" : money(shipping);

  // Progreso hacia el envío gratis
  const free = DELIVERY.freeShippingFrom;
  const progress = $("#freeProgress");
  progress.hidden = free == null || !subtotal || free === 0;
  if (!progress.hidden) {
    progress.innerHTML = subtotal >= free
      ? "🎉 ¡Tu compra tiene <b>envío gratis</b>!"
      : `🚚 Te faltan <b>${money(free - subtotal)}</b> para el envío gratis`;
  }

  // Vuelto del pago en efectivo
  const cash = Number(deliveryChoice().cashWith);
  const hint = $("#changeHint");
  if (hint) {
    hint.className = "change-hint" + (cash && cash < total ? " change-hint--error" : "");
    hint.textContent = !cash ? "" : cash < total ? `Tiene que ser al menos ${money(total)}` : cash === total ? "Pago justo 👌" : `Tu vuelto: ${money(cash - total)}`;
  }

  $("#cartItems").innerHTML = ids.length
    ? ids.map((id) => {
        const item = findItem(id);
        return `
        <div class="cart-item">
          <div class="cart-item__thumb">${item.icon}</div>
          <div class="cart-item__info">
            <h4>${item.name}</h4>
            <span>${money(item.price * cart[id])}</span>
            <div class="qty">
              <button data-qty="-1" data-id="${id}" aria-label="Quitar uno">−</button>
              <b>${cart[id]}</b>
              <button data-qty="1" data-id="${id}" aria-label="Agregar uno">+</button>
            </div>
          </div>
        </div>`;
      }).join("")
    : `<div class="cart__empty"><span>🛒</span>Tu carrito está vacío</div>`;
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  renderCart();
  const badge = $("#cartCount");
  badge.classList.remove("bump");
  void badge.offsetWidth;
  badge.classList.add("bump");
  toast(`✔ ${findItem(id).name} agregado al carrito`);
}

const toggleCart = (open) => {
  if (open && checkoutStep !== 1) setStep(1);
  $("#cart")?.classList.toggle("open", open);
  $("#overlay")?.classList.toggle("open", open);
};

function setStep(step) {
  checkoutStep = step;
  $("#cartItems").hidden = step !== 1;
  $("#deliveryForm").hidden = step !== 2;
  $("#cartStep1").hidden = step !== 1;
  $("#cartBack").hidden = step !== 2;
  $("#cartTitle").textContent = step === 1 ? "TU CARRITO" : "ENTREGA Y PAGO";
  $("#checkout").textContent = step === 1 ? "Continuar" : "Confirmar pedido por WhatsApp";
  if (step === 2) prepareDeliveryForm();
  renderCart();
}

// Completa el formulario de entrega con la configuración y los datos del perfil
function prepareDeliveryForm() {
  const f = $("#deliveryForm");
  const { subtotal } = computeTotals();
  const free = isFreeShipping(subtotal);
  const selectedZone = f.elements.zoneId.value;
  $("#zoneSelect").innerHTML = `<option value="">Elegí tu zona</option>` +
    DELIVERY.zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name)} — ${free ? "Gratis" : money(z.price)}</option>`).join("");
  f.elements.zoneId.value = selectedZone;
  const prices = DELIVERY.zones.map((z) => z.price);
  $("#shippingFromText").textContent = !prices.length ? "A coordinar" : free ? "¡Gratis en tu compra!" : `Desde ${money(Math.min(...prices))}`;

  const selectedSlot = f.elements.timeSlot.value;
  $("#slotSelect").innerHTML = `<option value="">Sin preferencia</option>` +
    DELIVERY.timeSlots.map((s) => `<option>${esc(s)}</option>`).join("");
  f.elements.timeSlot.value = selectedSlot;
  $("#slotField").hidden = !DELIVERY.timeSlots.length;

  $("#pickupOption").hidden = !DELIVERY.pickup.enabled;
  if (!DELIVERY.pickup.enabled) f.elements.method.value = "envio";
  if (!DELIVERY.zones.length && DELIVERY.pickup.enabled) f.elements.method.value = "retiro";
  $("#methodOptions").querySelector('input[value="envio"]').closest(".option").hidden = !DELIVERY.zones.length;
  $("#pickupInfo").innerHTML = `📍 ${DELIVERY.pickup.address ? esc(DELIVERY.pickup.address) : "Te pasamos la dirección exacta por WhatsApp"}` +
    (DELIVERY.pickup.hours ? `<br />🕐 ${esc(DELIVERY.pickup.hours)}` : "");

  f.querySelector(".guest-only").hidden = !!currentUser;
  if (currentUser) {
    if (!f.elements.phone.value) f.elements.phone.value = currentUser.phone || "";
    if (!f.elements.address.value) f.elements.address.value = [currentUser.address, currentUser.city].filter(Boolean).join(", ");
  }
  updateMethodUI();
}

function updateMethodUI() {
  const retiro = $("#deliveryForm").elements.method.value === "retiro";
  $("#shippingFields").hidden = retiro;
  $("#pickupInfo").hidden = !retiro;
}

// ===== Cupones (requieren cuenta; el servidor recalcula el descuento al crear el pedido) =====
let appliedCoupon = null;
try { appliedCoupon = JSON.parse(localStorage.getItem("hz-coupon")); } catch {}

function setCoupon(coupon) {
  appliedCoupon = coupon;
  try { coupon ? localStorage.setItem("hz-coupon", JSON.stringify(coupon)) : localStorage.removeItem("hz-coupon"); } catch {}
  renderCart();
}

function couponDiscount(subtotal) {
  const c = appliedCoupon;
  if (!c || !currentUser || subtotal < c.minTotal) return 0;
  return c.type === "percent" ? Math.round((subtotal * c.value) / 100) : Math.min(c.value, subtotal);
}

function renderCoupon(subtotal, discount) {
  const active = !!(appliedCoupon && currentUser);
  $("#couponForm").hidden = active;
  $("#couponApplied").hidden = !active;
  $("#discountLine").hidden = !discount;
  $("#cartDiscount").textContent = "-" + money(discount);
  if (active) {
    const c = appliedCoupon;
    $("#couponCode").textContent = c.code;
    $("#couponDesc").textContent = subtotal && subtotal < c.minTotal
      ? `(mínimo ${money(c.minTotal)})`
      : c.type === "percent" ? `${c.value}% OFF` : `${money(c.value)} OFF`;
  }
}

async function applyCoupon() {
  const code = $("#couponInput").value.trim();
  if (!code) return;
  if (!currentUser) {
    toggleCart(false);
    return openAuth("login", "Ingresá o creá tu cuenta para usar tu cupón 🎟️");
  }
  const items = Object.keys(cart).filter((id) => findItem(id)).map((id) => ({ id, qty: cart[id] }));
  if (!items.length) return toast("Agregá productos antes de aplicar el cupón");
  const btn = $("#couponForm button");
  btn.disabled = true;
  try {
    const { coupon, discount } = await api("coupons", { method: "POST", body: { code, items } });
    $("#couponInput").value = "";
    setCoupon(coupon);
    toast(`🎟️ Cupón ${coupon.code} aplicado: ahorrás ${money(discount)}`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// Mensaje de WhatsApp con el pedido completo (s = resumen ya calculado)
function buildOrderMessage(s) {
  const msg = [
    s.orderId ? `¡Hola HZ Suplementos! 👋 Quiero confirmar mi pedido *#HZ-${String(s.orderId).padStart(5, "0")}*:` : "¡Hola HZ Suplementos! 👋 Quiero hacer este pedido:",
    "",
    ...s.lines.map((l) => `• ${l.qty} x ${l.name} — ${money(l.price * l.qty)}`),
    "",
    `Subtotal: ${money(s.subtotal)}`,
  ];
  if (s.discount) msg.push(`🎟️ Cupón ${s.couponCode}: -${money(s.discount)}`);
  msg.push(s.method === "retiro" ? "🏪 Retiro en el local" : `🚚 Envío${s.zone ? ` (${s.zone})` : ""}: ${s.shipping ? money(s.shipping) : "Gratis"}`);
  msg.push(`*Total: ${money(s.total)}*`, "");
  if (s.name) msg.push(`👤 ${s.name}`);
  if (s.phone) msg.push(`📞 ${s.phone}`);
  if (s.method !== "retiro") msg.push(`📍 ${s.address}`);
  if (s.timeSlot) msg.push(`🕐 ${s.timeSlot}`);
  msg.push(s.cashWith && s.cashWith > s.total
    ? `💵 Pago en efectivo con ${money(s.cashWith)} (vuelto: ${money(s.cashWith - s.total)})`
    : "💵 Pago en efectivo (justo)");
  if (s.notes) msg.push(`📝 ${s.notes}`);
  msg.push("", "¿Me confirman el pedido? ¡Gracias!");
  return msg.join("\n");
}

// Valida el paso 2 en el navegador para dar errores claros (el servidor valida de nuevo)
function deliveryError(d, total) {
  const f = $("#deliveryForm");
  if (!currentUser && !d.name) return [f.elements.name, "Ingresá tu nombre"];
  if (d.method === "envio") {
    if (DELIVERY.zones.length && !d.zoneId) return [f.elements.zoneId, "Elegí tu zona de envío"];
    if (d.address.length < 5) return [f.elements.address, "Ingresá la dirección de entrega"];
  }
  if (d.cashWith && Number(d.cashWith) < total) return [f.elements.cashWith, `El monto con el que pagás tiene que ser de al menos ${money(total)}`];
  return null;
}

async function onCheckoutClick() {
  const totals = computeTotals();
  if (!totals.ids.length) return toast("Agregá productos para continuar");
  if (checkoutStep === 1) return setStep(2);

  const d = deliveryChoice();
  const error = deliveryError(d, totals.total);
  if (error) {
    error[0].focus();
    return toast(error[1]);
  }
  const btn = $("#checkout");
  const zone = DELIVERY.zones.find((z) => z.id === d.zoneId);
  let summary = {
    lines: totals.ids.map((id) => ({ name: findItem(id).name, price: findItem(id).price, qty: cart[id] })),
    subtotal: totals.subtotal, discount: totals.discount, couponCode: appliedCoupon?.code,
    shipping: totals.shipping || 0, total: totals.total, method: d.method, zone: zone?.name || "",
    name: currentUser?.name || d.name, phone: d.phone, address: d.address, timeSlot: d.timeSlot,
    cashWith: Number(d.cashWith) || null, notes: d.notes,
  };

  // Abrimos la pestaña ya (dentro del clic) para que el navegador no la bloquee
  const win = window.open("", "_blank");
  if (currentUser) {
    btn.disabled = true;
    try {
      const { order } = await api("orders", {
        method: "POST",
        body: {
          items: totals.ids.map((id) => ({ id, qty: cart[id] })),
          notes: d.notes,
          coupon: appliedCoupon?.code,
          delivery: { method: d.method, zoneId: d.zoneId, address: d.address, timeSlot: d.timeSlot, cashWith: d.cashWith, phone: d.phone },
        },
      });
      summary = {
        ...summary, orderId: order.id, lines: order.items, subtotal: order.subtotal, discount: order.discount,
        couponCode: order.couponCode, shipping: order.shipping, total: order.total, zone: order.zone, cashWith: order.cashWith,
      };
    } catch (err) {
      win?.close();
      return toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildOrderMessage(summary))}`;
  if (win) {
    win.opener = null;
    win.location.href = url;
  } else {
    location.href = url;
  }

  if (summary.orderId) {
    cart = {};
    saveCart();
    const f = $("#deliveryForm");
    f.elements.notes.value = "";
    f.elements.cashWith.value = "";
    setCoupon(null);
    toggleCart(false);
    toast(`📲 Pedido #HZ-${String(summary.orderId).padStart(5, "0")} guardado. ¡Terminá de enviarlo por WhatsApp!`);
  } else {
    toast("📲 Abriendo WhatsApp con tu pedido...");
  }
}

function initLanding() {
  $("#filters").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (btn) setFilter(btn.dataset.filter);
  });

  // Las tarjetas de categoría filtran y llevan a productos
  document.querySelectorAll(".cat").forEach((c) =>
    c.addEventListener("click", () => {
      setFilter(c.dataset.filter);
      $("#productos").scrollIntoView({ behavior: "smooth" });
    })
  );

  document.addEventListener("click", (e) => {
    const add = e.target.closest(".add");
    if (add) addToCart(add.dataset.id);

    const fav = e.target.closest("[data-fav]");
    if (fav) toggleFavorite(fav);

    const authLink = e.target.closest("[data-open-auth]");
    if (authLink) {
      e.preventDefault();
      toggleCart(false);
      openAuth(authLink.dataset.openAuth);
    }

    const q = e.target.closest("[data-qty]");
    if (q) {
      const id = q.dataset.id;
      cart[id] += Number(q.dataset.qty);
      if (cart[id] <= 0) delete cart[id];
      saveCart();
      renderCart();
    }
  });

  $("#accountBtn").addEventListener("click", () => (currentUser ? (location.href = "/cuenta.html") : openAuth("login")));
  $("#cartOpen").addEventListener("click", () => toggleCart(true));
  $("#cartClose").addEventListener("click", () => toggleCart(false));
  $("#overlay").addEventListener("click", () => toggleCart(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { toggleCart(false); closeAuth(); }
  });
  $("#checkout").addEventListener("click", onCheckoutClick);
  $("#cartBack").addEventListener("click", () => setStep(1));
  $("#deliveryForm").addEventListener("input", (e) => {
    if (e.target.name === "method") updateMethodUI();
    renderCart();
  });
  $("#deliveryForm").addEventListener("submit", (e) => { e.preventDefault(); onCheckoutClick(); });
  $("#couponForm").addEventListener("submit", (e) => { e.preventDefault(); applyCoupon(); });
  $("#couponRemove").addEventListener("click", () => setCoupon(null));

  // Recuperar contraseña: el cliente pide el link por WhatsApp y el admin se lo envía desde el panel
  $("#forgotPassword").addEventListener("click", () => {
    const email = $("#loginForm").elements.email.value.trim();
    const text = `¡Hola HZ Suplementos! Me olvidé la contraseña de mi cuenta${email ? ` (${email})` : ""}. ¿Me pueden enviar un link para crear una nueva?`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  });

  // Menú móvil
  const burger = $("#burger");
  const nav = $("#nav");
  burger.addEventListener("click", () => {
    burger.classList.toggle("open");
    nav.classList.toggle("open");
  });
  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      burger.classList.remove("open");
      nav.classList.remove("open");
    }
  });

  // Header con borde al hacer scroll
  window.addEventListener("scroll", () => $("#header").classList.toggle("scrolled", scrollY > 10), { passive: true });

  // Newsletter
  $("#newsletter").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.reset();
    toast("🎉 ¡Listo! Revisá tu email para el 10% OFF");
  });

  // Contadores animados del hero
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / 1600, 1);
      el.textContent = "+" + Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString("es-AR");
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Aparición de secciones al hacer scroll
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add("visible");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".section__head, .cat, .benefit, .combo, .review, .benefits__text").forEach((el) => {
    el.classList.add("reveal");
    io.observe(el);
  });
}

// Arranque de la landing (cuenta.html usa su propio script)
if (grid) {
  initLanding();
  Promise.all([loadCatalog(), loadSession()]).then(() => {
    renderProducts();
    renderCombos();
    renderDeliveryTexts();
    renderCart();
    if (location.hash === "#carrito") toggleCart(true);
    if (location.hash === "#ingresar") openAuth("login");
  });
}

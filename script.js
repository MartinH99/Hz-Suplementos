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
  const data = await fetch("/data/catalog.json").then((r) => r.json());
  PRODUCTS = data.products;
  COMBOS = Object.fromEntries(data.combos.map((c) => [c.id, c]));
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

function renderCart() {
  if (!$("#cartItems")) return;
  const ids = Object.keys(cart).filter((id) => findItem(id));
  const count = ids.reduce((s, id) => s + cart[id], 0);
  const total = ids.reduce((s, id) => s + findItem(id).price * cart[id], 0);
  $("#cartCount").textContent = count;
  $("#cartTotal").textContent = money(total);
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
  $("#cart")?.classList.toggle("open", open);
  $("#overlay")?.classList.toggle("open", open);
};

// Finalizar compra: si hay sesión, guarda el pedido en la base y lo envía por WhatsApp
function buildOrderMessage({ lines, total, order, notes }) {
  const msg = [
    order ? `¡Hola HZ Suplementos! 👋 Quiero confirmar mi pedido *#HZ-${String(order.id).padStart(5, "0")}*:` : "¡Hola HZ Suplementos! 👋 Quiero hacer este pedido:",
    "",
    ...lines.map((l) => `• ${l.qty} x ${l.name} — ${money(l.price * l.qty)}`),
    "",
    `*Total: ${money(total)}*`,
  ];
  if (order) {
    msg.push("", `👤 ${order.shipName}`);
    if (order.shipPhone) msg.push(`📞 ${order.shipPhone}`);
    msg.push(`📦 ${order.shipAddress || "Dirección a coordinar"}`);
  }
  if (notes) msg.push("", `📝 ${notes}`);
  msg.push("", "¿Me confirman disponibilidad y forma de pago? ¡Gracias!");
  return msg.join("\n");
}

async function checkout() {
  const ids = Object.keys(cart).filter((id) => findItem(id));
  if (!ids.length) return toast("Agregá productos para continuar");
  const notes = ($("#orderNotes")?.value || "").trim();
  const btn = $("#checkout");

  // Abrimos la pestaña ya (dentro del clic) para que el navegador no la bloquee
  const win = window.open("", "_blank");
  let order = null;
  let lines = ids.map((id) => ({ name: findItem(id).name, price: findItem(id).price, qty: cart[id] }));
  let total = lines.reduce((s, l) => s + l.price * l.qty, 0);

  if (currentUser) {
    btn.disabled = true;
    try {
      ({ order } = await api("orders", { method: "POST", body: { items: ids.map((id) => ({ id, qty: cart[id] })), notes } }));
      lines = order.items;
      total = order.total;
    } catch (err) {
      win?.close();
      btn.disabled = false;
      return toast(err.message);
    }
    btn.disabled = false;
  }

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(buildOrderMessage({ lines, total, order, notes }))}`;
  if (win) {
    win.opener = null;
    win.location.href = url;
  } else {
    location.href = url;
  }

  if (order) {
    cart = {};
    saveCart();
    renderCart();
    if ($("#orderNotes")) $("#orderNotes").value = "";
    toggleCart(false);
    toast(`📲 Pedido #HZ-${String(order.id).padStart(5, "0")} guardado. ¡Terminá de enviarlo por WhatsApp!`);
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
  $("#checkout").addEventListener("click", checkout);

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
    renderCart();
    if (location.hash === "#carrito") toggleCart(true);
    if (location.hash === "#ingresar") openAuth("login");
  });
}

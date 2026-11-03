// Catálogo de productos
const PRODUCTS = [
  { id: "whey-pro", name: "Whey Pro 2 lb", short: "WHEY<br>PRO", cat: "proteinas", desc: "Proteína de suero concentrada. 25 g por servicio. Sabor chocolate.", price: 32900, old: 38500, rating: 4.9, reviews: 412, badge: "-15%", tint: "#5b3a1e", icon: "💪" },
  { id: "isolate-zero", name: "Isolate Zero 2 lb", short: "ISO<br>ZERO", cat: "proteinas", desc: "Aislado de suero ultra filtrado. Sin lactosa ni azúcar.", price: 41500, rating: 4.8, reviews: 198, badge: "Nuevo", tint: "#1e3a5b", icon: "💪" },
  { id: "vegan-protein", name: "Vegan Protein 1 kg", short: "VEGAN<br>PROT", cat: "proteinas", desc: "Blend de arveja y arroz. 22 g de proteína vegetal.", price: 29900, rating: 4.7, reviews: 86, tint: "#2d4a1e", icon: "🌱" },
  { id: "bcaa", name: "BCAA 2:1:1 300 g", short: "BCAA<br>2:1:1", cat: "aminoacidos", desc: "Aminoácidos ramificados para recuperación muscular.", price: 18900, old: 22000, rating: 4.8, reviews: 265, badge: "-14%", tint: "#4a1e5b", icon: "🧬" },
  { id: "eaa", name: "EAA Recovery 400 g", short: "EAA<br>RECOV", cat: "aminoacidos", desc: "Los 9 aminoácidos esenciales + electrolitos.", price: 24500, rating: 4.9, reviews: 143, badge: "Nuevo", tint: "#5b1e3a", icon: "🧬" },
  { id: "glutamina", name: "Glutamina 300 g", short: "GLUTA<br>MINA", cat: "aminoacidos", desc: "L-Glutamina pura micronizada. Sin sabor.", price: 15900, rating: 4.6, reviews: 97, tint: "#3a3a3a", icon: "🧬" },
  { id: "creatina", name: "Creatina Monohidrato 300 g", short: "CREA<br>TINA", cat: "creatina", desc: "100% monohidrato micronizado. 60 servicios.", price: 19900, old: 23900, rating: 5.0, reviews: 530, badge: "Top ventas", tint: "#5b5b1e", icon: "⚡" },
  { id: "creatina-500", name: "Creatina Creapure® 500 g", short: "CREA<br>PURE", cat: "creatina", desc: "Creatina de máxima pureza importada de Alemania.", price: 34900, rating: 4.9, reviews: 211, tint: "#1e5b4a", icon: "⚡" },
  { id: "ignite", name: "Pre-entreno Ignite", short: "IGNI<br>TE", cat: "preentreno", desc: "Cafeína, beta-alanina y citrulina. Energía y bombeo.", price: 26900, old: 30500, rating: 4.8, reviews: 304, badge: "-12%", tint: "#5b1e1e", icon: "🔥" },
  { id: "pump", name: "Pump Stim-Free", short: "PUMP<br>FREE", cat: "preentreno", desc: "Pre-entreno sin estimulantes para entrenar de noche.", price: 23900, rating: 4.6, reviews: 74, tint: "#1e4a5b", icon: "🔥" },
  { id: "omega3", name: "Omega 3 · 120 caps", short: "OME<br>GA 3", cat: "vitaminas", desc: "EPA + DHA de alta concentración. Salud cardiovascular.", price: 14900, rating: 4.7, reviews: 158, tint: "#5b4a1e", icon: "🍊" },
  { id: "multi", name: "Multivitamínico Sport", short: "MULTI<br>VIT", cat: "vitaminas", desc: "23 vitaminas y minerales para deportistas.", price: 12900, rating: 4.7, reviews: 121, tint: "#5b2d1e", icon: "🍊" },
];

const COMBOS = {
  "combo-volumen": { name: "Combo Volumen", price: 54900, icon: "📦" },
  "combo-rendimiento": { name: "Combo Rendimiento", price: 62900, icon: "📦" },
  "combo-definicion": { name: "Combo Definición", price: 66500, icon: "📦" },
};

const CAT_LABEL = { proteinas: "Proteínas", aminoacidos: "Aminoácidos", creatina: "Creatina", preentreno: "Pre-entreno", vitaminas: "Vitaminas" };
const money = (n) => "$" + n.toLocaleString("es-AR");
const $ = (s) => document.querySelector(s);

// Render de productos
const grid = $("#products");
function renderProducts(filter = "all") {
  const list = filter === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.cat === filter);
  grid.innerHTML = list.map((p, i) => `
    <article class="product" style="animation-delay:${i * 50}ms">
      <div class="product__img" style="--tint:${p.tint}">
        ${p.badge ? `<span class="badge ${p.badge === "Nuevo" ? "badge--new" : ""}">${p.badge}</span>` : ""}
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

// Carrito (persistido en localStorage)
let cart = {};
try { cart = JSON.parse(localStorage.getItem("hz-cart")) || {}; } catch { cart = {}; }

function findItem(id) {
  return PRODUCTS.find((p) => p.id === id) || COMBOS[id];
}

function saveCart() {
  try { localStorage.setItem("hz-cart", JSON.stringify(cart)); } catch {}
}

function renderCart() {
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

document.addEventListener("click", (e) => {
  const add = e.target.closest(".add");
  if (add) addToCart(add.dataset.id);

  const q = e.target.closest("[data-qty]");
  if (q) {
    const id = q.dataset.id;
    cart[id] += Number(q.dataset.qty);
    if (cart[id] <= 0) delete cart[id];
    saveCart();
    renderCart();
  }
});

const cartEl = $("#cart");
const overlay = $("#overlay");
const toggleCart = (open) => {
  cartEl.classList.toggle("open", open);
  overlay.classList.toggle("open", open);
};
$("#cartOpen").addEventListener("click", () => toggleCart(true));
$("#cartClose").addEventListener("click", () => toggleCart(false));
overlay.addEventListener("click", () => toggleCart(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && toggleCart(false));

$("#checkout").addEventListener("click", () => {
  if (!Object.keys(cart).length) return toast("Agregá productos para continuar");
  toast("🚀 ¡Gracias! Te redirigimos al pago...");
});

// Toast
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

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
function animateCount(el) {
  const target = Number(el.dataset.count);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / 1600, 1);
    el.textContent = "+" + Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString("es-AR");
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
document.querySelectorAll("[data-count]").forEach(animateCount);

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

renderProducts();
renderCart();

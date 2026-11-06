// Página restablecer contraseña (usa api(), esc(), toast() y WHATSAPP_NUMBER de script.js)
// El token viaja en el #hash para que no quede en logs del servidor ni en el Referer
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const status = $("#resetStatus");
const form = $("#resetForm");

function invalid(message) {
  status.innerHTML = `${esc(message)}<br /><br /><a class="btn btn--primary" href="${waLink(WHATSAPP_NUMBER, "¡Hola! Necesito un nuevo link para restablecer mi contraseña.")}" target="_blank" rel="noopener">Pedir un link nuevo</a>`;
}

if (!token) invalid("Falta el link de recuperación.");
else api("auth", { method: "POST", body: { action: "reset-check", token } })
  .then(({ name, email }) => {
    status.hidden = true;
    form.hidden = false;
    $("#resetHello").textContent = `Hola ${name}, elegí una nueva contraseña para ${email}.`;
    form.elements.password.focus();
  })
  .catch((err) => invalid(err.message));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = form.querySelector("button");
  const errorEl = form.querySelector(".form-error");
  errorEl.textContent = "";
  if (form.elements.password.value !== form.elements.confirm.value) {
    errorEl.textContent = "Las contraseñas no coinciden";
    return;
  }
  btn.disabled = true;
  try {
    await api("auth", { method: "POST", body: { action: "reset", token, password: form.elements.password.value } });
    toast("✔ Contraseña actualizada. ¡Bienvenido/a de nuevo!");
    setTimeout(() => (location.href = "/cuenta.html"), 1200);
  } catch (err) {
    errorEl.textContent = err.message;
    btn.disabled = false;
  }
});

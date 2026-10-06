/**
 * Self-contained login page (no external assets; the inline script carries a per-response CSP nonce).
 * Posts JSON to /api/auth/login and redirects to / on success; errors are shown inline.
 */
export function renderLoginPage(options: { nonce: string }): string {
  const { nonce } = options
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Entrar · TCG Pocket</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #ffffff; --text: #1b1f24; --muted: #5c6672; --accent: #d9312b; --border: #d7dce2; --error: #b42318; --error-bg: #fef3f2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --card: #181b21; --text: #e9ecf1; --muted: #9aa4b2; --border: #2b313b; --error: #f97066; --error-bg: #2a1413; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  p.sub { margin: 0 0 20px; color: var(--muted); font-size: .95rem; }
  label { display: block; font-size: .9rem; font-weight: 600; margin: 14px 0 6px; }
  input { width: 100%; padding: 12px 14px; font-size: 1rem; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
  button { width: 100%; margin-top: 22px; padding: 13px; font-size: 1rem; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 10px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: wait; }
  .error { display: none; margin: 16px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--error-bg); color: var(--error); font-size: .95rem; }
  .error[data-show] { display: block; }
</style>
</head>
<body>
<main>
  <h1>TCG Pocket</h1>
  <p class="sub">Ingresá con tu correo, tu contraseña y el código de tu app de autenticación.</p>
  <form id="login" novalidate>
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" autocomplete="username" inputmode="email" required autofocus>
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <label for="totp">Código de 6 dígitos</label>
    <input id="totp" name="totp" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="123456">
    <button id="submit" type="submit">Entrar</button>
    <p id="error" class="error" role="alert"></p>
  </form>
</main>
<script nonce="${nonce}">
(function () {
  var form = document.getElementById('login');
  var error = document.getElementById('error');
  var button = document.getElementById('submit');
  function show(message) { error.textContent = message; error.setAttribute('data-show', ''); }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    error.removeAttribute('data-show');
    button.disabled = true;
    var body = {
      email: form.email.value.trim(),
      password: form.password.value,
      totp: form.totp.value.trim()
    };
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (response) {
      if (response.ok) { window.location.replace('/'); return; }
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.status === 429) { show('Demasiados intentos. Esperá 15 minutos y volvé a probar.'); return; }
        if (data && data.code === 'totp_required') { show('Falta el código de 6 dígitos.'); form.totp.focus(); return; }
        show((data && typeof data.message === 'string') ? data.message : 'No se pudo iniciar sesión.');
      });
    }).catch(function () {
      show('Sin conexión con el servidor. Probá de nuevo.');
    }).then(function () { button.disabled = false; });
  });
})();
</script>
</body>
</html>
`
}

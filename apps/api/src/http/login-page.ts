/** What a CSP takes as a nonce (a base64 or base64url value): nothing that could close the attribute it is written in. */
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/

/**
 * Self-contained login page (no external assets; its two inline scripts carry a per-response CSP nonce).
 * Posts JSON to /api/auth/login and redirects to / on success; errors are shown inline. The form itself says
 * `method="post"` for the browser where that script did not run: sent with GET, what was typed would end in the address.
 *
 * It looks like the app it opens (mock-up D) without loading anything of it, because the app's stylesheet, its fonts
 * and /look.js all ask for the session:
 * - The palette is a copy, by value, of the tokens of apps/web/src/index.css that the page uses: `:root` is the dark
 *   theme and `:root[data-theme="light"]` the light one. No `prefers-color-scheme`: the theme is the choice of this
 *   device, and without JavaScript the page is dark, like the app.
 * - The first script repeats, for the theme only, the rules of apps/web/public/look.js before the first paint:
 *   localStorage['tcg.look'].theme, dark unless it says «light», or «system» on a light system. It is resolved once,
 *   at load: nothing here changes the choice.
 * - The fonts are the ones of the device, through the same fallback chain the app declares. The page never gets the
 *   display face, and its stand-ins are one regular face each, the wide one drawn at 84 %: hence 500 for the labels
 *   and the button (the app's weight; from 600 up a browser fakes the bold) and sizes that leave nothing drawn under
 *   13 px. Sizes are in rem, as in the app, so they follow the font size chosen in the browser.
 * - The page stands in the column of the app (`--frame`), with the colour of the app around it on a wide window.
 * login-page.spec.ts holds the copies to their sources: it runs this script and look.js over the same cases, and
 * compares the tokens, the fallback faces and the column with index.css.
 */
export function renderLoginPage(options: { nonce: string }): string {
  const { nonce } = options
  // Written as it comes, twice. The controller makes it from random bytes; anything else must not become a page.
  if (!NONCE.test(nonce)) throw new Error('renderLoginPage: the nonce is not a base64 value')
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0a0e14">
<script nonce="${nonce}">
(function () {
  var light = false;
  try {
    var saved = JSON.parse(localStorage.getItem('tcg.look') || '{}');
    var theme = saved && saved.theme;
    light = theme === 'light' ||
      (theme === 'system' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  } catch (e) {}
  try {
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', light ? 'light' : 'dark');
    var color = document.querySelector('meta[name="theme-color"]');
    if (color) color.setAttribute('content', light ? '#f1eee8' : '#0a0e14');
  } catch (e) {}
})();
</script>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Entrar · TCG Pocket</title>
<style>
  @font-face {
    font-family: "TCG Narrow Fallback";
    src: local("Arial Narrow"), local("Roboto Condensed"), local("RobotoCondensed-Regular"), local("Liberation Sans Narrow");
    unicode-range: U+0020-024F, U+2010-2027, U+2030-205E, U+20A0-20BF, U+2122, U+2212;
  }
  @font-face {
    font-family: "TCG Wide Fallback";
    src: local("Roboto"), local("Arial"), local("Helvetica Neue"), local("Liberation Sans"), local("DejaVu Sans");
    size-adjust: 84%;
    unicode-range: U+0020-024F, U+2010-2027, U+2030-205E, U+20A0-20BF, U+2122, U+2212;
  }
  :root {
    color-scheme: dark;
    --background-outer: #05080c;
    --background: #0a0e14;
    --card: #131a24;
    --surface-2: #1a2330;
    --edge: rgba(255, 255, 255, 0.07);
    --border: rgba(255, 255, 255, 0.09);
    --input: #6f7f97;
    --foreground: #eaf0f7;
    --foreground-2: #aab5c5;
    --primary: #eef2f6;
    --primary-foreground: #0b0f14;
    --destructive: #ff7b72;
    --ring: #3fd6c6;
    --shadow-card: 0 12px 26px -18px rgba(0, 0, 0, 0.9), 0 2px 6px -2px rgba(0, 0, 0, 0.5);
    --radius: 0.75rem;
    --frame: 30rem;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --background-outer: #e4e0d7;
    --background: #f1eee8;
    --card: #ffffff;
    --surface-2: #f7f5f0;
    --edge: rgba(255, 255, 255, 0.9);
    --border: rgba(20, 26, 34, 0.11);
    --input: #857f72;
    --foreground: #141a22;
    --foreground-2: #4f5968;
    --primary: #141a22;
    --primary-foreground: #ffffff;
    --destructive: #c0271f;
    --ring: #0f766e;
    --shadow-card: 0 10px 22px -16px rgba(40, 34, 20, 0.5), 0 1px 3px rgba(40, 34, 20, 0.12);
  }
  * { box-sizing: border-box; }
  html {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    background: var(--background-outer);
    scrollbar-gutter: stable;
  }
  body {
    max-width: var(--frame);
    min-height: 100vh;
    min-height: 100dvh;
    margin: 0 auto;
    display: grid;
    place-items: center;
    padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    background: var(--background);
    color: var(--foreground);
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 1rem;
    line-height: 1.45;
  }
  @media (min-width: 600px) {
    body { box-shadow: 0 0 0 1px var(--border); }
  }
  main {
    width: 100%;
    max-width: 380px;
    padding: 28px 24px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) * 1.4);
    box-shadow: inset 0 1px 0 var(--edge), var(--shadow-card);
  }
  h1, label, button { font-family: "Barlow Semi Condensed", "TCG Narrow Fallback", "TCG Wide Fallback", system-ui, sans-serif; }
  h1 { margin: 0 0 6px; font-size: 1.625rem; font-weight: 700; line-height: 1.1; letter-spacing: .01em; }
  .sub { margin: 0 0 20px; color: var(--foreground-2); font-size: 0.9375rem; }
  label { display: block; margin: 14px 0 6px; font-size: 1rem; font-weight: 500; line-height: 1.2; }
  input {
    display: block;
    width: 100%;
    height: 2.75rem;
    padding: 4px 10px;
    background: var(--surface-2);
    color: var(--foreground);
    border: 1px solid var(--input);
    border-radius: var(--radius);
    font-family: inherit;
    font-size: 1rem;
  }
  input::placeholder { color: var(--foreground-2); opacity: 1; }
  input:focus-visible { border-color: var(--ring); outline: 2px solid var(--ring); outline-offset: 0; }
  button {
    display: block;
    width: 100%;
    min-height: 2.75rem;
    margin-top: 22px;
    padding: 0 16px;
    background: var(--primary);
    color: var(--primary-foreground);
    border: 0;
    border-radius: var(--radius);
    font-size: 1.0625rem;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: .01em;
    cursor: pointer;
  }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button:active { transform: translateY(1px); }
  button[disabled] { opacity: .5; cursor: wait; }
  @media (hover: hover) {
    button:hover:not([disabled]) { background: color-mix(in srgb, var(--primary) 80%, var(--card)); }
  }
  @media (forced-colors: active) {
    button { border: 1px solid; }
  }
  .error {
    display: none;
    margin: 16px 0 0;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--destructive) 10%, var(--card));
    color: var(--destructive);
    border: 1px solid var(--destructive);
    border-radius: var(--radius);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
  }
  .error[data-show] { display: block; }
</style>
</head>
<body>
<main>
  <h1>TCG Pocket</h1>
  <p class="sub">Ingresá con tu correo, tu contraseña y el código de tu app de autenticación.</p>
  <form id="login" method="post" novalidate>
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
        // Errors come wrapped as { error: { code, message } } (docs/API.md).
        var err = (data && data.error) ? data.error : {};
        if (response.status === 429) { show('Demasiados intentos. Esperá 15 minutos y volvé a probar.'); return; }
        if (err.code === 'totp_required') { show('Falta el código de 6 dígitos.'); form.totp.focus(); return; }
        show((typeof err.message === 'string') ? err.message : 'No se pudo iniciar sesión.');
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

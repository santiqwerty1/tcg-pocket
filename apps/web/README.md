# @tcg/web · PWA de TCG Pocket

Interfaz de la app (React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Query + react-router). Texto primero, pensada para usar con una mano en el celular (objetivos táctiles de 44 px): una sola columna de 480 px a cualquier ancho, también en la PC.

El marco es el de la maqueta D (`docs/prototipos/renovacion-ui/DIRECCION-D.md`), con las pantallas de hoy adentro:

- **Encabezado**: el título y, a la derecha, el camino al Menú con el punto de los avisos. Una pantalla interior lleva «Volver», que sube a la pantalla de arriba cuando no hay una de la app detrás.
- **Barra de pestañas**: Hoy · Mazos · Cartas · Meta · Pruebas y la lupa del buscador (también con «/»). Cada pestaña recuerda dónde estaba; tocar la que está encendida lleva a su inicio.
- **Fila fija**, arriba de la barra: las vistas de la pantalla (Cartas: Sobres y Colección; Meta: Torneos y Eventos; Pruebas: Laboratorio, Simulación y Practicar) y su acción («Nuevo mazo» en Mazos).
- **Menú** (`/mas`): los avisos, las pantallas que la maqueta todavía no ubica, «Aspecto» y «Ajustes y sistema».

El aspecto se elige en cada dispositivo, en Menú → Aspecto: el tema (oscuro por defecto, claro o el del sistema), el movimiento (Expresivo, Sutil o Ninguno; queda en Ninguno cuando el sistema pide reducirlo) y dónde van las vistas (abajo, en la fila fija, o arriba, en pestañas bajo el encabezado).

## Correr en desarrollo

Hace falta la API corriendo en `http://localhost:3000` (`pnpm -F @tcg/api start:dev`). Vite reenvía `/api`, `/login` y `/healthz` a ese origen (otro origen: variable `VITE_API_ORIGIN`).

```powershell
pnpm -F @tcg/web dev        # http://localhost:5173
```

Sin sesión, la API responde `401` a `/api/*`: la app borra sus cachés, desregistra el service worker y navega a `/login` (página que sirve la API, fuera de la SPA). Después de iniciar sesión, `/login` vuelve a `/`.

> La cookie de sesión es `__Host-session` (`Secure`): Chrome y Firefox la aceptan en `http://localhost`, así que el flujo funciona en desarrollo sin HTTPS.

## Compilar, verificar y probar

```powershell
pnpm -F @tcg/web build      # tsc -b + vite build → dist/ (index.html, assets/, sw.js, manifest.webmanifest, icons/)
pnpm -F @tcg/web typecheck
pnpm -F @tcg/web test       # vitest + testing-library + jsdom (src/**/*.test.{ts,tsx})
pnpm lint                   # biome, desde la raíz del repo (pnpm lint:fix para arreglar)
```

La API sirve `dist/` detrás del middleware de sesión (`WEB_DIST`).

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Config de Vite, proxy de desarrollo, **PWA** (`vite-plugin-pwa`: manifest con atajos y `share_target`, `registerType: 'autoUpdate'`, `navigateFallback: '/index.html'`, denylist `/api`, `/login`, `/healthz`, `/viewer/`, `/engine/`, `/licenses/`; precache del shell y de las fuentes; caché de imágenes de cartas) | `vite.config.ts` |
| Código extra del service worker: Web Push (Fase 18) y «Compartir» hacia la app (Fase 41) | `public/push-sw.js` |
| Registro del service worker (solo en producción) | `src/pwa.ts`, llamado desde `src/main.tsx` |
| Limpieza ante 401 o cierre de sesión (`caches.delete` + `unregister` + `/login`) | `src/api/session.ts` |
| Cliente HTTP (`fetch` + JSON, errores `{ error: { code, message } }` → `ApiError`, 401) | `src/api/client.ts` |
| Esquemas zod de cada respuesta de `docs/API.md` | `src/api/schemas.ts` |
| Hooks de TanStack Query por recurso | `src/api/*.ts` |
| Fixtures de respuestas realistas (ids reales como `B2-113`, `B3b-64`) | `src/api/__fixtures__/` |
| Rutas (las pantallas pesadas se cargan al abrirlas) y errores de pantalla en español | `src/app/routes.tsx`, `src/app/RouteError.tsx` |
| El marco: encabezado, «Volver» (`useGoBack`), barra de pestañas y fila fija | `src/app/AppShell.tsx`, `src/app/TabBar.tsx`, `src/app/FixedRow.tsx` |
| Qué pestaña, qué vistas y qué acción tiene cada ruta (una sola tabla) y lo que el marco recuerda mientras está abierto | `src/app/frame.ts`, `src/app/frameMemory.ts` |
| La barra que una página deja siempre a mano («Guardar partida», «Guardar» del editor) | `src/components/StickyActions.tsx` |
| Páginas | `src/pages/*/` (partidas = «Hoy», mazos, coleccion, cartas, sobres, torneos, simulacion, laboratorio, jugar, eventos, mas = el Menú y sus páginas) |
| Componentes propios (`Stat` con n e IC 95 %, chips de energía, stepper, estados de lista) | `src/components/` |
| Componentes generados con la CLI de shadcn (MIT; `components.json`) | `src/components/ui/` |
| Tema: tokens de la maqueta D en dos temas (`data-theme="dark" \| "light"` en `<html>`), los tres niveles de movimiento (`data-motion`), las medidas del marco, tipografía y `@font-face` | `src/index.css` |
| El aspecto de este dispositivo (`localStorage['tcg.look']`: tema, movimiento y lugar de las vistas): antes del primer pintado y desde React (`useLook`). La página de ingreso, que sirve la API, repite en línea la regla del tema y copia de `index.css` los tokens que usa, las fuentes de reserva y la columna: `apps/api/src/http/login-page.ts`, con un test que la compara con `look.js` y con `index.css` | `public/look.js`, `src/lib/look.ts` |
| Fuentes propias (Barlow Semi Condensed e Inter, OFL 1.1) y su licencia | `src/assets/fonts/`, `public/licenses/fonts-ofl.txt` |
| Íconos de la PWA (generados sin dependencias con `node scripts/make-icons.mjs`) | `public/icons/`, `public/favicon.svg`, `public/apple-touch-icon.png` |

## Rutas

La tabla completa está en `src/app/routes.tsx`. Las principales:

- `/` → `/partidas` («Hoy»: para hoy, carga rápida de partidas y últimas partidas); `/partidas/estadisticas` (`?modalidad=`, `?periodo=`), `/partidas/historial` (`?mazo=`, `?rival=`), `/partidas/semana`
- `/mazos`, `/mazos/hoy`, `/mazos/nuevo`, `/mazos/importar` (`?compartido=1` toma el texto compartido), `/mazos/:deckId`, `/mazos/:deckId/editar`
- `/coleccion`, `/coleccion/importar` (`?compartido=1` sube el CSV compartido), `/coleccion/importar/:importId`, `/coleccion/ajustes`, `/coleccion/misiones`, `/coleccion/intercambio`, `/cartas/:cardId`, `/grupos/:groupId`
- `/sobres`
- `/torneos/*` y `/eventos/*` (pestaña Meta), `/laboratorio/*`, `/simulacion/*` y `/jugar/*` (pestaña Pruebas), y `/mas/*` (las páginas del Menú); todas cargadas al abrirlas. El Menú mismo (`/mas`) va en el bundle principal

## Notas

- Las miniaturas de cartas están apagadas por defecto (Menú → Aspecto); la preferencia se guarda en `PUT /api/settings/ui` y en `localStorage` para aplicarse al instante.
- La app no importa `@tcg/domain` en el navegador (DECISIONES 32.2): las formas de la API están espejadas en `src/api/schemas.ts`.
- Para agregar componentes de shadcn: `pnpm dlx shadcn@latest add <componente>` desde `apps/web`.

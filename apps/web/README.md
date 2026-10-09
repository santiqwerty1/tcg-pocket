# @tcg/web · PWA de TCG Pocket

Interfaz de la app (React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Query + react-router). Texto primero, pensada para usar con una mano en el celular (barra inferior de cinco destinos, objetivos táctiles de 44 px) y cómoda en escritorio. Sigue el tema claro u oscuro del sistema.

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
| Config de Vite, proxy de desarrollo, **PWA** (`vite-plugin-pwa`: manifest con atajos y `share_target`, `registerType: 'autoUpdate'`, `navigateFallback: '/index.html'`, denylist `/api`, `/login`, `/healthz`, `/viewer/`; caché de imágenes de cartas) | `vite.config.ts` |
| Código extra del service worker: Web Push (Fase 18) y «Compartir» hacia la app (Fase 41) | `public/push-sw.js` |
| Registro del service worker (solo en producción) | `src/pwa.ts`, llamado desde `src/main.tsx` |
| Limpieza ante 401 o cierre de sesión (`caches.delete` + `unregister` + `/login`) | `src/api/session.ts` |
| Cliente HTTP (`fetch` + JSON, errores `{ error: { code, message } }` → `ApiError`, 401) | `src/api/client.ts` |
| Esquemas zod de cada respuesta de `docs/API.md` | `src/api/schemas.ts` |
| Hooks de TanStack Query por recurso | `src/api/*.ts` |
| Fixtures de respuestas realistas (ids reales como `B2-113`, `B3b-64`) | `src/api/__fixtures__/` |
| Rutas (las pantallas pesadas se cargan al abrirlas), errores de pantalla en español y shell (cabecera con título y buscador, barra inferior) | `src/app/routes.tsx`, `src/app/RouteError.tsx`, `src/app/AppShell.tsx`, `src/app/BottomNav.tsx` |
| Páginas | `src/pages/*/` (partidas = «Hoy», mazos, coleccion, cartas, sobres, torneos, simulacion, laboratorio, jugar, eventos, mas) |
| Componentes propios (`Stat` con n e IC 95 %, chips de energía, stepper, estados de lista) | `src/components/` |
| Componentes generados con la CLI de shadcn (MIT; `components.json`) | `src/components/ui/` |
| Tema (variables, modo oscuro por `prefers-color-scheme`, fuente del sistema) | `src/index.css` |
| Íconos de la PWA (generados sin dependencias con `node scripts/make-icons.mjs`) | `public/icons/`, `public/favicon.svg`, `public/apple-touch-icon.png` |

## Rutas

La tabla completa está en `src/app/routes.tsx`. Las principales:

- `/` → `/partidas` («Hoy»: para hoy, carga rápida de partidas y últimas partidas); `/partidas/estadisticas` (`?modalidad=`, `?periodo=`), `/partidas/historial` (`?mazo=`, `?rival=`), `/partidas/semana`
- `/mazos`, `/mazos/hoy`, `/mazos/nuevo`, `/mazos/importar` (`?compartido=1` toma el texto compartido), `/mazos/:deckId`, `/mazos/:deckId/editar`
- `/coleccion`, `/coleccion/importar` (`?compartido=1` sube el CSV compartido), `/coleccion/importar/:importId`, `/coleccion/ajustes`, `/coleccion/misiones`, `/coleccion/intercambio`, `/cartas/:cardId`, `/grupos/:groupId`
- `/sobres`
- Desde «Más»: `/torneos/*`, `/simulacion/*`, `/laboratorio/*`, `/jugar/*`, `/eventos/*` y `/mas/*` (cargadas al abrirlas)

## Notas

- Las miniaturas de cartas están apagadas por defecto («Más → Ajustes de la app»); la preferencia se guarda en `PUT /api/settings/ui` y en `localStorage` para aplicarse al instante.
- La app no importa `@tcg/domain` en el navegador (DECISIONES 32.2): las formas de la API están espejadas en `src/api/schemas.ts`.
- Para agregar componentes de shadcn: `pnpm dlx shadcn@latest add <componente>` desde `apps/web`.

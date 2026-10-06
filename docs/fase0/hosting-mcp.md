> Informe de investigación automático de la Fase 0 (6/10/2026), generado por agentes de Claude Code sobre `refs/tracker` @ 3ab58f1, `refs/deckgym-core` @ fb792ebf, la API de Limitless y documentación pública. Las rutas `C:\Users\<usuario>\AppData\Local\Temp\...` son scripts descartables de la sesión. Los números de colección se calcularon con la exportación del 1/10/2026 que estaba en Descargas; el plan usa la del 6/10/2026 en `docs/context/`. Las secciones "Preguntas abiertas" quedaron consolidadas en `docs/PLAN.md` §8.

# hosting

## Resumen
Revisé scratchpad y proyecto: no había trabajo previo del modelo anterior (directorios vacíos), así que hice la investigación completa desde cero, verificando contra fuentes oficiales el 6/10/2026.

Hallazgos que cambian el diseño: (1) la spec MCP vigente es 2026-07-28: sin sesiones ni handshake, un POST por request, GET eliminado; el SDK TS se partió en @modelcontextprotocol/server|client|core|node|express|hono (v2.3.1, 5/10/2026) y los helpers de Authorization Server quedaron congelados en server-legacy. (2) Las apps de Claude (web/desktop/mobile) todavía hablan el protocolo 2025 (initialize + clientInfo) y siguen las specs de auth 2025-03-26/06-18/11-25; mcp-handler 2.x, MCP-Nest 2.0.7 y el SDK v2 sirven ambas eras sin estado. (3) Para el conector remoto, la doc de desarrollador dice que el auth por header fijo (static_headers) está "en beta para un conjunto limitado de organizaciones", aunque el artículo de soporte muestra el paso "Request headers" también para Pro/Max: hay que probarlo el primer día y planificar OAuth (CIMD/DCR, PKCE S256, callback https://claude.ai/api/mcp/auth_callback, egress 160.79.104.0/21) como camino seguro. Claude Code sí acepta `--header "Authorization: Bearer ..."`.

Hosting: Vercel Hobby (0 US$, funciones 300 s, 4 CPU-h, 360 GB-h, cron solo diario, uso no comercial) + Neon Free (1 GB, 100 CU-h, suspende a los 5 min, PITR 6 h) es la combinación gratis viable; calculé que un worker con short-poll cada 30 s 24/7 gasta ~86k invocaciones, 12,7 GB-h y 0,5 CPU-h/mes (entra), pero long-poll de 25 s 24/7 gastaría ~1.274 GB-h (no entra). Fly.io no tiene free tier: shared-cpu-1x 512 MB = 3,69 US$/mes a tiempo completo, menos con auto-stop. Render Free duerme a los 15 min (1 min para despertar) y su Postgres gratis se borra a los 30 días. Cloudflare Free limita a 10 ms de CPU por invocación.

Recomendación: Opción A' híbrida = monorepo pnpm, NestJS como proceso único (sirve la PWA Vite+React, API, cola del worker con long-poll, scheduler de Limitless, MCP remoto) + Prisma 7 + Neon Free, en Fly.io con auto_stop=suspend (~2–4 US$/mes), replays en Cloudflare R2 (10 GB gratis). Es lo que el usuario ya domina y elimina las restricciones serverless. Alternativa a 0 US$: Opción B (Next.js + mcp-handler + better-auth en Vercel Hobby + Neon) con polling corto y backfill de Limitless disparado desde el worker o GitHub Actions. Auth: passkeys (better-auth + @better-auth/passkey, SimpleWebAuthn) con fallback password+TOTP; tokens de worker/MCP aleatorios, guardados hasheados, con scope y revocables. Worker en Node (comparte packages/domain), arranque por Task Scheduler al logon, binario deckgym compilado en GitHub Actions (evita instalar MSVC en la PC) y fijado por commit fb792ebf.

## Hallazgos
# Fase 0 · Stack, hosting, auth, MCP, PWA y worker

**Estado del trabajo previo:** el scratchpad de esta sesión y los de las dos sesiones hermanas están vacíos, y no hay archivos nuevos en `C:\Users\<usuario>\Personal\tcg pocket` fuera de `Docs/` y `refs/`. No encontré nada reutilizable del modelo anterior, así que este informe cubre los 8 puntos completos. Todo lo marcado **[verificado 6/10/2026]** lo leí hoy en la fuente oficial; lo marcado **[no verificado]** es estimación o memoria.

Contexto local que condiciona el diseño (leído del disco):
- `refs/deckgym-core` está en `fb792ebfbaca995af9750c28101ce92a51282825` (4/10/2026). `Cargo.toml` define `crate-type = ["cdylib","rlib"]`, features `python` (pyo3), `tui`, `csv-export`; usa `rayon` (paralelismo) y `clap`. El CLI `simulate` acepta `--players`, `-n/--num`, `-s/--seed`, `-p/--parallel`, `-j <threads>`, `--data-output`, `--replay-dir`, `--replay-sample`, `--bot-a/--bot-b`, `--bot-timeout-ms` (`src/main.rs:29-80`). **El resumen de resultados se imprime como texto formateado con separadores de miles (`print_stats`, `src/simulate.rs:531-563`); no hay salida JSON del resumen.** Los replays sí son JSON (`src/replay/mod.rs:20-80`: `Replay { version, game_id, seed, players, cards, steps[], final_state, outcome }`, un `ViewState` completo por decisión). El protocolo de bot externo es JSON-lines por stdin/stdout (`docs/bot-protocol.md`). El `viewer/` es Vite + React 19 + PixiJS 8 + GSAP (`viewer/package.json`).
- `refs/tracker` está en `3ab58f1` (1/10/2026). `frontend/src/lib/stats.ts` (251 líneas) importa solo tipos y `CardsDB.ts` (`stats.ts:1-3`); `CardsDB.ts` (407 líneas) solo importa tipos (`CardsDB.ts:1`). Es portable a TS puro sin React. Usa shadcn (`frontend/components.json`, estilo new-york, iconos lucide) sobre Tailwind 4, Radix, react-router 8, TanStack Query 5, Supabase. Licencia: `LICENSE` = GPL-3.0; deckgym `LICENSE.txt` = AGPL-3.0.
- PC: Windows 11 Pro, 20 núcleos lógicos, 16 GB RAM, node v24.19.0; `cargo`/`rustc`/`nssm`/`pm2` no están instalados.

---

## 1. Hosting y base de datos (free tiers vigentes)

### 1.1 Cómputo / app

| Proveedor | Plan | Límites clave [verificado 6/10/2026 salvo nota] | Comportamiento en reposo | Costo realista para esta app |
|---|---|---|---|---|
| **Vercel** | Hobby (0 US$) | Funciones (Fluid): duración máx **300 s**; **4 CPU-h**, **360 GB-h** de memoria provisionada, **1 M invocaciones**/mes; 100 GB Fast Data Transfer; **cron: 100 por proyecto pero solo una vez por día, precisión ±59 min** (expresiones más frecuentes fallan el deploy); logs 1 h; 100 deploys/día; **uso no comercial/personal** (fair use) (vercel.com/docs/plans/hobby 2026-09-14; /docs/cron-jobs/usage-and-pricing 2026-07-15; /docs/functions/usage-and-pricing 2026-06-16) | Cold start de función: cientos de ms [no verificado]; Active CPU no se cobra mientras espera I/O, pero la memoria sí hasta que termina la última request en vuelo | **0 US$**. Excedido un límite, la feature se pausa hasta 30 días (no cobra) |
| **Fly.io** | Pay-as-you-go | **Sin free tier**: trial de 2 h de runtime o 7 días. shared-cpu-1x: **256 MB 2,19 US$/mes, 512 MB 3,69, 1 GB 6,70**; rootfs de máquina parada 0,15 US$/GB-mes; volúmenes 0,15 US$/GB-mes; IPv4 dedicada 2 US$/mes (**IPv4 compartida e IPv6 gratis**); egress NA/EU 0,02 US$/GB (docs.fly.io/about/pricing) | `auto_stop_machines = "stop"|"suspend"`, `min_machines_running = 0`: no cobra CPU/RAM parada; "suspend" despierta más rápido que "stop"; el stop loop corre "cada pocos minutos" (docs.fly.io/launch/autostop-autostart) | **~1,2–3,7 US$/mes** (512 MB; calculé 1,23 US$ si corre 8 h/día). Pide tarjeta |
| **Render** | Free | Web service duerme tras **15 min** sin tráfico, tarda "about one minute" en despertar; **750 h de instancia/mes** por workspace; **Postgres gratis expira a los 30 días** (+14 de gracia, luego se borra); **no hay Background Workers ni Cron Jobs gratis** (render.com/docs/free) | Dormido | 0 US$ pero el flujo "cargar partida desde el celu" paga ~1 min de cold start; mantenerlo despierto con un pinger externo consume ~744 h de 750 (zona gris) |
| **Railway** | Trial / Hobby | Trial: crédito único de **5 US$**, 1 GB RAM, 2 vCPU; Free: 0,5 GB RAM, 1 vCPU, sin crédito; **Hobby 5 US$/mes** con 5 US$ de uso incluido; RAM 10 US$/GB-mes, vCPU 20 US$/mes; desde el 30/3 exige tarjeta post-paga (docs.railway.com/reference/pricing/plans) | Sin sleep por defecto | **5 US$/mes** (Hobby); el free no alcanza para algo estable |
| **Koyeb** | Free | 1 web service `free`: **0,1 vCPU, 512 MB, 2 GB SSD**, solo Frankfurt/Washington; **duerme tras 1 h sin tráfico**; sin volúmenes, solo web (no workers); Postgres gratis: **5 h activas/mes**, 1 GB; pide tarjeta con preautorización de 29 US$; adquirida por Mistral (2/2026) pero mantiene el free (koyeb.com/docs/reference/instances; /docs/faq/pricing) | Dormido tras 1 h; tiempo de despertar no documentado [no verificado] | 0 US$; 0,1 vCPU es muy poco para NestJS + Prisma; riesgo por adquisición |
| **Cloudflare Workers** | Free / Paid 5 US$ | Free: **100k req/día, 10 ms CPU por invocación**, 50 subrequests, **5 cron triggers**; Paid **5 US$/mes**: 10 M req y 30 M CPU-ms incluidos, hasta 5 min CPU por invocación, 250 crons (developers.cloudflare.com/workers/platform/limits, /pricing) | Sin cold start apreciable | 0 o 5 US$/mes. Los 10 ms de CPU del free son un riesgo real para importar 4.317 filas o agregar 12k listas de Limitless |
| **GitHub Actions** (solo como cron/builder) | Free | **2.000 min/mes** en repos privados, 500 MB de artefactos; ilimitado en públicos; runners Windows cuestan más (precio 0,010 vs 0,006 US$/min; multiplicador de minutos 2x según docs, no lo reverifiqué). `schedule`: **mínimo 5 min**, se retrasa en horas pico, se desactiva tras 60 días sin actividad en repos públicos, solo rama default (docs.github.com, 6/10/2026) | — | 0 US$. Sirve para compilar deckgym y para disparar el sync de Limitless |

### 1.2 Base de datos y objetos

| Proveedor | Free tier [verificado 6/10/2026] | Riesgo para este caso |
|---|---|---|
| **Neon** | **1 GB/proyecto (20 GB cuenta), 100 CU-h/proyecto/mes, hasta 2 CU**, scale-to-zero a los **5 min (fijo en Free)**, reactivación "within a few hundred milliseconds", **historial/PITR 6 h (1 GB)**, 10 branches. Launch: 0,106 US$/CU-h, 0,35 US$/GB-mes sin mínimo (neon.com/pricing; /docs/introduction/scale-to-zero) | Con el compute mínimo de 0,25 CU, 100 CU-h = **400 h activas/mes**. Un worker que consulta la DB cada 30 s las 24 h la mantiene despierta: 720 h × 0,25 = **180 CU-h > 100**. Hace falta que el poll no toque la DB cuando la cola está vacía (ver §6) |
| **Supabase** | **500 MB DB, 1 GB storage, 5 GB egress, 50k MAU, 2 proyectos; se pausa tras 1 semana sin actividad; sin backups** en Free; Pro 25 US$ (supabase.com/pricing) | Sin tope de horas de cómputo (ventaja frente a Neon para el polling); la pausa semanal se evita con cualquier uso o con el cron diario de Limitless |
| **Prisma Postgres** | **200k operaciones/mes, 1,01 GB** (así figura), 50 DBs, 10 conexiones pooled/direct, idle timeout 60 min; Starter 10 US$ (prisma.io/pricing) | Cada query cuenta como operación: 86k polls/mes ya consumen casi la mitad. Descartado |
| **Turso** | 100 DBs, 5 GB, 500 M lecturas, 10 M escrituras, PITR 1 día; Developer 4,99 US$ (turso.tech/pricing) | Es SQLite/libSQL (no Postgres) y la página anuncia "Turso is joining Supabase": incertidumbre de producto |
| **Cloudflare D1** | Free: 5 M filas leídas/día, 100k escritas/día, 5 GB (developers.cloudflare.com/d1/platform/pricing) | SQLite; solo tiene sentido con la opción C |
| **Durable Objects** | Disponibles en Free solo con backend SQLite: 100k req/día, 13k GB-s/día, 5 GB (developers.cloudflare.com/durable-objects/platform/pricing) | Solo opción C |
| **Cloudflare R2** | **10 GB-mes, 1 M Class A, 10 M Class B, egress gratis**; pago 0,015 US$/GB-mes (developers.cloudflare.com/r2/pricing) | Ideal para replays: API S3, sin egress. Pide cuenta Cloudflare (gratis) |
| **Vercel Blob** | Hobby: 1 GB, 10k ops simples, 2k ops avanzadas (put/list cuentan), 10 GB transferencia; si se excede, bloqueado 30 días (vercel.com/docs/vercel-blob/usage-and-pricing 2026-09-23) | 2k `put` por mes es poco para subir replays uno por uno (10 replays × 1.600 cruces = 16k) |
| **Supabase Storage** | 1 GB incluido en el Free | Alcanza para muestras pequeñas, no para 4–5 GB de replays |

Tamaño de replays: estimé ~300 KB por partida (un `ViewState` completo por ply, ~60 plies) [no verificado, medir]. Matriz 40×40 con 10 replays por cruce ≈ **4,6 GB** sin comprimir. Con gzip (JSON muy repetitivo) probablemente <1 GB. R2 es el único free que lo aguanta con margen.

### 1.3 Presupuesto del polling del worker en Vercel Hobby (calculado)

Supuestos: instancia Fluid de 1,769 GB, 20 ms de CPU por poll.

| Patrón | Invocaciones/mes | GB-h memoria | CPU-h |
|---|---|---|---|
| Short poll cada 30 s, 24/7, respuesta en 0,3 s | 86.400 | 12,7 | 0,48 |
| Short poll cada 10 s, 24/7 | 259.200 | 38,2 | 1,44 |
| **Long-poll de 25 s, 24/7** | 103.680 | **1.273,7 (excede 360)** | 0,58 |
| Long-poll de 25 s, 6 h/día | 25.920 | 318,4 (al límite) | 0,14 |
| Short poll cada 30 s solo 6 h/día | 21.600 | 3,2 | 0,12 |

Conclusión: en serverless **no usar long-poll**; usar short-poll cada 10–30 s con backoff a 5 min cuando la cola está vacía. En un proceso persistente (Fly) el long-poll de 25 s es gratis.

---

## 2. Tres stacks candidatos y recomendación

Criterios: costo, cold start del flujo "cargar partida" desde el celular, jobs en segundo plano (sync de Limitless a 50 req/5 min → backfill en trozos de ≥15 min), cola para el worker (long-poll), SSE/progreso, MCP remoto (Streamable HTTP, sin sesiones en 2026-07-28 pero con fallback 2025 para claude.ai), mantenibilidad para vos, tests (vitest), monorepo.

### Opción A · React+Vite PWA SPA + NestJS + Prisma + Postgres, un contenedor (Nest sirve la SPA)

- **Hosting:** Fly.io shared-cpu-1x 512 MB con `auto_stop_machines="suspend"`, `min_machines_running=0` (o 1 si el despertar molesta) + Neon Free. Render Free solo si aceptás 1 min de cold start o un pinger. Koyeb Free: 0,1 vCPU, no lo recomiendo.
- **Costo:** **~2–4 US$/mes** (Fly) + 0 (Neon) + 0 (R2). Si `min_machines_running=1`: 3,69 US$/mes fijos.
- **Cold start:** máquina suspendida → despertar de segundos [Fly no publica cifra; "suspend" es más rápido que "stop"] + Neon ~0,5 s. Con `min_machines_running=1`, ~0.
- **Jobs:** `@nestjs/schedule` en proceso: un sync incremental diario y un backfill por trozos con un limitador en memoria que respeta 50 req/5 min (10 req/min, backfill de 151 torneos ≈ 16 min). Sin cron externo.
- **Cola del worker:** endpoint `POST /worker/jobs/claim` con long-poll de 25 s gratis; heartbeats; SSE nativo para progreso en la UI.
- **MCP remoto:** `@rekog/mcp-nest` 2.0.7 (21/9/2026; peers `@modelcontextprotocol/server|core|node`, `express`, `@nestjs/core >=9`) sirve 2026-07-28 y la era 2025 desde un mismo endpoint, con guards de Nest. Resource server con bearer propio; AS OAuth con better-auth (ver §3).
- **Mantenibilidad:** es tu stack de producción. Prisma 7 trae cambios (driver adapters obligatorios `@prisma/adapter-pg`, `prisma.config.ts`, `output` obligatorio, Node ≥20.19; `prisma` ya está en 8.0.0-rc.20 y `@prisma/client` en 7.10.0 — npm 6/10/2026).
- **Tests:** vitest 5.0.3 en `packages/domain` (TS puro) y para controladores con `@nestjs/testing` (Jest es el default de Nest; se puede usar vitest con SWC, es trabajo de setup).
- **Monorepo:** `apps/web` (Vite PWA), `apps/api` (Nest, sirve `apps/web/dist` detrás del auth), `apps/worker`, `apps/mcp-local` (stdio), `packages/domain`.
- **Qué tenés que aprender:** Fly.io (`fly.toml`, Dockerfile), vite-plugin-pwa, passkeys/better-auth, MCP SDK v2. Poco.

### Opción B · Next.js 16 (App Router, route handlers, Prisma) en Vercel Hobby + Neon, PWA con serwist

- **Costo:** **0 US$** (Hobby no comercial: uso personal encaja).
- **Cold start:** función Fluid fría (cientos de ms) + Neon (cientos de ms). Aceptable para "cargar partida" (~1 s en el peor caso).
- **Jobs:** cron de Hobby **solo diario y con ±59 min**: sirve para el incremental. El backfill por trozos necesita otro disparador: (a) el worker de la PC llama `POST /sync/step` cada 30 s mientras haya backlog (el servidor guarda el cursor en DB y hace ≤10 requests a Limitless por paso), o (b) un `schedule` de GitHub Actions cada 5 min que llame al endpoint con token. Cada paso cabe en los 300 s.
- **Cola:** short-poll (ver tabla §1.3). Sin long-poll. Progreso en la UI por polling cada 2–3 s; SSE posible dentro de 300 s pero cuesta GB-h.
- **MCP remoto:** `mcp-handler` 2.2.0 (18/9/2026; peers `next>=13`, `@modelcontextprotocol/server ^2`), "serves 2026-07-28 natively while transparently falling back to stateless Streamable HTTP for 2025-era clients", sin Redis; `withMcpAuth` + `protectedResourceHandler` (RFC 9728). AS OAuth con `better-auth` 1.7.7 (`@better-auth/oauth-provider` + `@better-auth/cimd` + `@better-auth/mcp`).
- **Mantenibilidad:** Next App Router (RSC, route handlers, `proxy.ts`/middleware) es nuevo para vos; el modelo serverless obliga a pensar cada job como "un paso idempotente ≤300 s".
- **Tests:** vitest para `packages/domain` y route handlers (son funciones `Request → Response`).
- **Protección de la PWA shell:** middleware puede exigir sesión en todas las páginas, pero `/_next/static/*` (chunks JS) queda público salvo que lo incluyas en el matcher; los datos sí quedan protegidos. Si "nada se sirve sin autenticar" es literal, la opción A lo cumple más fácil.
- **Qué tenés que aprender:** Next.js App Router, serwist, límites de Fluid compute, better-auth, mcp-handler.

### Opción C · Cloudflare Pages + Workers (Hono) + D1/Drizzle (+ Agents SDK para MCP)

- **Costo:** 0 US$ (Free) o **5 US$/mes** (Paid). Con Free, el límite de **10 ms de CPU por invocación** es un riesgo cierto para el diff de importación (4.317 filas), la validación de 40 mazos contra la colección y las agregaciones de Limitless; con Paid desaparece.
- **Cold start:** prácticamente nulo. D1 es local al edge.
- **Jobs:** cron triggers (5 en Free) cada minuto: el backfill por trozos queda perfecto. Cola con Durable Objects (SQLite, gratis) o tabla D1.
- **MCP remoto:** Agents SDK (`agents` 0.26.0): `createMcpHandler` stateless recomendado, `McpAgent` (Durable Objects) deprecado; `@cloudflare/workers-oauth-provider` 1.2.2 (6/10/2026) implementa AS completo con CIMD/DCR/PKCE/RFC 9728, **requiere KV** (`OAUTH_KV`) y el flag `global_fetch_strictly_public` para CIMD.
- **Mantenibilidad:** D1 es SQLite, no Postgres; Prisma funciona con adapter pero Drizzle es el camino natural. Hono, wrangler, bindings: todo nuevo para vos.
- **Qué tenés que aprender:** casi todo el runtime. Es la curva más larga y la que menos reaprovecha tu experiencia.

### Híbrido (recomendado): NestJS como proceso único en Fly.io con auto-stop

Es la opción A con dos decisiones explícitas: (1) un solo proceso Node hace de API, servidor estático de la PWA, scheduler, cola y MCP remoto; (2) la DB va afuera (Neon Free) para no pagar volumen ni administrar Postgres en Fly. Costo **2–4 US$/mes**; si querés 0 US$ exacto, la opción B es la alternativa seria.

### Matriz de decisión (1 = malo, 5 = muy bueno)

| Criterio | A' NestJS en Fly | B Next.js en Vercel | C Cloudflare |
|---|---|---|---|
| Costo | 4 (2–4 US$) | 5 (0) | 4 (0/5) |
| Cold start "cargar partida" | 4 (5 con min=1) | 4 | 5 |
| Backfill Limitless por trozos | 5 (scheduler en proceso) | 3 (cron diario; paso disparado externamente) | 5 |
| Cola worker / long-poll / SSE | 5 | 3 | 4 |
| MCP remoto (ambas eras + OAuth) | 4 (mcp-nest + better-auth) | 5 (mcp-handler + better-auth, muy documentado) | 4 (oauth-provider, KV) |
| Mantenibilidad para vos | 5 | 3 | 2 |
| Tests (vitest) | 4 | 4 | 4 |
| Postgres/Prisma (experiencia previa) | 5 | 5 | 2 |
| **Total** | **36** | **32** | **30** |

---

## 3. MCP (M8)

### 3.1 Spec vigente [verificado 6/10/2026]

- **Revisión 2026-07-28** (anterior: 2025-11-25). Cambios mayores: se eliminan las sesiones y `Mcp-Session-Id`; se elimina el handshake `initialize`; cada request lleva `_meta.io.modelcontextprotocol/protocolVersion` y `clientCapabilities`; `server/discover` obligatorio; se elimina el GET del endpoint y la resumibilidad SSE; `subscriptions/listen` para notificaciones; MRTR reemplaza sampling/elicitation como requests del servidor; headers obligatorios `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`; `ttlMs`/`cacheScope` en los list; **DCR (RFC 7591) deprecado a favor de CIMD**; HTTP+SSE (2024-11-05) deprecado. (modelcontextprotocol.io/specification/latest/changelog)
- **Transportes:** stdio (credenciales por entorno, "SHOULD NOT" usar OAuth) y Streamable HTTP (un solo endpoint POST; respuesta JSON o stream SSE por request; `Origin` validado; 405 a GET/DELETE legacy). (…/basic/transports/streamable-http)
- **Authorization:** el MCP server es *resource server* OAuth 2.1; **MUST** RFC 9728 (PRM), el AS **MUST** publicar RFC 8414 u OIDC Discovery; clientes **MUST** RFC 8707 (`resource`) y PKCE; CIMD **SHOULD**; DCR **MAY** (deprecado); pre-registro soportado ("Clients SHOULD support static client credentials"); `iss` RFC 9207 SHOULD. (…/basic/authorization; …/client-registration)

### 3.2 Qué exigen las apps de Claude [verificado 6/10/2026, claude.com/docs/connectors/building/*]

- Transporte: **"Use Streamable HTTP"**; HTTP+SSE legacy aún aceptado pero en deprecación. **Claude sigue las specs de autorización 2025-03-26, 2025-06-18 y 2025-11-25**; no menciona 2026-07-28, y en testing dice que "Claude identifies itself during the MCP `initialize` handshake via `clientInfo`" → **el servidor debe seguir sirviendo la era 2025** (SDK v2, mcp-handler y MCP-Nest lo hacen stateless; no hace falta `Mcp-Session-Id`).
- Tipos de auth: `oauth_dcr` y `oauth_cimd` "Supported by default"; `oauth_anthropic_creds` y `custom_connection` requieren `mcp-review@anthropic.com`; **`static_headers` (API key o bearer en header) "Beta, for a limited set of organizations"**: "Owners whose organization doesn't have access don't see the Request headers section"; `none` por defecto. Headers aceptados sin aprobación: `authorization`, `x-api-key`, `x-auth-token`.
- **Contradicción con soporte:** el artículo support.claude.com/en/articles/11175166 incluye el paso "Under **Request headers**, add fixed credentials such as API keys…" tanto para Team/Enterprise como para **Pro/Max**, sin restricción. Y dice que los custom connectors están disponibles en **Free (1 conector), Pro, Max, Team y Enterprise**, en Claude web, Cowork y Desktop; Claude Code configurado aparte. No puedo confirmar si tu cuenta ve la sección: **probarlo el día 1 lleva 10 minutos**.
- OAuth: CIMD se usa solo si el AS publica `"client_id_metadata_document_supported": true` **y** `"none"` en `token_endpoint_auth_methods_supported`; si no, cae a DCR (necesita `registration_endpoint`). PKCE S256 siempre. Callback de las apps hospedadas (web, Desktop, **mobile**, Cowork): `https://claude.ai/api/mcp/auth_callback`. Claude Code: loopback `http://localhost:<puerto>/callback` o `127.0.0.1`, sin puerto fijo; su CIMD es `https://claude.ai/oauth/claude-code-client-metadata`. 401 obligatorio con `WWW-Authenticate: Bearer resource_metadata="…"`; usa solo el primer `authorization_servers`; discovery/registro/token deben responder en **10 s** (refresh 30 s); refresh tokens rotados, `invalid_grant` al expirar; `/token` acepta `application/x-www-form-urlencoded`. Egress de Anthropic: **160.79.104.0/21**. No hay `client_credentials` M2M.
- Mobile: la doc dice que la misma infraestructura "backs claude.ai, Claude Desktop, Claude mobile, Claude Code, and Cowork"; los conectores se agregan desde la web y se sincronizan al celular (no se agregan desde la app móvil) [esto último de una fuente comunitaria, no verificado en doc oficial].

### 3.3 Claude Code y Claude Desktop [verificado 6/10/2026]

- Claude Code: `claude mcp add --transport http <name> <url> --header "Authorization: Bearer <token>"` (`-H` abreviado), `${VAR}` expandible en headers de `.mcp.json`; scopes local/project/user; OAuth con `/mcp` y `claude mcp login`; `--client-id/--client-secret` preconfigurables; SSE deprecado, v2.1.265+ intenta HTTP primero. Stdio: `claude mcp add --transport stdio <name> -- node …`. (code.claude.com/docs/en/mcp)
- Claude Desktop: stdio por `%APPDATA%\Claude\claude_desktop_config.json` (`command`, `args`, `env`); logs en `%APPDATA%\Claude\logs\mcp*.log`. Los remotos se agregan como conectores en la cuenta. (modelcontextprotocol.io/docs/develop/connect-local-servers)

### 3.4 Librerías (npm, 6/10/2026)

| Paquete | Versión / fecha | Qué resuelve | Notas |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.1 (5/10) | **v1, línea de mantenimiento** (fixes ≥6 meses desde 27/7/2026) | Aún 86 % de instalaciones según terceros; **no arrancar con esta** |
| `@modelcontextprotocol/server` / `client` / `core` | 2.3.1 (5/10) | SDK v2, spec 2026-07-28, stateless, Standard Schema (zod 4) | `createMcpHandler`, `McpServer`, `StdioServerTransport` (`…/server/stdio`), `requireBearerAuth` (web-standard), `oauthMetadataResponse`, `requireScopes`, `scopeChallenge` por tool. **Los helpers de AS (`mcpAuthRouter`, `ProxyOAuthServerProvider`) quedaron congelados en `@modelcontextprotocol/server-legacy/auth`**; la doc dice "Use a dedicated identity provider for new servers" |
| `@modelcontextprotocol/node` 2.1.1, `/express`, `/hono`, `/fastify` | adaptadores | `toNodeHandler`, `createMcpExpressApp`, `mcpAuthMetadataRouter`, `requireBearerAuth` Express | Compatibilidad 2025 con `NodeStreamableHTTPServerTransport` (sesiones opcionales) |
| `mcp-handler` | 2.2.0 (18/9) | Next.js; ambas eras; `withMcpAuth`, `protectedResourceHandler`; sin Redis | Solo Next (peer) |
| `@rekog/mcp-nest` | 2.0.7 (21/9) | NestJS; Streamable HTTP + STDIO; ambas eras; guards; progreso | `@rekog/mcp-nest-auth` (AS **beta**) exige TypeORM + `@nestjs/jwt`: choca con Prisma; usar better-auth como AS |
| `better-auth` + `@better-auth/oauth-provider` + `@better-auth/cimd` + `@better-auth/mcp` + `@better-auth/passkey` | 1.7.7 (30/9) | AS OAuth 2.1 completo (CIMD, DCR opcional `allowDynamicClientRegistration`, DPoP), `requireMcpAuth`, PRM; passkeys con SimpleWebAuthn; adapter Prisma | La doc dice que el plugin MCP "will soon be deprecated in favor of the OAuth Provider Plugin": usar `oauth-provider`+`cimd` directamente. Node-agnóstico (se monta en Nest/Express con `toNodeHandler`) |
| `@cloudflare/workers-oauth-provider` 1.2.2 + `agents` 0.26.0 | (6/10 y 2/10) | AS completo en Workers (KV), `createMcpHandler` stateless | Solo opción C |
| `@hono/mcp` | 0.3.2 (18/8) | aún depende de `@modelcontextprotocol/sdk` ^1.29 | Preferir `@modelcontextprotocol/hono` |

### 3.5 Camino más simple y esfuerzo

1. **MCP local (stdio) para Claude Code** — `apps/mcp-local`: `McpServer` + `StdioServerTransport` del SDK v2; cada tool llama a la API con `Authorization: Bearer $TCG_API_TOKEN` (token de scope `mcp:read`/`mcp:write` emitido por la app). Registro: `claude mcp add --transport stdio tcg -- node apps/mcp-local/dist/main.js` con `--env TCG_API_TOKEN=…`. Las tools se definen una vez en `packages/domain/mcp-tools.ts` (schemas zod + descripciones) y las consume también el remoto. **Esfuerzo: 1–2 días** (la mayor parte es definir tools y texto en español).
   - Variante aún más corta: no hacer stdio y usar directamente el endpoint remoto con `--header "Authorization: Bearer …"`, que Claude Code soporta. Dejaría un solo servidor. El stdio solo vale si querés usarlo sin internet o antes de desplegar.
2. **Conector remoto para las apps de Claude** — mismo proceso (`/mcp` en Nest vía `@rekog/mcp-nest`, o route handler con `mcp-handler` en B). Fase 1: bearer estático (`static_headers`) **si tu cuenta muestra "Request headers"**: 0,5 día. Fase 2 (o única si no aparece): AS OAuth con better-auth `oauth-provider` + `cimd` (login = tu sesión de passkey, pantalla de consentimiento mínima, PRM en `/.well-known/oauth-protected-resource/mcp`, AS metadata con `client_id_metadata_document_supported: true` y `token_endpoint_auth_methods_supported: ["none"]`, PKCE S256, refresh rotado, `/token` form-urlencoded, respuesta <10 s incluso con Neon frío). **Esfuerzo: 2–4 días** incluyendo pruebas con MCP Inspector (`npx @modelcontextprotocol/inspector --cli <url> --transport http --method tools/list`) y túnel (Cloudflare Tunnel/ngrok, agregar host a `allowedHosts`).

Aceptación M8 ("¿cuántas copias jugables tengo de Hoopa ex y qué mazos lo usan?"): dos tools (`collection.playable_copies`, `decks.find_by_card`) sobre `packages/domain`.

---

## 4. Auth de un solo usuario

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **Passkeys / WebAuthn** (`@simplewebauthn/server` 14.0.3, 25/9/2026; o `@better-auth/passkey` que lo envuelve) | Sin contraseña, phishing-resistente, sincroniza entre PC y celular (iCloud/Google Password Manager), UX de un toque en el celular; `signIn.passkey({autoFill})` | Necesitás un segundo factor de recuperación si perdés el dispositivo; `rpID` fijo al dominio | **Recomendado** como método principal |
| Password + TOTP | Simple, sin dependencia de plataforma | Dos pasos en el celular; hay que implementar hashing (argon2id), bloqueo, TOTP (`otplib`) | Como **respaldo/recuperación** |
| **better-auth** 1.7.7 | Una lib: sesiones con cookie, passkey, TOTP, OAuth provider para MCP, adapter Prisma, rate limit integrado | Dependencia grande; algunas partes en movimiento (plugin MCP → oauth-provider) | **Recomendado** porque también resuelve §3 |
| Auth.js (`@auth/core` 0.41.3) credentials | Conocido | La propia doc lo desaconseja; credentials no persiste sesiones en DB (JWT); WebAuthn marcado experimental; no es AS OAuth | No |
| Clerk Free | 50k MRU, prebuilt UI, passkeys | Terceros en el medio de una app de un usuario; vendor lock | No |

Diseño recomendado:
- **Sesión:** cookie `__Host-session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, id aleatorio de 256 bits guardado hasheado (SHA-256) en tabla `session` con expiración deslizante (30 días en el celular). No JWT.
- **Proteger todo, incluida la shell de la PWA:** en Nest, un middleware global exige sesión antes de servir `index.html`, el `manifest.webmanifest` y los chunks; las únicas rutas públicas: `/login`, `/api/auth/*`, `/.well-known/*`, `/api/mcp` (con su bearer/OAuth), `/api/worker/*` (con su token). El service worker solo precachea tras login; en 401 redirige a `/login`. Nota: el SW y el manifest **deben** poder servirse al usuario ya autenticado desde el mismo origen; si la cookie expira, la app "instalada" abre `/login` (correcto).
- **Rate limiting del login:** `@nestjs/throttler` (o rate limit de better-auth): 5 intentos/15 min por IP + por cuenta; passkey falla sin costo.
- **Tokens de worker y MCP:** tabla `api_token { id, name, kind: 'worker'|'mcp', scopes[], token_hash (SHA-256), prefix, last_used_at, expires_at, revoked_at }`; se muestra una sola vez; se compara por hash; scopes `worker:claim`, `mcp:read`, `mcp:write`; pantalla "Tokens" para rotar/revocar. El worker además manda `X-Worker-Id`.

---

## 5. PWA

- **Vite** (`vite-plugin-pwa` **2.0.0**, publicado 3/10/2026, peers vite 3–8, Workbox 7.4): `registerType: 'autoUpdate'`, `generateSW` con `navigateFallback: '/index.html'` y `navigateFallbackDenylist: [/^\/api/]`, no precachear nada autenticado salvo la shell. **Next/serwist** (`@serwist/next` 9.5.13, 4/10/2026; Next ≥14; webpack y guía aparte para Turbopack): `swSrc: app/sw.ts`, `swDest: public/sw.js`, `disable` en dev. Next 16 tiene manifest nativo sin offline.
- **Instalabilidad** [MDN, verificado]: HTTPS, `manifest` enlazado en cada página (`name`, `short_name`, `start_url`, `display: standalone`, `icons` 192 y 512 px, uno `maskable`, `theme_color`), service worker con handler `fetch`. iOS: instala desde el menú Compartir (iOS ≥16.4 también desde Chrome/Edge/Firefox); conviene `apple-touch-icon` 180 px y `apple-mobile-web-app-*`; sin prompt automático. Android/Chrome: `beforeinstallprompt`.
- **Una mano:** barra inferior de 4–5 destinos (Partidas, Mazos, Colección, Sobres, Más), botón primario a la altura del pulgar, tap targets ≥44×44 px, formularios con `inputmode`, `env(safe-area-inset-bottom)`, acciones destructivas lejos del borde inferior, "cargar partida" como hoja (sheet) con 3–4 toques: mazo (últimos usados), resultado (dos botones grandes), rival (autocompletar arquetipos), ¿empecé?, guardar.
- **Componentes:** shadcn/ui + Tailwind 4 + Radix. Los componentes que generás con `npx shadcn add` son MIT en tu repo. **Cualquier archivo copiado de `refs/tracker/frontend/src/components/ui/*` o de su `index.css`/`tailwind.config` es GPL-3.0** (son código del tracker aunque hayan nacido de shadcn): regenerarlos, no copiarlos. Lo mismo para `pages/`, `lib/` y `hooks/`.

---

## 6. Worker en la PC (Windows)

- **Lenguaje:** **Node/TypeScript** (`apps/worker`): comparte `packages/domain` (conversión de mazos a formato deckgym, mapeo de ediciones no implementadas, parsers), un solo toolchain, y spawnea `deckgym.exe`. Rust solo tendría sentido si hiciéramos un wrapper que enlace `deckgym` como lib (`rlib`) → derivado AGPL y necesita el toolchain en la PC. Python: pyo3 también exige compilar. 
- **Obtener el binario (dos vías):**
  1. **GitHub Actions (recomendada):** workflow en tu repo con `runs-on: windows-latest`, checkout de `bcollazo/deckgym-core@fb792ebf…` (commit fijado en `engine.lock.json`), `cargo build --release`, publicar `deckgym-windows-x64-fb792ebf.exe` + `sha256` como Release asset. El worker descarga por tag, verifica el hash y guarda en `%LOCALAPPDATA%\tcg-worker\engines\<commit>\`. Costo: 0 (2.000 min/mes; un build Windows de Rust suele tardar 5–10 min [no verificado]). La PC no necesita MSVC.
  2. **Local:** `winget install Rustlang.Rustup`; `rustup-init` ofrece instalar automáticamente "MSVC v143 - VS 2022 C++ x64/x86 build tools" y "Windows 11 SDK (10.0.22621.0)" (rust-lang.github.io/rustup/installation/windows-msvc.html). Tamaño de los Build Tools: varios GB [no verificado]. Útil para `card_status` y para desarrollar.
- **Ejecutar en segundo plano:** 
  - **Task Scheduler "At log on"** (sin software extra): acción `node C:\…\apps\worker\dist\main.js`, "Run whether user is logged on or not" opcional, reinicio en fallo cada 1 min ×3, `conhost --headless`/`wscript` para ocultar ventana. **Recomendado para arrancar.**
  - **NSSM:** última release 2.24 (31/8/2014), pre-release 2.24-101 (26/4/2017) recomendada para Windows 10+ (nssm.cc/download). Funciona pero está sin mantenimiento.
  - **WinSW** 2.12.0 (28/1/2023; 3.0 en alpha) — servicio real con XML, mantenido por Jenkins.
  - **pm2:** `pm2 startup` no soporta Windows; la doc remite a `pm2-installer` (pm2.keymetrics.io/docs/usage/startup). Más piezas que valor acá.
- **Protocolo saliente (todo HTTPS, token con scope `worker:claim`):**
  1. `POST /api/worker/jobs/claim` `{workerId, engineCommit, cores, protocol}` → `200 {job}` o `204`. En Fly: long-poll hasta 25 s. En Vercel: respuesta inmediata y el worker espera 10–30 s; si recibe `204` tres veces seguidas, backoff a 5 min (deja dormir a Neon; con `Retry-After` el servidor puede sugerirlo).
  2. El job se entrega en **chunks** `{jobId, chunkIdx, deckA, deckB, games, seed, bots, cores}` con *lease* de 3 min. `PUT /api/worker/jobs/:id/chunks/:idx/heartbeat` `{gamesDone}` cada 30 s renueva el lease y alimenta el progreso (SSE o polling en la UI). Lease vencido → chunk vuelve a `queued` (attempt+1, máx 3).
  3. `PUT /api/worker/jobs/:id/chunks/:idx/result` `{winsA, winsB, ties, games, durationMs, engineCommit, stdoutDigest}` idempotente por `(jobId, chunkIdx, attempt)`: reenviar es seguro.
  4. Replays: si el chunk pide muestra, el worker corre con `--replay-dir tmp --replay-sample N`, comprime (gzip) y sube a R2 con URL prefirmada S3 (`PUT`) que el claim ya trae; luego informa las claves. Nada de replays por la API.
  5. Reanudación: estado local en `%LOCALAPPDATA%\tcg-worker\state.json` (chunk en curso, pid); al reiniciar, si el lease sigue vivo, reanuda/heartbeat; si no, abandona y pide otro. Determinismo: `seed` por chunk → re-ejecutar da el mismo resultado.
  6. Concurrencia: un proceso `deckgym simulate … --parallel -j <cores>` por chunk (`cores` configurable en la UI del worker; tu PC tiene 20 hilos lógicos). Para `optimize` igual (`--parallel`).
  7. **Parser de salida:** `simulate` imprime texto (`print_stats`, `src/simulate.rs:531-563`, con `num-format` → "10,000"). Parsear con regex fijada al commit y guardar el stdout crudo en el resultado; alternativa limpia: PR upstream con `--json` (contribución AGPL, sin derivados en nuestro lado). Las partidas no simulables se detectan antes con `card_status` (4.271/4.317; mapear las 46 reimpresiones B4b por texto idéntico).
- **Dónde guardar resultados:** agregados y por-chunk en **Postgres** (filas chicas); replays en **R2** (10 GB gratis, egress 0) referenciados por clave; en la UI, el viewer de deckgym (Vite/React/Pixi) se puede embeber como paquete aparte leyendo `?url=` de un endpoint autenticado que hace proxy al objeto (R2 → API → navegador) o con URL prefirmada de lectura corta.

---

## 7. Backups

- **Export/Import total (app):** `GET /api/backup/export` → `tcgpocket-backup-YYYYMMDD.json.gz` con `{schemaVersion, exportedAt, catalogCommit, engineCommit, collectionSnapshots[], adjustments[], decks[] (con historial), matches[], tournaments[] (opcional, re-sincronizable), simulationJobs[]+results[], tokens[] (solo metadatos), settings}`; `POST /api/backup/import` con modo `replace` (transacción única, valida `schemaVersion`, migra si es menor) y `dry-run` que devuelve el diff. Excluir replays (pesan; opción "incluir claves R2"). Acceptance: export → import en DB vacía → export produce JSON idéntico salvo `exportedAt`.
- **Automático:** un cron (en Nest `@nestjs/schedule`; en Vercel el cron diario) sube el export a R2 `backups/YYYY/MM/DD.json.gz` con retención 30 días. Opcional: también a Google Drive (tenés conector).
- **Proveedor:** Neon Free: **6 h de history/PITR** (restore a cualquier punto dentro de la ventana, branches instantáneos sin costo extra de retención) — útil para "borré algo hace 2 horas", no como backup. Supabase Free: sin backups. Fly Postgres: no lo usamos. → el JSON diario a R2 es la red de seguridad real.

---

## 8. Licencias en esta arquitectura (práctico, no es asesoramiento legal)

| Pieza | Licencia | Qué hacemos | Uso privado de 1 usuario | Si se abre a otros |
|---|---|---|---|---|
| tracker (`cards.json`, traducciones, `CardsDB.ts`, `stats.ts`, `MissionsDB.ts`) | GPL-3.0 | Copiar datos y **portar** `stats.ts`/`CardsDB.ts` a `packages/domain` (es trabajo derivado) | Sin obligación de publicar nada: la GPL obliga al distribuir, no al usar; anotar origen y commit en `docs/LICENCIAS.md` | Si distribuís el código o el SaaS lo usan terceros: GPL no cubre uso en red (eso es AGPL), pero si entregás binarios/código a otros, todo lo derivado (`packages/domain` y lo que lo enlace: API, worker, MCP) debe ir bajo GPL-3.0 con fuentes. Los **datos** (`cards.json`) son hechos del juego; el archivo como tal viene del repo GPL: citar |
| deckgym-core | AGPL-3.0 | Binario aparte, commit fijado, invocado por `spawn`; sin modificar | Nada que publicar | Ejecutar el binario sin modificar y hablarle por CLI/stdin **no** hace derivado al worker ("mere aggregation"). Si algún día lo modificás y lo usan terceros por red, AGPL §13 obliga a ofrecer las fuentes modificadas; si lo compilás y redistribuís (p. ej. Release de GitHub público), ofrecer fuente (basta el commit upstream). Un wrapper Rust que enlace `deckgym` como lib o pyo3 sería derivado AGPL |
| viewer de deckgym | AGPL-3.0 | Si lo embebemos tal cual (build estático servido por nuestra app) | Nada | Servirlo a terceros por red = AGPL: hay que ofrecer su fuente (sin modificar: enlace al commit); si lo modificás, publicar cambios |
| shadcn generado | MIT | Generar en nuestro repo | — | — |
| Código copiado del tracker (componentes, páginas) | GPL-3.0 | **No copiar**; regenerar | — | — |
| Imágenes de cartas | © The Pokémon Company | Solo enlaces | — | — |

Regla práctica: mantener `packages/domain` con cabecera "Portions derived from marcelpanse/tcg-pocket-collection-tracker (GPL-3.0) @3ab58f1" y asumir que, si algún día se abre la app, **toda la app se publica GPL-3.0** (compatible con AGPL para el motor que corre aparte). Nada de esto impide el uso privado.

## Recomendaciones
## Recomendación de stack (decisión para que apruebes)

**Elegir A' (híbrida): monorepo pnpm con NestJS como proceso único en Fly.io + Neon Free + Cloudflare R2.**

- `apps/web`: React 19 + Vite 8 + `vite-plugin-pwa` 2 + Tailwind 4 + shadcn (regenerado) + TanStack Query + react-router. Bottom nav, hoja de "cargar partida" en ≤4 toques.
- `apps/api`: NestJS 12 (Express, por el peer de `@rekog/mcp-nest`), Prisma 7 (`@prisma/adapter-pg`, `prisma.config.ts`), sirve `apps/web/dist` detrás del middleware de sesión, `@nestjs/schedule` para Limitless (incremental diario + backfill por trozos con limitador 10 req/min), cola del worker con long-poll de 25 s, SSE de progreso, `/api/mcp` con `@rekog/mcp-nest` (ambas eras), better-auth montado con `toNodeHandler` (passkey + TOTP de respaldo + `oauth-provider` + `cimd`).
- `apps/worker`: Node, Task Scheduler al logon, binario `deckgym` fijado a `fb792ebf` y compilado por GitHub Actions (windows-latest), chunks con lease/heartbeat/resultado idempotente, replays gzip a R2 por URL prefirmada.
- `apps/mcp-local` (opcional, 1 día): stdio para Claude Code llamando a la API con token. Si preferís menos piezas, Claude Code usa directamente el remoto con `--header`.
- `packages/domain`: TS puro, vitest 5, sin React/Nest: port de `stats.ts`/`CardsDB.ts`, conteo de copias por `alternate_versions`, validación de mazos, Wilson, importadores/exportadores, definición de tools MCP.
- Hosting: Fly `shared-cpu-1x` 512 MB, `auto_stop_machines="suspend"`, `min_machines_running=0` (subir a 1 si el despertar molesta: 3,69 US$/mes), IPv4 compartida (no pagar la dedicada), Neon Free (región cercana a Fly, p. ej. `gru`/`iad`), R2 bucket privado. **Costo estimado: 2–4 US$/mes.**

**Si querés 0 US$ estrictos:** opción B (Next.js 16 + `mcp-handler` 2 + better-auth + serwist en Vercel Hobby + Neon Free), con short-poll (≤30 s, backoff 5 min) en vez de long-poll, backfill de Limitless disparado por el worker (`POST /sync/step`) o por GitHub Actions cada 5 min, y asumiendo App Router como aprendizaje.

**Descartar:** Cloudflare (C) por curva y D1/SQLite; Render Free por el minuto de cold start y el Postgres que expira; Koyeb por 0,1 vCPU y la adquisición; Prisma Postgres y Turso por límites/incertidumbre; Clerk y Auth.js.

## Orden sugerido de la Fase 1 (impacta en M8 temprano)
1. Día 1: crear cuenta Fly + Neon + R2; **probar en claude.ai si tu cuenta Pro/Max muestra "Request headers"** al agregar un conector (define si el MCP remoto arranca con bearer o con OAuth).
2. Esqueleto monorepo + `packages/domain` con tests (M1/M2 lógica) + Prisma schema.
3. Auth (passkey + TOTP) + deploy en Fly con la PWA protegida.
4. M1/M2/M3 + backup JSON.
5. Adelantar un **M8 de solo lectura** (brief §6 lo permite): con `packages/domain` listo son ~2 días y te deja consultar desde Claude Code antes de M4–M7.

## Decisiones menores que anotaría en `docs/DECISIONES.md`
- MCP: SDK v2 (`@modelcontextprotocol/server` 2.3.x) desde el día 1; servir ambas eras; nunca `@modelcontextprotocol/sdk` 1.x.
- Tokens: aleatorios 32 bytes base64url con prefijo `tcg_wk_`/`tcg_mcp_`, hash SHA-256 en DB, scopes, revocables, `last_used_at`.
- Cola: tabla `simulation_chunk` con `status`, `lease_until`, `attempt`, resultado idempotente por `(job_id, chunk_idx, attempt)`.
- Polling idle: `Retry-After` creciente hasta 300 s cuando no hay trabajo, para que Neon suspenda.
- Replays: gzip, clave `replays/<jobId>/<chunkIdx>/<gameId>.json.gz` en R2; borrar al archivar el job.
- deckgym: parser de stdout fijado al commit + stdout crudo guardado; abrir PR upstream `--json` si hay tiempo.

## Riesgos
| Riesgo | Impacto | Mitigación |
|---|---|---|
| **`static_headers` no visible en tu cuenta** (la doc de desarrollador lo marca "beta, limited set of organizations"; soporte lo muestra para Pro/Max) | El conector remoto para las apps de Claude necesitaría OAuth desde el principio (+2–4 días) | Probar el día 1; diseñar el endpoint MCP con `requireBearerAuth` + verificador que acepte tanto tokens estáticos como access tokens de better-auth, para que agregar OAuth no cambie el servidor |
| **Claude sigue en protocolo 2025 mientras el SDK v2 es 2026-07-28** | Si solo servimos 2026-07-28, claude.ai no conecta | Usar mcp-handler/MCP-Nest/SDK v2 con fallback legacy stateless (documentado) y verificar con MCP Inspector `--transport http` y con un conector real antes de dar M8 por cerrado |
| **Neon Free: 100 CU-h/mes** con polling continuo | Compute suspendido o errores al final del mes | Backoff del worker cuando la cola está vacía; en Nest, cachear "cola vacía" en memoria 60 s; alternativa Supabase Free (sin tope de horas, pausa a los 7 días) |
| **Fly.io sin free tier y con tarjeta**; auto-stop despierta en segundos | Costo pequeño pero no cero; primer toque del día lento | `min_machines_running=1` (3,69 US$/mes) o aceptar; alternativa B a 0 US$ |
| **Prisma 7/8 en transición** (driver adapters, `prisma.config.ts`, 8.0 RC) | Fricción al arrancar, docs mezcladas | Fijar `prisma@7.x` + `@prisma/client@7.10` + `@prisma/adapter-pg`; no usar RC |
| **better-auth en movimiento** (plugin MCP "will soon be deprecated", 1.7.x) | Cambios de API durante el proyecto | Fijar 1.7.7; usar `oauth-provider`+`cimd`, no `@better-auth/mcp`; encapsular tras un módulo propio |
| **Parser de stdout de deckgym** (texto con separadores de miles) | Resultados mal leídos si cambia el formato | Fijar commit, test de parser con salida real, guardar stdout crudo, PR upstream `--json` |
| **Replays: tamaño no medido** (estimé 300 KB/partida, 4,6 GB para 40×40×10) | R2 free (10 GB) podría quedar corto si se guardan más | Medir en la primera corrida; gzip; muestra por cruce ≤5; borrado al archivar |
| **GPL/AGPL si algún día abrís la app** | Obligación de publicar fuentes | Mantener `docs/LICENCIAS.md`, no copiar UI del tracker, deckgym sin modificar y por CLI |
| **Vercel Hobby (si elegís B): memoria GB-h con long-poll; cron solo diario** | Pausa de funciones 30 días si se excede | Short-poll; backfill disparado por el worker o GitHub Actions |
| **Build de deckgym en GitHub Actions**: minutos Windows y toolchain | Si el repo es privado, cada build consume minutos ×2 | Cachear `~/.cargo` y `target`; compilar solo cuando cambia el commit fijado |
| **Rate limit de Limitless compartido** (50 req/5 min, varios procesos en la misma máquina) | Bloqueos si worker y API lo llaman a la vez | Un único cliente Limitless con limitador en la API; el worker nunca llama a Limitless directo (o solo si la API delega explícitamente) |

## Preguntas abiertas
1. **¿Preferís 2–4 US$/mes con NestJS (A') o 0 US$ con Next.js (B)?** Es la decisión que más cambia el código (proceso persistente vs funciones).
2. **¿Tenés plan Pro o Max en claude.ai y querés que confirme hoy si aparece "Request headers" al agregar un conector custom?** (Lo podés probar vos en 5 minutos: Customize → Connectors → Add custom connector → mirar si hay sección Request headers). Define si el MCP remoto empieza con bearer o con OAuth.
3. **¿Querés el MCP local stdio además del remoto?** Claude Code puede usar el remoto directamente con `--header`; el stdio solo aporta uso sin desplegar/offline.
4. **¿Aceptás instalar Rust + MSVC Build Tools (varios GB) en la PC, o preferís que el binario de deckgym lo compile GitHub Actions y el worker lo descargue?** Mi recomendación es la segunda.
5. **¿Cómo querés que arranque el worker?** Tarea programada al logon (simple, requiere sesión iniciada) vs servicio real (NSSM/WinSW, arranca sin login).
6. **¿Cuántos núcleos querés reservar por defecto para simulaciones?** (tu PC tiene 20 hilos lógicos / 16 GB).
7. **Dominio:** ¿tenés uno? Las passkeys quedan atadas al `rpID` (dominio); cambiarlo después obliga a re-registrarlas. `*.fly.dev` o `*.vercel.app` sirven pero mejor un dominio propio desde el inicio.
8. **¿Está bien crear cuentas en Fly.io (tarjeta), Neon y Cloudflare (R2)?** Todas gratis salvo Fly.
9. **"Nada se sirve sin autenticar":** ¿incluye los chunks JS de la PWA (literal) o alcanza con que ningún dato salga sin sesión? Con Nest es literal sin esfuerzo; con Next.js los `/_next/static` quedan públicos por defecto.
10. **Replays:** ¿cuántas muestras por cruce querés guardar (propongo 5) y por cuánto tiempo?

## Fuentes
## Archivos locales (leídos 6/10/2026)
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\BRIEF.md` (secciones 3, 4, 5-M7/M8, 6)
- `C:\Users\<usuario>\Personal\tcg pocket\Docs\context\guia_del_proyecto.md`
- `C:\Users\<usuario>\Personal\tcg pocket\refs\deckgym-core\Cargo.toml` (crate-type, features, rayon, pyo3) · `src\main.rs:29-80` (flags de `simulate`) · `src\simulate.rs:499-563` (`print_stats`, salida en texto) · `src\replay\mod.rs:20-80` (`Replay`, `ReplayStep`) · `docs\bot-protocol.md:1-60` · `viewer\package.json` · `LICENSE.txt` (AGPL-3.0) · `git log -1` = `fb792ebf…` 2026-10-04
- `C:\Users\<usuario>\Personal\tcg pocket\refs\tracker\frontend\package.json` · `frontend\components.json` (shadcn new-york) · `frontend\src\lib\stats.ts:1-3` · `frontend\src\lib\CardsDB.ts:1` · `frontend\src\components\ui\*` · `LICENSE` (GPL-3.0) · `git log -1` = `3ab58f1…` 2026-10-01
- `C:\Users\<usuario>\Downloads\tcgcollectiontracterexport (2).csv` (solo cabecera: BOM UTF-8, `Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected`)
- Entorno: `node -v` = v24.19.0; `os.cpus()` = 20, 16 GB; `where cargo/rustc/nssm/pm2` sin resultado

## MCP y Claude (verificado 6/10/2026)
- https://modelcontextprotocol.io/specification/latest/changelog (2026-07-28 vs 2025-11-25)
- https://modelcontextprotocol.io/specification/latest/basic/authorization
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- https://modelcontextprotocol.io/docs/develop/connect-local-servers (Claude Desktop, `claude_desktop_config.json`)
- https://www.claude.com/docs/connectors/building/authentication (tipos de auth, CIMD/DCR, callbacks, 10 s, egress 160.79.104.0/21)
- https://www.claude.com/docs/connectors/building (Streamable HTTP; specs 2025-03-26/06-18/11-25)
- https://www.claude.com/docs/connectors/building/testing (Inspector, `initialize`/`clientInfo`)
- https://support.claude.com/en/articles/11175166-about-custom-connectors-remote-mcp (planes Free/Pro/Max/Team/Enterprise; paso "Request headers" en Pro/Max)
- https://code.claude.com/docs/en/mcp (`claude mcp add --transport http … --header`, scopes, OAuth, SSE deprecado)
- GitHub `modelcontextprotocol/typescript-sdk` main: `README.md`, `docs/serving/authorization.md`, `docs/serving/sessions-state-scaling.md`; releases v2.3.1 / 1.32.1 (2026-10-05)
- GitHub `vercel/mcp-handler` README (2.x, ambas eras, sin Redis); `rekog-labs/MCP-Nest` README y releases v2.0.7 (2026-09-21); `cloudflare/workers-oauth-provider` README (KV, CIMD, RFCs)
- https://developers.cloudflare.com/agents/model-context-protocol/transport/ y /authorization/
- https://better-auth.com/docs/plugins/mcp · /docs/plugins/oauth-provider · /docs/plugins/passkey
- https://authjs.dev/getting-started/authentication/credentials
- Registro npm (`registry.npmjs.org`, 6/10/2026): versiones y peers de `@modelcontextprotocol/*`, `mcp-handler`, `@rekog/mcp-nest(-auth)`, `better-auth` y plugins, `@simplewebauthn/server`, `agents`, `@cloudflare/workers-oauth-provider`, `hono`, `@hono/mcp`, `@nestjs/core`, `next`, `prisma`, `@prisma/client`, `drizzle-orm`, `vite-plugin-pwa`, `@serwist/next`, `serwist`, `vitest`, `react-router`, `@tanstack/react-query`, `zod`, `@auth/core`, `next-auth`
- Búsquedas de contexto (no oficiales): dev.to "remote MCP on Claude iOS/Android"; thepromptshelf/sunpeak sobre la partición del SDK v2 (27/7/2026); descope/strata sobre CIMD

## Hosting / DB / storage (verificado 6/10/2026)
- https://vercel.com/docs/plans/hobby (last_updated 2026-09-14) · https://vercel.com/docs/limits (2026-09-16) · https://vercel.com/docs/cron-jobs/usage-and-pricing (2026-07-15) · https://vercel.com/docs/functions/usage-and-pricing (2026-06-16) · https://vercel.com/docs/vercel-blob/usage-and-pricing (2026-09-23)
- https://neon.com/pricing · https://neon.com/docs/introduction/scale-to-zero
- https://supabase.com/pricing
- https://render.com/docs/free
- https://docs.fly.io/about/pricing · https://docs.fly.io/launch/autostop-autostart/
- https://docs.railway.com/reference/pricing/plans
- https://developers.cloudflare.com/workers/platform/limits/ · /workers/platform/pricing/ · /d1/platform/pricing/ · /durable-objects/platform/pricing/ · /r2/pricing/
- https://www.koyeb.com/docs/reference/instances · https://www.koyeb.com/docs/faq/pricing
- https://www.prisma.io/pricing · https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- https://turso.tech/pricing
- https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows

## PWA / Windows / Rust (verificado 6/10/2026)
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_Installable (vía búsqueda)
- https://vite-pwa-org.netlify.app/guide/ · https://serwist.pages.dev/docs/next/getting-started
- https://rust-lang.github.io/rustup/installation/windows-msvc.html
- https://nssm.cc/download · GitHub `winsw/winsw` releases (v2.12.0, 2023-01-28) · https://pm2.keymetrics.io/docs/usage/startup/

## Cálculos propios (script Node en scratchpad, 6/10/2026)
- Presupuesto de polling en Vercel Hobby (tabla §1.3), CU-h de Neon con polling 24/7 (180 > 100), costo Fly 512 MB a 8 h/día (1,23 US$), tamaño estimado de replays (4,6 GB para 40×40×10 a 300 KB)

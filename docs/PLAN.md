# Plan · App personal de Pokémon TCG Pocket

Fase 0 · 6 de octubre de 2026 · Estado: **para revisión** (no se escribió código de la app). Revisión 2: incorpora una revisión adversarial del plan contra el brief, el código de los dos repositorios y los datos reales.

Este documento responde a `BRIEF.md` §6 Fase 0: comparación de stack y recomendación, arquitectura, modelo de datos, integración de cada pieza reutilizada con su licencia, riesgos, plan de fases con criterios de aceptación y preguntas abiertas. Todo lo que afirma se verificó el 6/10/2026 leyendo los dos repositorios clonados en `refs/`, corriendo scripts descartables sobre `cards.json`, `database.json` y tu exportación de hoy, y consultando la API de Limitless y la documentación vigente. Los informes de investigación y los datos crudos están en `docs/fase0/`. (Carpeta `docs/`, renombrada al crear el repo.)

---

## 0. Resumen para decidir

**Stack recomendado.** Monorepo pnpm en TypeScript con cuatro piezas: `packages/domain` (toda la lógica del juego como funciones puras con tests sobre tus datos reales), `apps/api` (NestJS como **un solo proceso**: sirve la PWA, expone la REST, la cola del worker, el scheduler de Limitless y el endpoint MCP; Prisma 7 sobre Postgres), `apps/web` (React + Vite, PWA instalable, texto primero) y `apps/worker` (Node en tu PC Windows, que descarga y ejecuta el motor). Hosting: **Fly.io** con una máquina chica siempre encendida (**≈ 4 US$/mes**; con auto-suspensión el scheduler interno no corre) + **Supabase Free** (Postgres siempre encendida, 500 MB, más 1 GB de almacenamiento para repeticiones y backups; Neon Free es la alternativa: 1 GB y restauración puntual, pero con tope de horas de cómputo que el worker consume). Si querés 0 US$ exactos, la opción con otro código es Next.js en Vercel Hobby; Render Free corre el mismo contenedor pero duerme a los 15 minutos (sección 2). Si tu cuenta de Claude no permite header fijo, un servidor OAuth externo gratis (Descope o WorkOS) resuelve el conector remoto en 1–2 días (Apéndice E).

**Motor.** deckgym-core no se modifica y queda fijado al commit `fb792ebf`. Propongo no ejecutar su binario `deckgym` sino `engine-cli`, un ejecutable propio en Rust de 500–800 líneas que enlaza deckgym como biblioteca al commit fijado y corre como proceso aparte en tu PC; se compila en GitHub Actions y el worker lo descarga verificando el hash, así que vos no instalás Rust ni lo tocás. Motivo: el CLI original no emite resultados agregados legibles por máquina, con `--seed` repite la misma partida N veces, no valida mazos y no permite la métrica de consistencia. Hay dos alternativas en la pregunta A5 (fork con parche mínimo; CLI intacto).

**Desvíos respecto del brief** (para que los apruebes explícitamente): (1) `engine-cli` reinterpreta «binario aparte» como «proceso aparte» y, por enlazar código AGPL, es obra derivada AGPL (sin consecuencias mientras no se distribuya); (2) el orden de fases adelanta el registro de partidas (M6) y un Claude de solo lectura (M8) antes de sobres y torneos; (3) el modelo de sobres corrige dos bugs del tracker por defecto y mantiene un conmutador «modelo del tracker» en la UI para cumplir el criterio «coincide con el tracker»; (4) la «detección del formato vigente» se resuelve por fecha de lanzamiento con control cruzado contra las listas, porque Limitless no publica el formato de los torneos Standard.

**Esfuerzo estimado:** ~8–9 semanas de trabajo de Claude Code con tus revisiones hasta la Fase 7, orientativo.

**Los tres riesgos más grandes** (sección 6): (1) el catálogo del tracker **cambia `internal_id` entre commits** y cada set nuevo reescribe los grupos de los sets viejos; (2) el **motor no alcanza tal cual** para lo que pide M7 y su reproducibilidad entre procesos no está garantizada; (3) el **conector remoto para las apps de Claude** puede exigir OAuth porque la autenticación por header fijo figura «en beta para un conjunto limitado de organizaciones».

**Qué necesito que respondas** (sección 8, bloque A): stack y hosting, base de datos, autenticación y dominio, cinco puntos del modelo de datos, la decisión sobre el motor, y permisos para crear el repo y las cuentas. El resto tiene un valor por defecto que aplico salvo que digas lo contrario.

---

## 1. Qué verifiqué

| Qué | Resultado (6/10/2026) |
|---|---|
| Repositorios | tracker `marcelpanse/tcg-pocket-collection-tracker` @ `3ab58f1` (1/10/2026, «add Deluxe Pack: Mega (B4b)»); deckgym-core `bcollazo/deckgym-core` @ `fb792ebf` (4/10/2026). Coinciden con el brief. Clonados en `refs/` (no se versionan). |
| Catálogo | `cards.json`: **4.317** cartas, 24 expansiones, **3.866** `internal_id` distintos (450 ids compartidos por 901 filas: 449 pares y un trío, Ámbar Viejo), **2.319** grupos funcionales (`alternate_versions`), 1.383 nombres, **555** nombres con más de un grupo (Riolu, Dratini, Eevee con 12…). `alternate_versions` es exactamente «misma carta funcional»: 0 grupos con texto distinto tras limpiar el ruido de scraping, 0 pares con mismo nombre y texto en grupos separados. |
| Nombres en español | Reimplementé `getCardNameByLang` con los tres JSON de traducciones: **4.317/4.317** coinciden con la columna `CardName` de tu CSV, 0 cartas caen al inglés, 0 colisiones es↔en. No existe texto de ataques en español en ningún repo ni en Limitless; TCGdex llega solo hasta B2a. |
| Tu colección (`docs/context/tcgcollectiontracterexport-2026-10-06.csv`, exportada hoy; sha256 `f774c6e4…17e8`, 225.937 bytes) | 4.317 filas en el mismo orden que `cards.json`, BOM UTF-8, LF, sin comillas, 0 ids desconocidos. 451 filas repiten un `InternalId` anterior y en los 451 casos repiten cantidad y bandera. Suma ingenua **5.844**, deduplicada **4.714** copias; 2.083 ids distintos marcados `Collected`; 1.255 grupos con ≥2 copias, 1.853 con ≥1, 466 con 0. `B1a-28` tiene 0 copias y `Collected=TRUE` (la bandera es independiente). |
| Criterios de aceptación de M2 | Mega-Mawile ex = **2** (B2-113:1 + B2-201:1; B4b-157 comparte id con B2-113 y no suma). Globito = **3** (B3b-64:1 + B4b-372:2; B4b-206 comparte id con B3b-64). Bulbasaur A1-1 = **3** (A1-1:2 + A1-227:1; A4b-1 repite el 65600 y se descarta). Además: Latias **2** y Latios **2** (ya corregidos en el tracker), Espeon ex 2, Mega-Sharpedo ex 1, Hoopa ex 1, Hydreigon 1, Milotic ex 1, Greninja A1-89 **1** (`mazos_40_listas.md` decía 0 el 5/10), Riolu A2-91 = 1, Riolu B3-79 = 9, Tapu Lele 0, Capa Hoja 0. |
| Tus 40 mazos | Los 40 parsean desde `mazos_40_listas.md`: 20 cartas, ≤2 por nombre, ≥1 Básico, 0 nombres ambiguos, 0 códigos desconocidos; **los 40 están completos contra el CSV de hoy** (0 cartas faltantes). Los nombres de Entrenador sin código resuelven a un único grupo (0 ambiguos entre 163). El archivo no tiene líneas de energía por mazo: la energía está solo en la columna «Energía» de la tabla resumen («Fuego + Rayo», «Cualquiera»). |
| Importador/exportador del tracker | Exige `Id, InternalId, NumberOwned, Collected`; upsertea todas las filas (0 incluido, no borra); `Collected FALSE` solo baja la bandera; deduplica por `InternalId` quedándose con la primera fila. Escribe con SheetJS: BOM, LF, sin comillas, `TRUE/FALSE`. |
| Modelo de sobres (`stats.ts`) | Copia literal ejecutada con node contra un port limpio: **diferencia 0** en 29 sobres × 3 filtros. Todas las tablas por posición suman 100,000 salvo Deluxe posición 3 = 99,999 (igual que la tabla oficial redondeada). Coincide con las tasas oficiales/comunitarias. Dos bugs reales (Apéndice A.3). `containsLinkedCards` **no interviene** en probabilidades: es una directiva del scraper (commit `e0b0d090`, fix #855) que significa «las reimpresiones de igual rareza comparten `internal_id`». Lo que define el sobre Deluxe es `cardsPerPack === 4`. |
| deckgym | 4.317 ids de `database.json` mapean 1:1 al tracker (`A1a 001` ↔ `A1a-1`), 0 diferencias de nombre, 1 de HP (`P-A 22`: 50 vs 60), 600 solo de notación de rareza. Réplica de `card_status` sin compilar: **4.271 implementadas / 46 no**, todas Entrenadores de B4b (12 Objetos + 34 Partidarios) y las 46 tienen una edición implementada con texto idéntico (lista en `docs/fase0/deckgym-no-implementadas-fb792ebf.json`). Empate si el turno global supera 30 (`state/mod.rs:742`), lo que probablemente explica el 63 % de empates con bots al azar (a confirmar en Fase 6). `simulate` no valida mazos y con `--seed` las N partidas son idénticas (`simulate.rs:247`). Mazo 9 (todo Dragón) y mazo 10 (todo Incoloro) hacen panic si no se declara `Energy:`. Los bots usan solo el generador aleatorio de la partida, pero hay ramas de ataque multiobjetivo que iteran un `HashMap`: la reproducibilidad entre procesos no está garantizada. |
| Limitless | Sin API key: `/tournaments` (paginado, `limit=500` funciona), `/tournaments/{id}/details`, `/standings`, `/pairings`. Límite `50-in-5min` por IP con contadores inconsistentes entre backends. Los torneos Standard vienen con `format: null` (`format=STANDARD` devuelve `[]`); `CUSTOM` son reglas caseras. 5,2 torneos/día en los últimos 41 días, 88 % con ≥16 jugadores. 6.306/6.306 referencias de listas mapean a `card_id` como `<set>-<number>`. El botón «Copy to Clipboard» de una decklist produce `<count> <name> <SET> <NUMBER>` + `Energy: X`, **byte-compatible con el parser de deckgym**. El juego solo comparte mazos por código QR (ids internos del juego, no set/número). Respuestas crudas guardadas en `docs/fase0/limitless/`. |
| Hosting y MCP | Spec MCP vigente 2026-07-28 (sin sesiones ni handshake) pero las apps de Claude siguen hablando la era 2025; `@rekog/mcp-nest` 2.0.7, `mcp-handler` 2.2 y el SDK v2 (`@modelcontextprotocol/server` 2.3) sirven ambas sin estado. Header fijo (`static_headers`) «beta, para un conjunto limitado de organizaciones» según la doc de desarrollador; el artículo de soporte lo muestra también para Pro/Max. Claude Code acepta `--header "Authorization: Bearer …"`. Neon Free: 1 GB, 100 CU-h/mes, suspende a los 5 min. Fly.io: sin free tier, shared-cpu-1x 512 MB = 3,69 US$/mes a tiempo completo; con auto-suspensión la máquina se para cuando no hay tráfico **entrante**, timers incluidos. Vercel Hobby: funciones 300 s, cron solo diario, uso no comercial. |
| Tu PC | Windows 11 Pro, 20 hilos lógicos, 16 GB. node 24, git, gh (autenticado), curl. **Sin** cargo/rustc. |

---

## 2. Stack: comparación y recomendación

Criterios del brief: costo, catálogo y modelo de sobres en TypeScript, motor en Rust como binario, que vos lo mantengas (React, NestJS, Postgres, Prisma en producción).

| | **A · NestJS proceso único en Fly.io + Supabase/Neon** (recomendada) | B · Next.js en Vercel Hobby + Neon | C · Cloudflare Workers + D1 |
|---|---|---|---|
| Costo/mes | **≈ 4 US$** (shared-cpu-1x 512 MB con `min_machines_running = 1`, 3,69 US$; IPv4 compartida; Supabase o Neon 0). Con auto-suspensión (`min = 0`) baja a ~1–2 US$ pero el scheduler interno se congela sin tráfico entrante y los jobs habría que dispararlos desde afuera (GitHub Actions cada 15 min) | 0 US$ (plan personal, no comercial) | 0 o 5 US$ (el plan gratis limita a 10 ms de CPU por request: justo para el diff de 4.317 filas o agregar 12 k listas) |
| «Cargar partida» desde el celu con la PC apagada | 0 con `min = 1`; segundos si estuviera suspendida | ~1 s (función fría + Neon) | ~0 |
| Sync de Limitless (50 req/5 min → backfill de ~300 torneos en 1–1,5 h) | scheduler en proceso con limitador en memoria (requiere `min = 1`) | cron solo diario ±59 min; el backfill lo tiene que disparar el worker o GitHub Actions cada 5 min | cron por minuto |
| Cola del worker | long-poll de 25 s gratis; SSE de progreso | solo short-poll (long-poll 24/7 excede las 360 GB-h del plan) | Durable Objects |
| MCP remoto (era 2025 + 2026-07-28) | `@rekog/mcp-nest` | `mcp-handler` (muy documentado) | `agents` + `workers-oauth-provider` (necesita KV) |
| «Nada se sirve sin autenticar» literal | un middleware antes de `index.html` y los chunks | `/_next/static/*` queda público salvo matcher explícito | sí |
| Qué tenés que aprender | Fly (`fly.toml`, Dockerfile), vite-plugin-pwa | App Router/RSC, serwist, pensar cada job como un paso ≤300 s | casi todo (wrangler, bindings, D1 = SQLite, Drizzle) |
| Postgres + Prisma | sí | sí | no |

**Recomendación: A.** Vercel ahorra ~4 US$/mes a cambio de rediseñar jobs, cola y la shell pública, y de aprender App Router; Cloudflare es la curva más larga y deja Postgres. Render Free corre el mismo Dockerfile a 0 US$, pero duerme a los 15 minutos, tarda ~1 minuto en despertar, y mantenerlo despierto con el polling del worker consume las 750 horas mensuales del plan (zona gris de sus términos).

**Base de datos (pregunta A2).** Tras evaluar las herramientas que me pasaste, cambio la recomendación de Neon a **Supabase Free**: Postgres estándar (mismas extensiones y `SKIP LOCKED`), región `sa-east-1` o `us-east-1` junto a Fly, **siempre encendida y sin tope de horas de cómputo**, así que el polling del worker deja de ser un riesgo y la DB nunca está fría cuando el conector de Claude pide un token; incluye 1 GB de almacenamiento de archivos (S3) para repeticiones y backups, y `pg_cron` + `pg_net` por si algún día querés que la DB despierte a Fly en vez de pagar `min = 1`. A cambio: 500 MB en vez de 1 GB (los replays y el crudo de Limitless van a Storage, no a Postgres), sin restauración puntual (el export diario a Storage es la red de seguridad) y pausa tras 7 días sin actividad (la actividad del scheduler la evita; si se pausara, se restaura con un clic y nada se pierde). Neon Free queda como alternativa si preferís restauración puntual de 6 h y 1 GB aceptando el tope de 100 CU-h/mes. No conviene usar Supabase Auth ni Edge Functions: el login sigue en Nest.

**Stack concreto** (versiones vistas en npm el 6/10/2026; se fijan en Fase 1):

- Monorepo **pnpm** + TypeScript 6 + **vitest** 5 + biome. Código, identificadores y commits en inglés; UI en español. `zod` ≥ 4.3.5 en una sola versión en todo el workspace (lo exigen `@rekog/mcp-nest` y el SDK MCP).
- `packages/domain`: TS puro, cero frameworks. Port de `stats.ts` y de las constantes de `CardsDB.ts`, conteo de copias, validación de mazos, gramáticas de importación/exportación, Wilson, eras y formatos, scoring de sobres, parsers de Limitless y del motor, definición de las tools MCP (zod). Tests con fixtures reales (tu CSV, `cards.json`, los 40 mazos, los dos standings reales guardados en `docs/fase0/limitless/`).
- `apps/api`: **NestJS** (Express), **Prisma 7** (`@prisma/client` 7.x + `@prisma/adapter-pg`, `prisma.config.ts`; no la 8 RC), `@nestjs/schedule`, `@nestjs/throttler`, `@rekog/mcp-nest` 2.0.x sobre `@modelcontextprotocol/server` 2.3.x (nunca el SDK 1.x; `@nestjs/microservices` como peer aunque no se use). Sirve `apps/web/dist` detrás del middleware de sesión.
- `apps/web`: React 19 + Vite 8 + `vite-plugin-pwa` 2 + Tailwind 4 + shadcn/ui **regenerado** (no copiado del tracker, que es GPL) + TanStack Query + react-router. Barra inferior de 5 destinos; «cargar partida» como hoja de ≤4 toques.
- `apps/worker`: Node 24 + TS sin framework; tarea programada de Windows al iniciar sesión; ejecuta `engine-cli.exe` fijado por commit; estado local en `%LOCALAPPDATA%\tcg-worker`.
- `engine/engine-cli`: crate Rust propio con `deckgym = { git = "…/deckgym-core", rev = "fb792ebf…" }`, JSON de entrada → JSON de salida. Compilado en GitHub Actions (`windows-latest`), publicado como Release con sha256 (ver A5).
- `apps/mcp-local` (opcional): stdio para Claude Code. Por defecto no, porque Claude Code puede usar el endpoint remoto con `--header` (pregunta B14).
- Infra: Fly.io (región `gru` o `iad`, IPv4 compartida), Supabase Free en la misma región (pooler en modo sesión, puerto 5432, para Prisma), GitHub privado con Actions (tests, imagen, build del motor). Replays y backups en Supabase Storage (1 GB, archivos ≤ 50 MB, API S3); Cloudflare R2 (10 GB gratis) solo si se supera.
- Secretos solo en variables de entorno: en Fly vía `fly secrets` (`DATABASE_URL`, `SESSION_SECRET`, clave para cifrar el secreto TOTP); en la PC, variables de usuario de Windows (`TCG_WORKER_TOKEN`, y `GITHUB_TOKEN` de solo lectura para descargar el binario de la Release del repo privado). Nunca en el repo.

**Autenticación (decisión cara, pregunta A3).** Un usuario: **contraseña (argon2id) + TOTP** y cookie de sesión `__Host-session` (`HttpOnly; Secure; SameSite=Lax`, id de 256 bits guardado hasheado, 30 días deslizantes: en el celu te logueás una vez por mes), implementado a mano en Nest (~300 líneas que entendés enteras) con `@nestjs/throttler` en `/login` (5 intentos / 15 min). Passkeys después, como mejora opcional (quedan atadas al dominio). Tokens de worker y MCP: 32 bytes aleatorios con prefijo `tcg_wk_` / `tcg_mcp_`, hash SHA-256 en DB, scopes (`worker:claim`, `mcp:read`, `mcp:write`), revocables, `last_used_at`. **Para el conector remoto de las apps de Claude**: si tu cuenta permite header fijo, no hace falta nada más. Si no, en Fase 7 hace falta un servidor de autorización OAuth 2.1 (CIMD o DCR + PKCE + consentimiento + refresh rotado), y nuestro Nest queda como *resource server* con un verificador de bearer genérico: acepta `tcg_mcp_*` o un JWT validado contra el JWKS del emisor, con emisor y audiencia por variable de entorno, para poder cambiar de proveedor sin tocar las tools. Tres vías con esfuerzo distinto (detalle en el Apéndice E): un **servidor OAuth externo gratis** —**Descope** (CIMD + DCR, 2.000 consentimientos/mes, «Bring Your Own Auth» para que el consentimiento use nuestro login) o **WorkOS AuthKit** (1 M usuarios gratis, lo más simple, pero con un login propio de WorkOS solo para el consentimiento)—: 1–2 días; `better-auth` **solo como servidor OAuth** (plugins `oauth-provider` + `cimd`, tablas propias): 2–4 días; a mano: 1–2 semanas. Por eso conviene que mires hoy si aparece «Request headers» (A6): define cuánto cuesta M8.

---

## 3. Arquitectura

```
[Celular / PC: navegador]  --HTTPS, cookie-->  +-----------------------------------------------+
[Claude Code / apps Claude] --HTTPS, bearer-->  |  apps/api  (NestJS, 1 proceso, Fly.io)        |
                                                |  - sirve apps/web/dist (PWA) detrás de sesión |
                                                |  - REST /api/*                                |
                                                |  - /api/mcp (Streamable HTTP, ambas eras)     |
                                                |  - /api/worker/* (cola, long-poll, leases)    |
                                                |  - scheduler: Limitless, backup, set nuevo    |
                                                +----------------------+------------------------+
                                                                       | Prisma
                                                                 [Neon Postgres]
[PC Windows: apps/worker (Node)] --HTTPS saliente, token worker-->  /api/worker/*
        | spawn
   [engine-cli.exe]  (ejecutable propio que enlaza deckgym @ fb792ebf; compilado por GitHub Actions)

[raw.githubusercontent.com @ 3ab58f1]  <-- sync del catálogo (manual, re-ejecutable, commit fijado)
[play.limitlesstcg.com/api]            <-- un único cliente, 40 req / 5 min (solo la API lo llama)
```

**Fronteras.** Todo el conocimiento del juego vive en `packages/domain` (funciones puras, sin I/O). La API orquesta I/O y persistencia; el worker solo convierte trabajos en invocaciones del motor y sube resultados; la web muestra y edita; el MCP expone lo que el dominio ya calcula. Las tres fuentes de resultados (torneo, mis partidas, simulación) son tipos distintos en el dominio y ninguna función acepta dos de ellos para producir un número.

**Vocabulario.** *Edición* = una carta concreta (`card_id`, p. ej. `B4b-372`). *Carta funcional* = mismo nombre y mismo texto de reglas; en el modelo es la entidad `FunctionalGroup` («grupo»). *Unidad de stock* = ediciones que comparten `internal_id` en el tracker y por lo tanto comparten cantidad (A1-1 y A4b-1). *Copias jugables* = copias de una carta funcional disponibles para armar mazos.

### 3.1 Catálogo (M1)

`pnpm catalog:sync --commit <sha>` baja por `raw.githubusercontent.com`, al commit fijado, `frontend/assets/cards.json`, los tres `*_translations.json`, `frontend/src/lib/CardsDB.ts`, `frontend/src/types/index.ts`, `frontend/public/locales/es-ES/common/{sets,packs}.json` (nombres oficiales en español de sets y sobres) y, más adelante, `assets/themed-collections/*.json`; además `database.json` de deckgym para `evolves_from` (el tracker no lo tiene y hace falta para validar líneas evolutivas), `trainer_card_type = Fossil` y el id del motor. Parsea el literal `expansions` y `craftingCost` de `CardsDB.ts` con la API del compilador `typescript` + `new Function` (es un literal JS válido), con una regex de fallback y validación zod. Precalcula `nameEs`, el grupo funcional, la unidad de stock, `prizePoints` (3 si es «Mega … ex», 2 si es ex, 1 el resto), `searchText` (limpiando el artista pegado en los efectos de Entrenador, el `damage` ruidoso y el costo `'No Cost'`), e `imageUrl` como enlace al raw del tracker (nunca se copian imágenes). Guarda hashes y archivos crudos. **Identidad = `card_id`; `internal_id` es un atributo versionado** (el tracker lo cambió dos veces en 2026 y los ids `B2a-89`/`B2a-92` ni siquiera decodifican a una carta). El orden canónico de sets es el de aparición en `cards.json` (A1 … B4b, promos al final), no el de `expansionIds` (que va de más nuevo a más viejo). Al cambiar el pin, el sync muestra el diff (cartas nuevas, `internal_id` que cambian, grupos que se parten o fusionan, nombres caídos al inglés) y aplica el remapeo de colección, ajustes y listas de torneo en una transacción; si cambian grupos o unidades de stock queda en `needs_review`. Un cron diario compara el sha de `types/index.ts` en `main` con el fijado y avisa «hay set nuevo en el tracker» (anticipo de «más adelante», medio día); **el pin se sube a mano** (los re-scrapes renumeran ids).

### 3.2 Colección (M2)

Importar: parsear (BOM, LF o CRLF, `TRUE/FALSE`), validar cada `Id` contra el catálogo (el tracker no lo hace), deduplicar por `InternalId` con error si dos gemelas traen valores distintos, calcular el diff contra el stock actual y **mostrarlo antes de aplicar**; al aplicar se guarda la instantánea con fecha, hash y filas. La edición manual actúa sobre la **unidad de stock** (tocar A4b-1 modifica A1-1, y la UI muestra las gemelas afectadas); `collected` pasa a `true` cuando la cantidad sube de 0 y no se toca al bajar.

**Ajustes manuales** (brief §2: «el CSV dice 3 Latias y 1 Latios, y yo tengo 2 y 2»): un ajuste es un **valor absoluto de copias jugables por carta funcional** que pisa la suma del stock; se muestra marcado en todas las vistas. Reglas completas: (a) al importar, cada ajuste activo cuya suma importada ya coincide dispara «el ajuste de X ya coincide con el CSV, ¿lo retirás?»; (b) el diff de importación lista aparte los grupos con ajuste activo cuya suma cambió sin coincidir (antes A, ahora B, ajuste N); (c) editar a mano una edición de un grupo con ajuste activo pregunta si retirás el ajuste; (d) **los ajustes no se exportan** al CSV (son por carta funcional, no por edición); la app ofrece «convertir el ajuste en edición manual» eligiendo a qué edición se le suma o resta, para que el tracker también quede corregido. En tu CSV de hoy Latias y Latios ya vienen 2/2: no hay ajustes pendientes y la función se prueba con uno creado a propósito.

Exportar: 8 columnas en el orden del tracker, una fila por carta en el orden de `cards.json`, gemelas con valores idénticos, BOM + LF, `TRUE/FALSE`, `CardName` en español: byte-idéntico al del tracker salvo el nombre.

### 3.3 Mazos (M3)

Cada carta del mazo guarda la **edición** (`card_id`) y su grupo. Validación pura y en vivo (cliente y servidor comparten el paquete):

| Regla | Nivel | Detalle |
|---|---|---|
| 20 cartas | error | «Tiene 19 cartas, falta 1» |
| ≤2 por nombre | error | sobre `nameEn`, sumando todas las ediciones y todos los grupos del nombre («Umbreon» ≠ «Umbreon ex»; «Riolu tiene 3 copias: A2-91 ×1, B3-79 ×2») |
| ≥1 Pokémon Básico | error | los fósiles no cuentan (ni en el juego ni en el motor) |
| Líneas evolutivas | error | Fase 1 exige su pre-evolución por `nameEn`; Fase 2 exige la Fase 1, o Básico + Caramelo Raro. Excepciones impresas en cartas, en una tabla `EvolutionAlias`: Eevee ex (A3b-56, A3b-92…) cuenta como Eevee por su habilidad «Veevee 'volve» (el motor implementa exactamente ese caso); ningún otro ex-base tiene excepción |
| Energías | error | ⊆ los 8 tipos seleccionables; Dragón e Incoloro prohibidos; al menos una |
| Energías vs costos | info | por carta: «X no puede usar ningún ataque con las energías elegidas»; error solo si ningún Pokémon del mazo puede atacar |
| Misma carta en dos ediciones | info | «Mega-Blaziken ex: 2 copias (B1-36 + B1-284)», se suman por grupo |

Completitud = copias requeridas vs jugables por grupo, **cada mazo contra la colección entera** (las copias no se reparten). Historial: cada guardado que cambia cartas o energías crea una `DeckRevision`; los cambios de nombre, etiquetas, notas, «armado en el juego» y variante-de se registran en `DeckChange {field, old, new, at}`. Etiquetas, notas, «armado en el juego» (≤25 no archivados), variante-de, duplicar, archivar, restaurar una revisión. La UI muestra los puntos en juego de cada Pokémon (`prizePoints`).

Formatos: **texto español con códigos** (gramática de `mazos_40_listas.md`: `- Pokémon:` / `- Entrenadores:` con `N Nombre (CÓDIGO)`; la energía viene de una línea `- Energía: Fuego + Rayo` opcional o, si falta, de la columna «Energía» de una tabla resumen con el mismo número de mazo; si tampoco está, la app propone los tipos seleccionables que cubren los ataques y **pide confirmación**, nunca infiere en silencio; «Cualquiera» exige elegir); **Limitless/deckgym** (`<count> <name> <SET> <NUMBER>` + `Energy:`, mismo formato para los dos; cabeceras `Pokémon:`/`Trainer:` toleradas al importar); **JSON propio**. La exportación a deckgym emite **siempre** `Energy:` explícito y, por grupo, una edición implementada en el motor (Globito B4b-372 → `B3b 64`). El exportador español escribe siempre la línea `- Energía:`. Opcional y no pedido: el enlace `?i=` al builder de my.limitlesstcg.com (formato decodificado por inspección). El código QR del juego queda para más adelante.

### 3.4 Sobres (M4)

Conjunto buscado ponderado: déficit por mazo objetivo `max_mazos(prioridad · max(0, requeridas − jugables))` por grupo (máximo, no suma, porque las copias no se reparten) asignado a todas sus ediciones, más ediciones no poseídas que pasan el filtro de rarezas; control deslizante α entre ambos. Por sobre (todas las expansiones con `packStructure`, incluidos A4b y B4b, con interruptor **disponible** que sobrevive al sync): P(≥1 buscada), E[cartas buscadas], valor esperado ponderado, sobres para 50 %/90 % (`⌈ln(1−q)/ln(1−p)⌉`), E[sobres para completar un mazo] por inclusión–exclusión (≤12 cartas) o Monte Carlo con intervalo. Modelo = port literal de `stats.ts`. **Conmutador «modelo del tracker» en la UI**: reproduce el tracker exactamente (incluidos sus dos bugs, Apéndice A.3) para cumplir el criterio «coincide con el tracker»; por defecto, el modelo corregido, y la tabla muestra la diferencia por sobre y su motivo (bebés / reimpresiones). Por carta faltante: costo en puntos (tabla del tracker; ✵ 1000 y ✵✵ 1350 marcados «sin verificar»; promos no comprables; los puntos son de la expansión donde se compre), intercambiable (`expansion.tradeable && rareza ∈ lista configurable`) y la regla «comprá, no abras» si el costo es menor que el valor esperado de abrir. Supuestos declarados en la UI (tasas constantes, sin pity, independencia).

### 3.5 Torneos (M5)

Un único cliente de Limitless en la API: token bucket de 40 por 300 s, lectura del header `RateLimit`, 429 → `max(Retry-After, reset, 60 s)`, backoff en 5xx, reanudable. Incremental cada 6 h: listar `/tournaments?game=POCKET&limit=100` hasta una página ya conocida cuyo torneo más viejo tenga `date < hoy − 2 d`; candidatos con `date + 1 d < hoy`, `format` `null` o `NOEX` (`CUSTOM` excluido) y jugadores ≥ 12 (configurable; reproduce los 154 torneos que Limitless muestra para B4a); por torneo `details` (0,5 KB; permite excluir bans y reglas especiales) + `standings`; se guarda el JSON crudo comprimido y las filas normalizadas. **Formato vigente**: Limitless no lo publica por torneo, así que la era se infiere como el último set que abre era (A4b/B4b no) con fecha de lanzamiento ≤ fecha del torneo (tabla editable de sets, Apéndice A.5; el día de lanzamiento cuenta para el set nuevo) y se **contrasta** con el set más nuevo que aparece en las listas de los últimos 20 torneos: si difieren, `eraConflict` y aviso. Formato efectivo = `format ?? STANDARD`, NOEX como filtro aparte. Backfill inicial de 60 días (~300 torneos, ~600 llamadas, 1–1,5 h) corre en segundo plano por trozos. Agregados en SQL por arquetipo (`deck.id` de Limitless guardado crudo + tabla de alias propia porque los slugs cambian) y por lista exacta con **dos claves** sin energías: por nombre (`sha1` del multiconjunto `nameEn × count`, con el nombre crudo de Limitless si la carta no mapea) como pide el brief, y por grupo funcional (distingue Riolu A2-91 de B3-79; `null` hasta que todas las cartas mapeen). `WR = W / (W + L + T)`, intervalo de Wilson 95 % sobre partidas, **orientativo si hay menos de 30 listas**, y la **media de la era** (`ΣW / Σ(W+L+T)` sobre las listas elegibles) al lado: 43,8 % y 48,0 % en los dos torneos reales analizados, 46,7 % en tu base. Consultas: qué listas puedo armar hoy, qué grupo faltante destraba más listas, arquetipo con y sin una carta.

### 3.6 Partidas (M6)

Hoja en ≤4 toques: mazo (últimos usados primero) → resultado (tres botones grandes) → rival (autocompletar: arquetipos de la era vigente con ≥N listas y los que ya cargaste; texto libre) → ¿empecé? → modalidad (`competitiva | distendida | principiante | evento | amigo`, por defecto la última) → nota opcional → guardar. Se guarda la revisión del mazo. Estadísticas por mazo y por rival con Wilson sobre partidas, orientativo con menos de 30. Vista comparativa por mazo con **tres columnas separadas** (mis partidas / torneo / simulación), cada una con su n, su intervalo y su fuente; «sin datos» donde no hay; nunca un número combinado.

### 3.7 Simulación (M7): motor y worker

**Motor: tres vías** (pregunta A5). (a) **`engine-cli`**, recomendada: crate propio que declara `deckgym = { git, rev = "fb792ebf…" }`, copia su `.cargo/config.toml` (pila de 8 MiB, necesaria por `database.rs`) y expone `engine-cli job.json result.json`; deckgym queda sin modificar y el pin se sube editando una línea; el ejecutable es obra derivada AGPL. (b) **Fork con parche mínimo** (`<tu-usuario>/deckgym-core` fijado a `fb792ebf` + ~50 líneas: semilla por partida en `simulate.rs:247`, `is_valid` antes de simular, resumen JSON): cumple «binario aparte» al pie de la letra y la salvedad «salvo que haga falta» del brief, pero el parche hay que re-aplicarlo en cada actualización del motor, cuyo código interno cambia seguido. (c) **CLI intacto**: agregados solo parseando su stderr o contando replays; reproducibilidad solo lanzando un proceso por partida con `-n 1 --seed s_i` (arranque de proceso por partida); sin consistencia; validación hecha por la app. Todas se compilan en GitHub Actions (`windows-latest`); el worker descarga el `.exe` de la Release por `engine.lock.json` con un token de solo lectura, verifica el sha256 y lo guarda por commit.

**`engine-cli`** usa solo API pública de deckgym: `Deck::from_string` + `is_valid` + `get_implementation_status` (validación antes de simular); por partida, `CompositeSimulationEventHandler` con un handler propio (resultado por partida, y en Fase 8 el histograma «atacante listo en turno N» sobre `ViewState`) y `ReplayRecorder` para la muestra, `on_game_start_with_metadata`, `Game::new_with_event_handlers(game_id, players, seed, …)`, `play()`, `on_game_end`; `optimize` con bucle propio sobre `generate_valid_combinations` contando victorias, derrotas y empates (el `optimize()` del motor cuenta empates como derrota). Paralelismo: rayon sobre las partidas de un chunk con `cores` hilos; el worker ejecuta un chunk a la vez. **Semillas**: `baseSeed` la elegís al encolar (por defecto aleatoria, siempre visible); `chunk.seed = baseSeed + idx`; `gameSeed = splitmix64(chunk.seed, i)`, guardada con cada replay; la muestra de replays son las primeras `replaySample` partidas del chunk. **Reproducibilidad**: misma semilla ⇒ misma partida dentro de un mismo proceso; entre procesos **no está garantizada por el motor** (ramas de ataque multiobjetivo construidas desde un `HashMap`), así que el día 1 de la Fase 6 se mide (N partidas × 2 corridas) y, si difieren, se documenta como «mejor esfuerzo» y la semilla sirve para auditoría; opcional: proponer upstream ordenar esas ramas.

**Trabajos**: `matrix` (conjunto A × conjunto B, míos o listas de torneo), `compare` (variantes o revisiones de un mazo × grupo de rivales, una fila por variante), `optimize`, y en Fase 8 `consistency` y `play`. Cada trabajo se parte en **chunks** (un cruce, o un lote de candidatos) que apuntan a instantáneas inmutables de mazo (`DeckSnapshot`: texto deckgym, cartas no implementadas, `energySource = declared | inferred | manual`; una lista de torneo sin `energy` —pasa en NOEX— se infiere de los costos y, si la inferencia es ambigua o vacía, queda no simulable hasta que elijas).

**Protocolo del worker** (todo HTTPS saliente, token `worker:claim`):

| Paso | Detalle |
|---|---|
| Reclamar | `POST /api/worker/claim {workerId, engineRev, cores}` → `200 {chunk}` (long-poll ≤25 s) o `204` + `Retry-After` creciente (30 → 300 s) con cuerpo `{requiredEngineRev}` para que un worker desactualizado sepa que debe actualizar. Claim atómico (`UPDATE … WHERE status IN ('queued','expired') … SKIP LOCKED … RETURNING`). Cuando la API sabe que la cola está vacía responde desde memoria sin tocar la DB (caché invalidada al encolar) para que Neon suspenda. Lease de 3 min. |
| Latido | `PUT /api/worker/chunks/:id/heartbeat {gamesDone}` cada 30 s: renueva el lease y alimenta el progreso (SSE en la UI). Lease vencido (PC apagada o dormida) → `expired`, reclamable de nuevo, **no cuenta como fallo**; `failed` solo por error del motor, máximo 3. |
| Resultado | `PUT /api/worker/chunks/:id/result {engineRev, seed, winsA, winsB, ties, games, durationMs, extra}`: idempotente por chunk, se acepta mientras el chunk no esté `done` (el resultado depende solo de la semilla); después, los duplicados se ignoran con `200`. |
| Repeticiones | `PUT /api/worker/chunks/:id/replays/:gameId` binario comprimido, con límite de cuerpo explícito; 2 por cruce por defecto. |
| Reanudación | estado en `%LOCALAPPDATA%\tcg-worker\state.json`; al reiniciar, si el lease sigue vivo continúa, si no vuelve a reclamar. Si la PC está apagada, los chunks esperan. |

Matriz 40×40 = 780 cruces no ordenados (el motor sortea quién empieza; espejo opcional, 1.560). Con tus tiempos (200 partidas `e2,e2` en 7 s con 2 hilos ⇒ 35 ms de reloj por partida) 780 × 200 = 156.000 partidas ≈ **1,5 h con 2 hilos**, del orden de 20–30 min con 8 de tus 20 hilos si escala. La UI muestra siempre motor, bot, n, semilla y los empates separados (con bots al azar probablemente son el límite de 30 turnos, no una regla del juego).

**Jugar contra un bot (Fase 8).** Evaluadas tres vías: (i) implementar el trait público `Player` en `engine-cli` para el asiento humano, publicando cada decisión (`ViewState::for_player` + acciones legales) a la API y esperando tu elección por long-poll, sin timeout artificial, rival `e2`, partida corriendo en el worker (PC encendida); una entidad `LiveGame {snapshot, bot, seed, status, state, pendingDecision, legalActions, lastActivityAt}` y un slot del worker reservado; (ii) WebAssembly: **descartado** porque el motor no tiene ningún `cfg(target_arch = "wasm32")` y usa rayon, indicatif, `std::fs`, `std::process` e `Instant` sin feature-gates, o sea habría que modificarlo; (iii) el protocolo de bot externo por stdin/stdout invertido: funciona pero ante timeout el motor juega solo por vos. Recomiendo (i). **Consistencia (Fase 8)**: cada mazo puede declarar sus cartas clave (`Deck.keyCards`: atacante principal y setup); el job `consistency` mide, con el handler propio, el primer turno en que el atacante está en juego con energía suficiente para un ataque, y devuelve P(listo en turno ≤ N) con n e intervalo.

**Repeticiones.** El `viewer/` de deckgym (React 19 + Pixi 8 + GSAP) es autocontenido: el replay lleva las definiciones de cartas y dibuja las cartas proceduralmente, sin imágenes. Se puede construir en CI con `vite build --base=/viewer/` sin tocar su código y servir estático detrás del login con `?url=/api/replays/<id>`. Coherente con «texto primero», propongo por defecto un **visor propio paso a paso en texto** sobre `steps[].state` (1–2 días, sin código AGPL en la web) y el viewer de deckgym como opción (pregunta B11).

### 3.8 Claude (M8)

Un solo endpoint `/api/mcp` (`@rekog/mcp-nest`: sirve 2026-07-28 y la era 2025 sin sesiones). Claude Code: `claude mcp add --transport http tcg https://<dominio>/api/mcp --header "Authorization: Bearer tcg_mcp_…"`. Apps de Claude (web, escritorio, celular): header fijo si tu cuenta muestra «Request headers» al agregar un conector (lo podés mirar en 5 minutos, pregunta A6); si no, OAuth 2.1 en Fase 7 (ver autenticación en §2: PRM en `/.well-known/oauth-protected-resource`, CIMD + PKCE S256, consentimiento con tu sesión, refresh rotado, callback `https://claude.ai/api/mcp/auth_callback`, respuestas en <10 s). El verificador de bearer acepta tokens `tcg_mcp_*` y, llegado el caso, access tokens OAuth, así agregar OAuth no cambia las tools. El brief pide además una forma de uso **local**: la cubre un `apps/mcp-local` por stdio (1 día) que solo aporta usarlo sin desplegar u offline; por defecto no se hace y Claude Code usa el remoto (pregunta B14). Las tools se definen una vez en `packages/domain/mcp` (schemas zod, descripciones en español) y llaman a los mismos servicios que la REST; la lista completa está en el Apéndice D. Aceptación del brief («¿cuántas copias jugables tengo de Hoopa ex y qué mazos lo usan?») = `collection.playable_copies` + `decks.find_by_card`.

### 3.9 Autenticación, exposición y copia de seguridad

Rutas públicas: `/login`, `/api/auth/*`, `/.well-known/*`, `/api/mcp` (bearer), `/api/worker/*` (bearer), `/healthz`. **Todo lo demás, incluidos `index.html`, el manifest, el service worker y los chunks, exige la cookie de sesión** (el requisito literal aplica al servidor; la caché local del service worker se vacía al cerrar sesión y ante un 401 persistente: `caches.delete` + `unregister`, y `/login` queda fuera del `navigateFallback`).

Backup: `GET /api/backup/export` → `tcgpocket-backup-AAAAMMDD.json.gz` con **todo lo que es tuyo**: colección (stock, instantáneas con filas, ajustes y su historial), mazos (revisiones, cambios, objetivos, cartas clave), partidas, instantáneas de mazo y **trabajos de simulación con sus resultados por chunk**, configuración (`AppSetting`, `RarityRule`, interruptores y saldos de sobres, overrides de sets y de nombres), arquetipos y alias (chicos, y las partidas los referencian), torneos normalizados (siempre que pesen < 50 MB comprimidos), metadatos de tokens. Opcionales porque pesan o se re-sincronizan: replays y el JSON crudo de Limitless. Excluidos a propósito: `passwordHash`, secreto TOTP y hashes de tokens (se recrean). `POST /api/backup/import` con `dry-run` (devuelve el diff) y `replace` (transacción única; si el `catalogCommit` del archivo difiere del de la DB, corre primero el remapeo de I12 y queda en `needs_review` si cambian grupos o unidades de stock). Un cron diario sube el export a Supabase Storage (retención 30 días; es la única red de seguridad porque el plan gratis no tiene restauración puntual) y se puede descargar desde la app.

---

## 4. Modelo de datos

### 4.1 Invariantes (cada uno con test)

| # | Invariante |
|---|---|
| I1 | Identidad de edición = `card_id`. `internal_id` es atributo versionado por sync; nunca se decodifica. |
| I2 | **Carta funcional = mismo nombre + mismo texto** = grupo `alternate_versions` del tracker. `FunctionalGroup.id` = `card_id` más temprano del grupo en el orden de `cards.json` (A1 … B4b, promos al final; único en los 2.319 grupos); `displayCardId` = `alternate_versions[0]` (respeta los 3 overrides del tracker: Mew A1a-31, Poké Ball P-A-5, Investigación de Profesores P-A-7). Un grupo cambia de id solo por un split o merge en un sync (I12). |
| I3 | **Unidad de stock = ediciones que comparten `internal_id`** (gemelas de A1a/A4b/B4b: 450 unidades de 2–3 filas). `Card.stockCardId` = `card_id` más temprano de la unidad; solo esas 3.866 cartas tienen fila de stock. A4b-1 y A1-1 son la misma fila. |
| I4 | Copias jugables(grupo) = ajuste activo del grupo, o Σ `amountOwned` de sus unidades de stock. El ajuste es un **valor absoluto**, no un delta; afecta solo a copias jugables; no se exporta; a lo sumo uno activo por grupo. |
| I5 | Límite de 2 por nombre sobre `nameEn` exacto, sumando ediciones y grupos (es↔en es 1:1, 0 colisiones). |
| I6 | Cada mazo se valida y completa solo contra la colección; las copias no se reparten. |
| I7 | Toda lista guarda la edición; dos ediciones del mismo grupo se admiten y se suman por grupo. |
| I8 | `builtInGame` ≤ 25 mazos no archivados. |
| I9 | Un porcentaje es `{value, games, samples, sampleKind, ci95: [lo, hi], orientative}`: `games = W + L + T` alimenta Wilson; `samples` = listas en `TournamentStat` (orientativo si < 30 listas) y partidas en `MatchStat` y `SimulationStat` (orientativo si < 30 partidas). Los tres tipos nunca se agregan entre sí. |
| I10 | Un resultado de simulación lleva `engineRev`, `bots`, `games` y `seed` (`seedMode = reproducible | none` si se usara el CLI intacto); sin eso no se persiste. |
| I11 | El servidor no almacena imágenes: `imageUrl` es un enlace. |
| I12 | Al cambiar el commit del catálogo, el remapeo de `internal_id`, unidades de stock y grupos sobre colección, ajustes y listas de torneo ocurre en una transacción, o el sync queda en `needs_review`. |

### 4.2 Entidades

**Catálogo (versionado por commit).** `CatalogSync {commitSha, engineRev, fetchedAt, appliedAt?, status, fileHashes, counts, summary}` + `CatalogSyncChange {cardId, field, old, new}`. `Expansion {id 'A1'…'P-B', trackerInternalId, nameEn, nameEs, releaseDate? (override tuyo), opensEra (override tuyo), isPromo, sortOrder, tradeable, openableTracker, cardsPerPack?, containsShinies, containsBabies, containsLinkedCards}`. `Pack {id 'A1/mewtwopack', expansionId, name, nameEs, color, available (interruptor tuyo), pointsBalance? (opcional, manual)}` + `PackCard (packId, cardId)` materializando `card.pack ∈ {pack.name, 'everypack'}` (desde A2b todos los sets mono-sobre traen `everypack`). `FunctionalGroup {id, displayCardId, nameEn, nameEs, cardType, rulesHash, editionCount}`. `Card {id, expansionId, number, internalId, stockCardId, functionalGroupId, isDisplayEdition, nameEn, nameEs, nameEsSource (tracker | fallback_en | override), hp?, energy, cardType, evolutionType, evolvesFrom?, isFossil, ex, prizePoints 1|2|3, baby, rarity, pack, artist, attacks (costo `'No Cost'` → `[]`), ability?, weakness, retreat?, imageUrl, engineId 'A1 001', searchText, alternateVersionsRaw}`. `EvolutionAlias {cardId, countsAs}` (Eevee ex → Eevee). `RarityRule {rarity, points?, pointsVerified, tradeable}`. `EngineBuild {rev, builtAt, sha256, implementedCount}` + `CardEngineStatus {(engineRev, cardId), status, mappedCardId?}`.

**Colección.** `CollectionImport {fileName, sha256, importedAt, appliedAt?, status, rowCount, naiveTotal, dedupTotal, unknownIds, diffSummary, rawFileGz}` + `CollectionImportRow {(importId, cardId), internalId, numberOwned, collected}`. `CollectionStock {cardId = stockCardId, amountOwned, collected, source import|manual, importId?, updatedAt}`. `CollectionAdjustment {functionalGroupId, playableCopies, reason, active, createdAt, resolvedAt?, resolution? user | csv_matches | manual_edit | converted | catalog_change}` (a lo sumo uno activo por grupo).

**Mazos.** `Deck {name, energies[], tags[], notes, builtInGame, builtInGameSince?, variantOfId?, packPriority 0..3, keyCards[] (grupo, rol attacker|setup), archivedAt?, currentRevisionId}`. `DeckRevision {deckId, number, cards [{cardId, count}] ordenadas, energies, note, source ui|import|mcp|duplicate|restore}`. `DeckChange {deckId, field, old, new, at, source}`. `DeckCard {(deckId, cardId), count, position}` (materialización de la revisión actual para «qué mazos usan X»).

**Partidas.** `Match {deckId, deckRevisionId, result win|loss|tie, opponentArchetypeId?, opponentText?, wentFirst?, mode competitive|casual|beginner|event|friend, note?, playedAt, source}`.

**Torneos.** `Tournament {id Limitless, name, date, formatRaw?, formatEffective STANDARD|NOEX|EXCLUDED|UNKNOWN, era?, eraConflict, players, organizer, isOnline?, hasDecklists?, phases?, bannedCards?, specialRules?, syncStatus, excludedReason?, attempts, rawStandingsGz?, fetchedAt?}`. `TournamentEntry {tournamentId, playerId, playerName, country?, placing?, drop?, wins, losses, ties, archetypeId?, archetypeNameRaw?, listKeyByName, listKeyByGroup?, energies[]}` + `TournamentEntryCard {(entryId, set, number), name, count, cardId?, functionalGroupId?}`. `Archetype {id slug, name, icons[], canonicalId?}`. `UnknownCardRef {(set, number), name, occurrences}`. `LimitlessSyncRun {kind, startedAt, finishedAt?, callsMade, cursor?, errors?}`.

**Simulación.** `DeckSnapshot {sourceType deck_revision|tournament_entry|text, sourceId?, label, deckgymText, cardIds, energies, energySource, notImplemented, sha256}`. `SimulationJob {kind matrix|compare|optimize|consistency|play, status, params, engineRev, bots, gamesPerPair, baseSeed, cores, replaySample, timestamps}`. `SimulationChunk {jobId, idx, snapshotAId, snapshotBId?, games, seed, status queued|leased|expired|done|failed, attempt, leaseUntil?, workerId?, winsA?, winsB?, ties?, durationMs?, engineRev?, extra?}`. `SimulationReplay {chunkId, gameId, seed, outcome, dataGz? | storageKey?, sizeBytes}`. Fase 8: `LiveGame`.

**Acceso y configuración.** `Owner` (una fila: `passwordHash, totpSecret`), `Session {idHash, expiresAt, lastSeenAt, userAgent?}`, `ApiToken {name, kind worker|mcp, scopes[], tokenHash, prefix, lastUsedAt?, expiresAt?, revokedAt?}`, `AppSetting {key, value}` (α, filtro de rarezas, rarezas intercambiables, costos ✵/✵✵, `minPlayers`, `backfillDays`, núcleos, bot por defecto, modelo de sobres por defecto), `BackupBlob {createdAt, sizeBytes, dataGz}`.

Postgres: `pg_trgm` + `unaccent` con índice GIN sobre `searchText`; `UNIQUE` parcial en ajustes activos; `CHECK amountOwned ≥ 0`. Tamaño estimado en Postgres (Supabase 500 MB; Neon 1 GB): catálogo ~10 MB; colección ~1 MB por instantánea; 60 días de torneos ≈ 21 k listas × ~15 líneas ≈ 315 k filas (~45 MB con índices), creciendo ~20 MB/mes (purgar eras viejas pasado el año); el crudo comprimido de Limitless (~3 MB) y los replays (780 cruces × 2 × ~30–60 KB ≈ 50–95 MB por matriz, purgados al archivar) van a Storage, no a Postgres. El esquema Prisma completo se escribe en Fase 1 a partir de esta lista.

---

## 5. Integración de cada pieza reutilizada y licencias

| Pieza | Origen y pin | Cómo se integra | Licencia e implicación |
|---|---|---|---|
| Datos del tracker (`cards.json`, 3 JSON de traducciones, `expansions`/`craftingCost` de `CardsDB.ts`, `expansionIds`, locales es-ES de sets y sobres, más adelante misiones) | tracker @ `3ab58f1` | Sync por commit fijado (3.1); normalizaciones al importar: `damage` con palabras (40 formas), `Illustrated by…` pegado en los 395 efectos de Entrenador, costo `'No Cost'`, `pack = everypack`, `hp` solo en 8 fósiles; `containsLinkedCards` guardado como metadato. | GPL-3.0. Datos citados con commit en `docs/LICENCIAS.md`. Uso privado: sin obligación. |
| Algoritmo de nombres (`utils.ts:55-89`) y `stats.ts` (modelo de sobres) | ídem | Port a `packages/domain` (trabajo derivado) con cabecera de atribución; conmutador «modelo del tracker»; A4b/B4b incluidos; correcciones documentadas. | GPL-3.0: si algún día se distribuye o se abre la app, `packages/domain` y lo que lo enlace (api, worker, mcp) van GPL-3.0 con fuentes. Hoy, nada. |
| Deck builder del tracker | ídem | Solo ideas (`getDeckbuildingCopies`, `getOwnedStatus`); sus reglas no alcanzan (no valida Básico, evoluciones ni 2 por nombre). **No se copia ningún componente, página, hook ni CSS** (son GPL aunque hayan nacido de shadcn); shadcn se regenera con su CLI (MIT). | — |
| deckgym-core (motor) | `bcollazo/deckgym-core` @ `fb792ebf` | Sin modificar. Vía (a): `engine/engine-cli` lo declara como dependencia git al `rev` y copia su `.cargo/config.toml`; compilado en GitHub Actions; la PC no necesita Rust. `database.json` aporta `evolves_from`, `trainer_card_type = Fossil` y el id del motor; rareza normalizada a la notación del tracker; conflictos (HP de P-A 22) registrados, manda el tracker. Estado de implementación recalculado al subir el `rev`. | AGPL-3.0. Vía (a): el binario `engine-cli` enlaza código AGPL ⇒ obra derivada; sin distribución no hay obligación; si se publica el `.exe` (Release pública), ofrecer fuente del crate y del motor. Vía (b): fork con parche ⇒ el parche se publica si se distribuye. Vía (c): proceso aparte sin enlazar ⇒ el worker no es derivado. El `viewer/`, si se embebe, es código AGPL servido en red: a terceros habría que ofrecer su fuente (enlace al commit). |
| Limitless (API pública) | `play.limitlesstcg.com/api`, sin key (no se otorgan a proyectos privados) | Cliente único con limitador (3.5). Formato de texto del portapapeles = formato de deckgym: un solo formato de intercambio. Pie «Datos de torneo: Limitless (play.limitlesstcg.com)». Respuestas crudas del 6/10 como fixtures en `docs/fase0/limitless/`. | Términos no revisados en detalle; uso personal, volumen bajo, atribución visible. |
| Prior art | `mogja9/ptcgp-tracker` (MIT): cliente con reintentos y criterio de elegibilidad, reimplementado con atribución. `PocketDecks/*` (AGPL): solo lectura de su doc de scoring. `KevinGutowski/tcgp-deck-qr` (MIT): formato QR del juego, más adelante. | | MIT: copiar con aviso. AGPL: no copiar código. |
| Imágenes de cartas | — | Nunca en el repo; enlaces al raw del tracker (en-US, o es-ES según `image-locales.json`). | © The Pokémon Company. |

`docs/LICENCIAS.md` queda creado con esta tabla y se mantiene fase a fase. Regla práctica: **si algún día abrís la app a otras personas, se publica toda la app bajo GPL-3.0 y el motor/viewer bajo AGPL-3.0**; nada de esto afecta el uso privado.

---

## 6. Riesgos

### Los tres más grandes

1. **Deriva del catálogo.** `internal_id` cambió dos veces en 2026 (PR #999 recodificó B4; migración `2026-08-b4a-rarity-remap.sql`) y cada set nuevo reescribe `alternate_versions` de los sets viejos (PR #1037 fue +12.106/−348 líneas). Impacto: colección, ajustes y mazos con referencias rotas; grupos desactualizados. Mitigación: identidad por `card_id`; unidad de stock y grupo recalculados en cada sync; diff con `needs_review` y remapeo transaccional; pin manual; test que falla si un `card_id` cambia de unidad de stock sin revisión.
2. **El motor no alcanza tal cual y su reproducibilidad no está garantizada.** Sin resultados agregados legibles por máquina, `--seed` repetida, sin validación, `optimize` cuenta empates como derrota, «listo en turno N» imposible; el crate es 0.1.0 sin semver y `State`/acciones cambian seguido; y hay ramas de ataque que iteran un `HashMap`, así que misma semilla no garantiza misma partida entre procesos. Impacto: resultados espurios, más Rust del previsto, o un criterio de aceptación incumplible. Mitigación: `engine-cli` fijado al `rev`, compilado en CI, tests de humo al subir el `rev`, `engineRev` + semilla en cada resultado; medir la reproducibilidad el día 1 de la Fase 6 y declararla «mejor esfuerzo» si hace falta; alternativas (b) y (c).
3. **Conector remoto para las apps de Claude.** `static_headers` «beta, conjunto limitado de organizaciones»; las apps hablan el protocolo 2025 mientras el SDK v2 implementa 2026-07-28; sin header fijo hace falta un servidor OAuth (1–2 días con un proveedor externo gratis como Descope o WorkOS, 2–4 con `better-auth`, 1–2 semanas a mano). Impacto: M8 remoto más caro o que claude.ai no conecte. Mitigación: mirar «Request headers» **antes** de responder A3; servir ambas eras; verificador genérico de JWT/JWKS que acepta bearer estático y cualquier emisor OAuth; MCP Inspector + conector real antes de cerrar M8.

### El resto

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fly con auto-suspensión (`min = 0`) congela el scheduler interno (crons, backfill, backup) cuando no hay tráfico entrante | jobs que no corren con la PC apagada | `min_machines_running = 1` (recomendado, 3,69 US$) o tick externo desde GitHub Actions cada 15 min |
| Bugs de `stats.ts` si se porta literal (denominador sin bebés en sets con `containsBabies: false`: hasta +25 % de masa por rareza; prefiltro por expansión en modo mazos: 18–22 sobres cambian hasta ~2 pp) | recomendaciones sesgadas | corregido por defecto; conmutador «modelo del tracker» para comparar; anotado en DECISIONES |
| Ruido de scraping en `cards.json` | búsquedas y matching por sobre | normalizar al importar; tests sobre los 18 grupos de Entrenadores y las 40 formas de `damage` |
| Nombres es-ES `null` en un set nuevo (se cargan a mano en el tracker) | fallback al inglés | contar fallbacks en cada sync; `nameEsSource`; override local |
| Sin texto de reglas en español en ninguna fuente | búsqueda por texto en inglés | aceptar; reevaluar TCGdex cuando cubra la serie B |
| Excepciones de evolución impresas en cartas (hoy solo Eevee ex) | falsos errores si aparece otra | tabla `EvolutionAlias` sembrada desde el motor; test con el mazo 15 |
| Rate limit de Limitless compartido por IP, contadores inconsistentes | 429 durante backfill o chats | bucket 40/300 s, un solo cliente, respetar `Retry-After`, no usar la API desde chats mientras corre |
| Arquetipos de Limitless inestables (slugs cambian; sin key no hay reglas) | series rotas | guardar lo crudo + alias propios; la lista exacta no depende de esto |
| Set nuevo aparece en Limitless antes que en `cards.json` | referencias sin mapear | `UnknownCardRef` + re-mapeo al sincronizar; `listKeyByGroup` nulo hasta entonces |
| Supabase Free: 500 MB, sin restauración puntual, pausa tras 7 días sin actividad | datos perdidos entre exports; conector caído tras vacaciones largas hasta restaurar | replays y crudos fuera de Postgres; export diario a Storage; la actividad del scheduler evita la pausa; alternativa Neon Free (1 GB, PITR 6 h, pero 100 CU-h/mes que el polling consume: `Retry-After` creciente y caché «cola vacía») |
| Prisma 7→8 y SDK MCP v2 recientes | fricción | fijar versiones exactas; encapsular MCP en un módulo |
| Tamaño de replays no medido (~300 KB crudo por partida, estimado) | DB llena | 2 por cruce, comprimidos, purga al archivar, R2 si supera ~200 MB |
| Resultados dependen del bot (61,5 % con `e2` vs 51 % con `e3` en tu prueba); empates probablemente por el límite de 30 turnos | lecturas engañosas | mostrar siempre bot, n, intervalo y empates; `optimize` con conteo propio |
| Reimpresiones futuras de Entrenadores vuelven a aparecer «no implementadas» | mazos no simulables de más | mapeo automático por grupo a una edición implementada |
| Build del motor en Actions (un runner Windows consume más minutos; multiplicador sin reverificar) | minutos consumidos | compilar solo al cambiar el `rev`; caché de `~/.cargo` y `target` |
| Costos ✵/✵✵ y rarezas intercambiables sin verificar en el juego | dato incorrecto | marcados «sin verificar», configurables |
| Deluxe con ventana temporal | recomendar un sobre que ya no existe | interruptor «disponible» visible; aviso 35 días después de la última release conocida |

---

## 7. Plan de fases

Cambio de orden respecto del brief, justificado: adelanto el **registro de partidas** (M6) a la Fase 2 porque tu plan es jugar ~10 partidas con cada uno de los 40 mazos y la tabla está vacía desde el 6/10: cada día sin registro se pierde; M6 solo depende de M3 y cuesta 2–3 días. Adelanto también un **M8 de solo lectura** (el brief lo permite) a la Fase 3, porque con el dominio listo cuesta ~2 días y te devuelve el flujo de chat que hoy hacés a mano. Sobres, torneos y simulación quedan después sin cambios internos. Estimaciones en días de trabajo de Claude Code con tus revisiones; son orientativas (total ≈ 8–9 semanas hasta la Fase 7). Cada fase termina con una demo, instrucciones de prueba y `DECISIONES.md`, `LICENCIAS.md` y `CLAUDE.md` al día, y espera tu visto bueno.

Fixtures de toda la aceptación: `docs/context/tcgcollectiontracterexport-2026-10-06.csv` (6/10/2026, sha256 `f774c6e4…17e8`; guardada con fecha en el nombre), `cards.json` @ `3ab58f1`, `mazos_40_listas.md`, `docs/fase0/limitless/*.json` y `docs/fase0/fixtures-sobres-2026-10-06.json`.

### Fase 0 · Exploración y plan (esta entrega)
`docs/PLAN.md`, `docs/DECISIONES.md`, `docs/LICENCIAS.md`, `CLAUDE.md`, `docs/fase0/` (informes y datos crudos). Frena hasta tus respuestas del bloque A.

### Fase 1 · Núcleo (M1 + M2 + M3 + backup + login + deploy) · ~2 semanas
**Entregables.** Repo privado en GitHub; monorepo; `packages/domain` con tests; Prisma + migraciones; `catalog:sync` al commit `3ab58f1` (+ `evolves_from` de deckgym); importador/exportador CSV con diff e instantáneas; edición manual por unidad de stock; ajustes por carta funcional con sus cuatro reglas; vistas por carta funcional y por edición; búsqueda; mazos con validación en vivo, completitud, revisiones y registro de cambios, etiquetas, armado-en-juego, variantes; importadores y exportadores (texto español, Limitless/deckgym, JSON); backup; login con contraseña + TOTP; PWA instalable; Dockerfile desplegado en Fly + Neon; GitHub Actions con tests.
**Aceptación:**
- M1: 4.317 cartas, 24 expansiones, 2.319 grupos, 3.866 unidades de stock; `A1-1`, `A4b-1` y `P-A-23` reportan el mismo grupo y `A4b-1` la misma unidad de stock que `A1-1`; buscar «Copiona» y «Copycat» devuelve el mismo grupo (B1-225, B1-270, B4b-225, B4b-391, B4b-424); buscar «e-Nigma» encuentra a Iono; 0 nombres es-ES caídos al inglés; 156 cartas «Mega … ex» con `prizePoints = 3`; re-ejecutar el sync sin cambiar el commit da diff vacío y los ids de grupo no cambian.
- M2: la importación muestra 4.317 filas, suma ingenua 5.844 vs deduplicada 4.714, 1.255 grupos con ≥2, 1.853 con ≥1, 466 con 0; `B1a-28` queda con 0 y `Collected`. Copias jugables: **Mega-Mawile ex = 2, Globito = 3, Bulbasaur A1-1 = 3** (no se duplica por A4b-1), Latias 2, Latios 2, Espeon ex 2, Mega-Sharpedo ex 1, Hoopa ex 1, Riolu A2-91 = 1, Riolu B3-79 = 9. Un ajuste «Latias = 2» creado antes de importar este CSV dispara el aviso «ya coincide»; un ajuste «Latias = 1» con el mismo CSV aparece en el diff como «suma 2, ajuste 1»; editar a mano A4a-36 con el ajuste activo pregunta si lo retirás. Importar → exportar → reimportar: diff vacío; el CSV exportado es byte-idéntico al original salvo `CardName` y se prueba una vez a mano en el tracker.
- M3: importa los 40 mazos de `mazos_40_listas.md` tomando la energía de la tabla resumen (mazo 9 → `Energy: Fire, Lightning`; mazo 10 «Cualquiera» pide elegir); los 40 validan 20 cartas, ≤2 por nombre y ≥1 Básico **sin errores** (el 15 pasa por la excepción de Eevee ex); los 40 quedan **completos** contra el CSV de hoy (0 faltantes); los 40 se exportan a formato deckgym sin cartas sin mapear y con `Energy:` explícito; el mazo 39 (1 Pokémon + 19 Entrenadores) valida; un mazo con Vaporeon y solo Pikachu ex, o con Fase 2 sin Fase 1 ni Caramelo Raro, falla con mensaje concreto; «1 Riolu» sin código al importar da error con los candidatos; marcar un 26.º mazo como armado falla.
- Backup: export → import en DB vacía → export idéntico salvo `exportedAt`, cubriendo todas las tablas no marcadas opcionales.
- Auth: sin cookie, `GET /` y `GET /assets/*.js` redirigen a `/login`; el 6.º intento fallido en 15 min da 429; al cerrar sesión la PWA instalada vuelve a `/login`.
**Cómo lo probás.** Desde el celu instalás la PWA, te logueás, importás el CSV, mirás el diff y las copias de Hoopa ex; creás el ajuste de Latias y reimportás; abrís el mazo 6, le sacás un Riolu y ves el error; exportás el CSV y lo importás en el tracker.

### Fase 2 · Registro de partidas (M6 sin datos de torneo) · ~3 días
Hoja de carga en ≤4 toques (rival en texto con sugerencias de tus propias cargas), lista y edición, estadísticas por mazo y por rival con Wilson y marca «orientativo», vista comparativa con tres columnas (torneo y simulación dicen «sin datos»).
**Aceptación.** Cargar una partida lleva ≤4 toques desde la pantalla de inicio (cronometrado); 7 victorias en 10 se muestran como «70 % (n = 10, IC 39,7–89,2 %, orientativo)» (intervalos a 1 decimal); las partidas viajan en el backup.
**Cómo lo probás.** Cargás tus partidas reales durante una semana.

### Fase 3 · Claude de solo lectura (M8 parte 1) · ~2–3 días
`/api/mcp` con las tools de lectura; token `tcg_mcp_*` con scope `mcp:read`; registro en Claude Code con `--header`; prueba del conector en claude.ai si tu cuenta muestra «Request headers»; MCP Inspector (`tools/list`) en CI. Las tools de sobres y torneos responden «módulo no disponible todavía».
**Aceptación (brief M8).** Desde Claude Code, «¿cuántas copias jugables tengo de Hoopa ex y qué mazos lo usan?» responde «1 (B4-103); mazos 13 y 19» usando `collection.playable_copies` y `decks.find_by_card`, sin leer archivos. «Validá esta lista: …» pegando un mazo en formato Limitless devuelve la validación.
**Cómo lo probás.** `claude mcp add --transport http tcg <url> --header "Authorization: Bearer …"` y hacés las dos preguntas; si tenés header fijo, lo mismo desde la app de Claude en el celu.

### Fase 4 · Sobres (M4) · ~1 semana
Port de `stats.ts` con fixtures; objetivos (mazos con prioridad 1–3, colección con filtro de rarezas, α); tabla por sobre con P(≥1), E[buscadas], valor esperado, sobres para 50/90 %; conmutador «modelo del tracker»; interruptor «disponible»; por carta faltante: costo en puntos e intercambiable; E[sobres para completar un mazo].
**Aceptación (brief M4).** (a) Las tablas por posición suman 100 % (Deluxe posición 3 = 99,999 documentado). (b) **Con «modelo del tracker» activo** y el filtro «todas las rarezas, 1 copia» los 29 sobres coinciden a 4 decimales con el Apéndice B y a 1 decimal con la web del tracker (que puede tener un `cards.json` más nuevo). (c) **Con el modelo corregido** (por defecto) y el mazo 13 como único objetivo (falta 1 Hoopa ex ◊◊◊◊), el sobre recomendado es B4b/deluxepackmega con 1,43 % (1/70; 4.ª carta ◊◊◊◊ garantizada) por encima de B4/ruleroftheskiespack con 1,06 %, y la tabla muestra «500 puntos, intercambiable»; con «modelo del tracker» B4b daría 0 % por el bug 2, y la UI lo explica. (d) A4b y B4b aparecen con su interruptor.
**Cómo lo probás.** Activás «modelo del tracker», marcás los mazos 13, 15 y 19 como objetivo y comparás contra el tracker con el mismo filtro; volvés al modelo corregido y mirás la diferencia explicada.

### Fase 5 · Torneos (M5) · ~1–1,5 semanas
Cliente con limitador y reanudación; backfill de 60 días en segundo plano; incremental cada 6 h; tabla editable de sets con `opensEra` y control cruzado contra las listas; agregados por arquetipo y por lista exacta (nombre y grupo); «qué puedo armar», «qué carta destraba más listas», «con y sin carta»; autocompletado de rivales en M6 y columna «torneo» en la comparativa; cola de cartas desconocidas; aviso «era nueva probable» a los 35 días de la última release.
**Aceptación (brief M5).** Para la era B4a (desde el 27/8/2026; B4b no abre era) con jugadores ≥ 12 y CUSTOM excluido, cortando al 6/10/2026, el sync reporta 154 torneos y ~12,6 k jugadores (Limitless mostraba 154 / 12.223 ese día; la diferencia de jugadores es esperable); con la ventana del brief (27/8 → 5/10) la media de la era `ΣW/Σ(W+L+T)` reproduce el 46,7 % del brief ± 1,5 pp y el valor obtenido queda como fixture; cada fila lleva listas, partidas e intervalo; el récord de la lista exacta del mazo 2 (51,1 % en 268 partidas según tu documento) se reproduce en orden de magnitud; los dos standings de `docs/fase0/limitless/` normalizan a 190-204-40 y 1051-1119-20; un 429 de Limitless pausa el job, nunca lo aborta; el log muestra ≤40 llamadas por 5 min.
**Cómo lo probás.** Abrís la era B4a, buscás el mazo 2 y comparás con tu documento y con la página de Limitless; cargás una partida y ves el autocompletado de rivales.

### Fase 6 · Simulación (M7: worker, matriz, comparación, optimización, repeticiones) · ~2 semanas
Workflow de Actions que compila `engine-cli` @ `fb792ebf` + estado de implementación; `apps/worker` con descarga verificada, tarea programada, claim/lease/heartbeat/result, reanudación, núcleos configurables; jobs `matrix`, `compare` y `optimize` con semilla elegible; progreso SSE; replays (2 por cruce) con visor en texto (o el viewer de deckgym); columna «simulación» en la comparativa; marca «no simulable: <carta>» antes de encolar.
**Aceptación (brief M7).** Corre la matriz de los 40 mazos (780 cruces, `e2,e2` × 200, ≈ 1,5 h con 2 hilos) con progreso visible y reanudación tras matar el worker a la mitad y tras apagar la PC; Zoroark ex/Mega-Absol ex vs Mega-Blaziken ex reproduce aproximadamente tus tiempos con 2 hilos (10.000 `r,r` ≈ 15 s; 200 `e2,e2` ≈ 7 s; 100 `e3,e3` ≈ 12,5 s); cada resultado guarda motor, bot, n y semilla; la reproducibilidad entre procesos se mide el día 1 (misma semilla, dos corridas) y queda documentada como exacta o «mejor esfuerzo»; los 40 mazos se simulan (46 reimpresiones B4b mapeadas); un mazo con B4b-198 sin remapeo se marca no simulable nombrando la carta; una lista de torneo NOEX sin energía queda no simulable hasta elegirla; victorias, derrotas y empates se muestran por separado con intervalo.
**Cómo lo probás.** Encolás la matriz desde el celu, apagás la PC a la mitad, la prendés y ves que sigue; encolás «mazo 2 vs mazo 22 contra los 10 primeros» como `compare`.

### Fase 7 · Claude de escritura y conector remoto (M8 parte 2) · ~1 semana (+1 si hay OAuth)
`decks.create/update`, `matches.log`, `simulations.enqueue` con scope `mcp:write`; OAuth si el header fijo no está disponible en tu cuenta; `apps/mcp-local` si lo pediste.
**Aceptación.** Desde la app de Claude en el celu: «registrá una victoria con el mazo 7 contra Mega-Blaziken, empecé yo» crea la partida y la ves en la app; desde Claude Code: crear un mazo desde texto español y recibir la validación; encolar una simulación con semilla elegida.
**Cómo lo probás.** Las tres frases anteriores, desde el celu y desde Claude Code.

### Fase 8 · Jugar contra un bot, consistencia y «más adelante» · abierto
`Player` propio con long-poll y UI de partida en texto; job `consistency`; reemplazo sugerido para listas de torneo incompletas; misiones (`themed-collections`); avisos de set nuevo y cambio de era.
**Aceptación.** Una partida completa contra `e2` desde el celu con la PC encendida, cada decisión con sus acciones legales; `consistency` para el mazo 2 devuelve P(Mega-Blaziken ex listo en turno ≤ 3) con n = 1.000 e intervalo; para una lista de torneo incompleta, la app nombra la carta faltante y el sustituto que tenés.

**Transversal.** Tests del dominio con fixtures reales y cobertura exigida en `packages/domain`; `pnpm test` verde en CI antes de cada deploy; al cerrar cada fase, `CLAUDE.md` con comandos (`pnpm test`, `pnpm catalog:sync`, `pnpm db:migrate`, `fly deploy`, `pnpm worker:install-task`) y estado.

---

## 8. Preguntas abiertas

### A. Decisiones caras de revertir (necesito tu respuesta antes de la Fase 1)

1. **Stack y hosting.** ¿Opción A (NestJS proceso único + Prisma + React/Vite PWA, monorepo pnpm) desplegada en **Fly.io** con una máquina siempre encendida (≈ 4 US$/mes, pide tarjeta)? Alternativas: Fly con auto-suspensión + tick externo desde GitHub Actions (~1–2 US$, una pieza más), Render Free (0 US$, ~1 min de arranque en frío, 750 h/mes) o la opción B (Next.js en Vercel Hobby, 0 US$, otro código). **Por defecto: A en Fly con `min = 1`.**
2. **Base de datos.** ¿Supabase Free (Postgres siempre encendida sin tope de cómputo, 500 MB, 1 GB de almacenamiento para repeticiones y backups, sin restauración puntual, pausa tras 7 días sin actividad que el scheduler evita) o Neon Free (1 GB, restauración puntual de 6 h, pero 100 CU-h/mes que el polling del worker consume y DB fría durante el OAuth del conector)? Cambié la recomendación tras evaluar las herramientas que me pasaste. **Por defecto: Supabase.**
3. **Autenticación y dominio.** ¿Contraseña + TOTP + cookie de sesión hechos a mano, passkeys después? ¿Tenés dominio propio o usamos `*.fly.dev`? (Las passkeys quedan atadas al dominio.) Y para el conector remoto, si tu cuenta no permite header fijo: ¿servidor OAuth externo gratis (Descope con nuestro propio login, o WorkOS; 1–2 días), `better-auth` como servidor OAuth (2–4 días) o hecho a mano (1–2 semanas)? **Por defecto: contraseña + TOTP a mano; `*.fly.dev`; Descope como servidor OAuth si hace falta.**
4. **Modelo de datos.** ¿Aprobás: (a) identidad por `card_id`, carta funcional = `alternate_versions`, unidad de stock = ediciones que comparten `internal_id`; (b) ajuste manual = **valor absoluto** de copias jugables por carta funcional («tengo 2 Latias»), no un delta por edición, no exportable salvo que lo conviertas; (c) nombre canónico para «2 por nombre» en inglés, mostrado en español; (d) lista exacta de torneo con dos claves (por nombre como pide el brief, y por grupo funcional), mostrando por grupo; (e) las foils con id propio de los Deluxe (B4b-372) cuentan como copias jugables, como hace el tracker? **Por defecto: sí a todo.**
5. **Motor.** (a) `engine-cli`: ejecutable propio que enlaza deckgym sin modificarlo (500–800 líneas de Rust compiladas por GitHub Actions; reinterpreta «binario aparte» como «proceso aparte»; obra derivada AGPL sin consecuencias privadas); (b) fork fijado + parche mínimo de ~50 líneas (binario `deckgym` literal; el parche se re-aplica en cada actualización); (c) CLI intacto (sin consistencia, reproducibilidad solo por proceso por partida, resultados por regex sobre su salida). **Por defecto: (a)**, porque evita mantener un fork cuando el código interno del motor cambia.
6. **Cuentas y permisos.** ¿Creo el repo privado en GitHub (`gh` ya está autenticado) y las cuentas de Fly y Neon? ¿Tenés plan Pro o Max en claude.ai y podés mirar hoy si al agregar un conector personalizado aparece la sección «Request headers»? (Define el costo de M8.) **Por defecto: creo repo y cuentas cuando apruebes; asumo OAuth en Fase 7 si no me decís.**

### B. Con valor por defecto (lo aplico salvo que digas lo contrario)

7. Orden de fases: partidas (Fase 2) y Claude de lectura (Fase 3) antes de sobres y torneos. **Por defecto: sí.**
8. ¿Hay hoy algún ajuste manual pendiente? Latias y Latios ya vienen 2/2 en el CSV de hoy. **Por defecto: ninguno; la función se prueba con uno creado a propósito.**
9. Sobres: modelo **corregido** por defecto con conmutador «modelo del tracker» en la UI; prioridad por mazo en 3 niveles con «máximo entre mazos»; α inicial 0,7 hacia mazos; A4b apagado y B4b encendido como disponibilidad inicial (¿A4b sigue disponible?); saldo de puntos por expansión como campo opcional vacío; rarezas intercambiables ◊…◊◊◊◊ + ☆ y costos ✵/✵✵ marcados «sin verificar» hasta que los confirmes en el juego; bebés de A4/A4a solo como 6.ª carta (¿viste alguna en posición 4 o 5?). **Por defecto: todo lo anterior.**
10. Torneos: umbral 12 jugadores (configurable); NOEX como filtro aparte; `pairings` después; backfill de 60 días. **Por defecto: sí.**
11. Simulación: 8 núcleos por defecto (tenés 20 hilos); tarea programada al iniciar sesión (no servicio); 2 replays por cruce en Postgres, purga al archivar; **visor propio en texto** (el viewer de deckgym embebido como opción); jugar contra `e2` con la PC encendida. Mazo 10 (todo Incoloro): ¿qué energía declaraste en el juego? **Por defecto: Psíquica si no decís otra.**
12. Texto de ataques y habilidades en inglés (no hay fuente en español confiable), nombres en español. **Por defecto: sí.**
13. Sync del catálogo con aviso y aprobación manual del pin, nunca automático. **Por defecto: sí.**
14. MCP local por stdio además del remoto (solo aporta uso sin desplegar u offline, 1 día). **Por defecto: no.**
15. «Nada se sirve sin autenticar» literal, chunks JS incluidos. **Por defecto: sí.**

Decisiones menores ya anotadas en `DECISIONES.md` (objetá si querés): el CSV de contexto se guarda con fecha en el nombre; en el HP de `P-A-22` manda el tracker; la carpeta `Docs/` pasa a `docs/` al crear el repo.

---

## Apéndice A · Hallazgos por módulo (lo que condiciona el diseño)

### A.1 Catálogo e identidad
- `internal_id = (expansionId << 16) | (cardNr << 6) | rarityId` (`scripts/encoder.ts:23`); rareza en los 6 bits bajos. 453 filas apuntan a otra carta: A4b 214, B4b 236, A1a 1 (Ámbar Viejo) y **B2a-89 Iono y B2a-92 Penny son ids huérfanos** (resto del fix #855). Nunca decodificar.
- Una reimpresión **comparte** `internal_id` solo si el set tiene `containsLinkedCards` (A1a, A4b, B4b), la rareza es ◊…◊◊◊◊ y existe una impresión anterior de igual rareza en otro set; la «segunda tanda» foil de los Deluxe (A4b números pares, B4b 237–402) recibe id propio. A4b: 214 compartidas + 165 propias (139 foils emparejadas); B4b: 236 + 193 (166 foils).
- `deckbuilding_id = alternate_versions[0]` tal cual (tres overrides: Mew `A1a-31`, Poké Ball `P-A-5`, Investigación de Profesores `P-A-7`); el resto del array viene ordenado.
- Grupos por tamaño (ids distintos): 1: 1.361, 2: 571, 3: 236, 4: 110, 5: 31, 6: 10. Copycat/Copiona = {B1-225, B1-270, B4b-225, B4b-391, B4b-424}.
- Ruido de scraping: `damage` con la última palabra del nombre del ataque (40 formas); `ability.effect` de los 395 Entrenadores con `Illustrated by …` pegado; costo literal `'No Cost'` en 40 ataques; desde A2b todas las cartas de sets mono-sobre traen `pack: 'everypack'` aunque `CardsDB.ts` declare otro nombre; `hp` solo en 8 fósiles; `baby` es una heurística (hp 30 y sin debilidad).
- Excepción de evolución: Eevee ex (A3b-56/A3b-92) tiene la habilidad «Veevee 'volve» (evoluciona a cualquier evolución de Eevee); el motor la implementa como caso especial en `can_evolve_into` (`models/card.rs:302-316`). Es la única excepción en el catálogo actual.
- Proceso del tracker al salir un set: ~1 set por mes, publicado 1–3 días después del lanzamiento; cambian `types/index.ts`, `CardsDB.ts`, `scraper.ts`, locales, `cards.json` **incluidas filas de sets viejos**, traducciones (es-ES se carga a mano), imágenes. Las correcciones de rareza cambian `internal_id` de cartas existentes.
- Deck builder del tracker: valida nombre, ≥1 energía y 20 cartas; el máximo de 2 es solo de UI y por grupo, no por nombre; sin Básico ni evoluciones.

### A.2 CSV
- Orden = `cards.json`; BOM; LF; sin comillas; sin salto final; `TRUE/FALSE`.
- Dedupe por `InternalId` → suma por grupo. En tu CSV de hoy: 5.844 ingenuo vs 4.714 real; 371 grupos quedarían sobrecontados sin dedupe.
- Importador del tracker: upsert de todas las filas, no valida ids, `Collected FALSE` solo baja la bandera, una gemela `FALSE` gana sobre otra `TRUE`. Nuestro exportador debe producir gemelas idénticas y las 8 columnas en orden.

### A.3 Modelo de sobres
- Tablas por posición (5 cartas: pos. 1–3 ◊ 100; pos. 4: ◊◊ 90, ◊◊◊ 5, ◊◊◊◊ 1,666, ☆ 2,572, ☆☆ 0,5, ☆☆☆ 0,222, Crown 0,04; pos. 5: 60/20/6,664/10,288/2/0,888/0,16; variantes shiny con ✵ 0,71425/2,857 y ✵✵ 0,33325/1,333) coinciden con las tasas oficiales. Rare pack 0,05 % uniforme por carta elegible (oficial: ponderado por rareza; error ≤ 0,05 pp). Sobre de 6 cartas 8,33 % con 6.ª carta ◊◊◊ 87,1 / ☆ 12,9 (A4 y A4a). Deluxe (4 cartas): pos. 1 ◊ 100; pos. 2 ◊ 17,73 / ◊◊ 82,27; pos. 3 ◊ 23,021, ◊◊ 17,985, ◊◊◊ 40,659, ☆ 12,858, ☆☆ 2,5, ☆☆☆ 1,111, ✵✵ 1,667, Crown 0,198; pos. 4 ◊◊◊◊ 100; sin rare pack (oficial 0,05 %, ignorado).
- Por carta: p_pos = tabla[pos][rareza] / #cartas de esa rareza en el sobre; P(≥1) = 1 − ∏(1 − Σ p_pos) con independencia entre posiciones; `deckbuildingMode` matchea por `alternate_versions`; rareza `P` se saltea.
- **Bug 1:** en sets con `containsBabies: false` pero cartas `baby` (B1, B2, B3, B4, B4a, B4b) el denominador excluye las bebés y la masa por rareza suma 107–125 %. Fix: excluir bebés solo si `containsBabies`.
- **Bug 2:** en modo mazos, `pullRate` prefiltra las buscadas por `c.expansion === expansion.id` antes de matchear por grupo, así que las reimpresiones funcionales de otra expansión nunca cuentan (B1 megaaltariapack 24 → 30 cartas, 59,74 → 61,03 %; Hoopa ex B4-103 buscado en B4b: 0 % en vez de 1/70). Fix: no prefiltrar.
- La pantalla Overview itera solo `openable: true` y omite A4b/B4b; `wantedCards` = cartas con `amount_owned ≤ number − 1` tras el filtro de rareza; muestra con un decimal.
- `craftingCost`: ◊ 35, ◊◊ 70, ◊◊◊ 150, ◊◊◊◊ 500, ☆ 400, ☆☆ 1250, ☆☆☆ 1500, Crown 2500 (sin ✵/✵✵). El tracker considera intercambiables ◊…◊◊◊◊, ☆, ☆☆, ✵, ✵✵; las fuentes de 2025 dicen que el juego solo intercambia ◊…◊◊◊◊ y ☆.

### A.4 deckgym
- Parser de mazo (`src/deck.rs`): ignora vacías y líneas que empiezan con `Pokémon:` (con acento) o `Trainer:`; `Energy:` con nombres en inglés separados por coma (nombre desconocido ⇒ panic); carta = `<count> … <SET> <NUMBER>` (solo mira los dos últimos tokens; número rellenado a 3 dígitos). Sin `Energy:` infiere la unión de tipos de los Pokémon, Dragón e Incoloro incluidos ⇒ panic en `game.rs:164-185`; y un Incoloro de relleno haría que la Zona de Energía genere Incoloro la mitad de las veces en silencio.
- `is_valid` (20 cartas, ≥1 Básico, energías seleccionables, ≤2 por nombre) **no se llama en `simulate`**; un mazo de 19 cartas se simula igual. Los fósiles no cuentan como Básico para el motor.
- `Simulation` usa `seed.unwrap_or(random())` **por partida** (`simulate.rs:247`): con `--seed` todas las partidas son idénticas; sin él, irreproducibles. `--parallel -j N` con rayon. Los bots consumen solo el `StdRng` de la partida, pero las ramas de ataques multiobjetivo se construyen iterando un `HashMap` (`apply_attack_action.rs:5996-6020`) y se eligen por índice (`apply_action.rs:62-69`): el orden puede cambiar entre procesos.
- Salida de `simulate`: resumen solo por `warn!` a stderr con separadores de miles (`Player 0 won: 6,150 (61.50%)`); barra de progreso de indicatif; sí hay salidas JSON por partida: replays (`--replay-dir`, un JSON por partida con `ViewState` por decisión, ~2 KB por ply) y `--data-output`.
- `Game::new(players, seed)` no acepta handlers; para grabar o medir hay que usar `new_with_event_handlers` con un `CompositeSimulationEventHandler` y llamar `on_game_start_with_metadata` / `on_game_end` (como hace `Simulation::run`). `optimize()` devuelve solo `(combinación, % victorias)` y su callback no trae el resultado: para separar empates hay que iterar `generate_valid_combinations` uno mismo.
- Jugadores: `r`, `w`, `m` (MCTS 100 iteraciones), `v`, `e<n>` (expectiminimax; `e` = profundidad 3), `er`, `aa`, `et`, `h`, `x`. `optimize`: candidatos `A2147`/`A2 147`/`P-A 5`.
- Estado de implementación: Pokémon por texto exacto de ataque/habilidad en dos mapas (560 y 157 claves); Tools y Stadiums por texto; el resto de Entrenadores por `match` sobre el id de la edición ⇒ cada reimpresión nueva aparece como no implementada hasta que alguien agregue la variante. `card_status --incomplete-only` imprime `ID  Name  Status` con el resumen sobre las filas filtradas.
- Python (`pyo3`): `simulate` secuencial con el mismo bug de semilla; sin handlers ni replays.
- Windows: `.cargo/config.toml` con `/STACK:8388608` necesario; MSVC Build Tools (o GNU) si se compila local; Actions `windows-latest` lo trae.

### A.5 Limitless
- Volumen: 400 torneos más recientes (20/7 → 6/10): `null` 293, `CUSTOM` 102, `NOEX` 5; mediana 50 jugadores, p90 140, máximo 484. Ventana del brief (27/8 → 5/10): 160 torneos `null` / 12.564 jugadores; con ≥12: 154 / 12.616 (Limitless muestra 154 / 12.223 para B4a al 6/10).
- `standings`: `placing` puede ser `null` en abandonos; `energy` puede faltar (torneo NOEX); `number` sin ceros; empates reales en BO1 (9 % de partidas); las derrotas superan a las victorias por byes y derrotas automáticas (media 43,8 % y 48,0 % en los dos torneos analizados).
- `deck.id` es un slug con set para desambiguar (`mega-lucario-ex-b3-lucario-a2`); salen de reglas que Limitless edita sin aviso.
- Fechas de lanzamiento (única fuente: tabla de pocket.limitlesstcg.com; Bulbapedia no respondió; A2 figura 29/1 o 30/1 según la fuente; la tabla es editable en la app): A1 30/10/2024, A1a 17/12/2024, A2 29/1/2025, A2a 28/2, A2b 27/3, A3 30/4, A3a 29/5, A3b 26/6, A4 30/7, A4a 28/8, A4b 30/9 (no abre era), B1 30/10/2025, B1a 17/12/2025, B2 29/1/2026, B2a 26/2, B2b 26/3, B3 28/4, B3a 28/5, B3b 30/6, B4 30/7, B4a 27/8, B4b 30/9 (no abre era). Próxima era probable ≈ 29/10/2026.
- Builder `?i=`: `3` + por carta `count len(set) len(number) set number` con `P-A` → `P0A` (decodificado por inspección).
- Prior art: `mogja9/ptcgp-tracker` (MIT), `indren9/ptcgp_ranking` (MIT), `PocketDecks/*` (AGPL), `KevinGutowski/tcgp-deck-qr` (MIT).

### A.6 MCP, hosting, worker
- MCP 2026-07-28: sin sesiones ni handshake, un POST por request, GET eliminado, DCR deprecado a favor de CIMD; las apps de Claude siguen las specs 2025-03-26/06-18/11-25 e identifican `clientInfo` en `initialize`. SDK TS v2 partido en `@modelcontextprotocol/server|client|core|node|express|hono` (2.3.x); los helpers de servidor de autorización quedaron en `server-legacy` con la recomendación de usar un proveedor de identidad aparte. Claude Code: `claude mcp add --transport http … --header`; Claude Desktop: stdio por `claude_desktop_config.json`.
- Conectores: `oauth_cimd`/`oauth_dcr` soportados; `static_headers` beta; callback `https://claude.ai/api/mcp/auth_callback`; discovery y token en <10 s; egress 160.79.104.0/21.
- Fly Proxy suspende o para la máquina cuando no tiene tráfico entrante («load 0»), sin mirar timers ni trabajo saliente; el bucle corre cada pocos minutos.
- Presupuesto de polling (serverless): short-poll cada 30 s las 24 h ≈ 86 k invocaciones y 12,7 GB-h al mes (entra en Vercel Hobby); long-poll 25 s las 24 h ≈ 1.274 GB-h (no entra). En un proceso persistente el long-poll es gratis.
- Worker en Windows: Task Scheduler «al iniciar sesión» (sin software extra); NSSM/WinSW si se quiere servicio real; `pm2 startup` no soporta Windows.
- Peers verificados: `@rekog/mcp-nest@2.0.7` exige `zod ^4.3.5`, `express ≥4`, `@nestjs/core ≥9`, `@nestjs/microservices ≥9`; `@modelcontextprotocol/server@2.3.1` exige `zod ^4.2`; `vite-plugin-pwa@2.0.0` acepta Vite 8 y Node ≥20.19.

## Apéndice B · Fixtures calculados con tu CSV del 6/10/2026

Archivo: `docs/context/tcgcollectiontracterexport-2026-10-06.csv`, sha256 `f774c6e43d62a61d344d5761e72707debb2b5294b3fa4c833289463b73e117e8`, 225.937 bytes.

**Copias jugables** (dedupe por `InternalId`, suma por grupo): Mega-Mawile ex 2 · Globito 3 · Bulbasaur A1-1 3 · Latias 2 · Latios 2 · Hoopa ex 1 · Espeon ex 2 · Mega-Sharpedo ex 1 · Hydreigon 1 · Milotic ex 1 · Greninja 1 · Riolu A2-91 1 · Riolu B3-79 9 · Tapu Lele 0 · Capa Hoja 0. Totales: 5.844 ingenuo, 4.714 real, 3.866 unidades, 2.083 coleccionadas, grupos ≥2: 1.255, ≥1: 1.853, 0: 466. Los 40 mazos completos (0 faltantes).

**Probabilidad de ≥1 carta buscada por sobre** (modelo literal del tracker, «modelo del tracker»; filtros: **a** todas las rarezas, 1 copia, sin modo mazos; **b** igual con modo mazos; **c** rarezas ◊…◊◊◊◊, 2 copias, modo mazos; `E_c` = cartas buscadas esperadas por sobre con el filtro c; `n_c` = cartas buscadas en el sobre). Datos completos en `docs/fase0/fixtures-sobres-2026-10-06.json`.

| Exp. | Sobre | Abrible (tracker) | p_a % | p_b % | p_c % | E_c | n_c |
|---|---|---|---|---|---|---|---|
| A1 | mewtwopack | sí | 43,3675 | 31,5445 | 66,7059 | 0,957 | 36 |
| A1 | charizardpack | sí | 68,3468 | 60,8156 | 90,9329 | 1,850 | 57 |
| A1 | pikachupack | sí | 45,9081 | 37,7451 | 72,6683 | 1,087 | 39 |
| A1a | mewpack | sí | 63,4812 | 57,6608 | 94,6544 | 2,206 | 45 |
| A2 | dialgapack | sí | 53,4286 | 47,5151 | 91,4331 | 1,881 | 63 |
| A2 | palkiapack | sí | 42,1176 | 30,4218 | 76,0263 | 1,189 | 39 |
| A2a | arceuspack | sí | 22,6764 | 13,4415 | 75,3522 | 1,165 | 33 |
| A2b | shiningrevelrypack | sí | 12,2429 | 5,1374 | 12,5288 | 0,128 | 20 |
| A3 | lunalapack | sí | 71,8470 | 63,8400 | 94,3409 | 2,050 | 65 |
| A3 | solgaleopack | sí | **78,0258** | **64,9361** | **99,3304** | 3,071 | 89 |
| A3a | buzzwolepack | sí | 46,5096 | 31,0003 | 93,0424 | 2,011 | 46 |
| A3b | eeveegrovepack | sí | 59,8610 | 46,0582 | 93,6877 | 2,056 | 46 |
| A4 | ho-ohpack | sí | 73,8148 | 64,8122 | 88,4562 | 1,651 | 53 |
| A4 | lugiapack | sí | 58,4452 | 46,3000 | 87,4196 | 1,634 | 57 |
| A4a | suicunepack | sí | 51,8136 | 40,6982 | 88,4179 | 1,622 | 40 |
| A4b | deluxepack | no | **96,5096** | 58,1779 | 93,6532 | 1,901 | 177 |
| B1 | megaaltariapack | sí | 67,5724 | 59,7436 | 91,6860 | 1,956 | 51 |
| B1 | megablazikenpack | sí | 57,2686 | 47,9462 | 84,7818 | 1,545 | 44 |
| B1 | megagyaradospack | sí | 56,1934 | 46,0984 | 87,0983 | 1,620 | 50 |
| B1a | crimsonblazepack | sí | 58,7984 | 50,6140 | 97,4778 | 2,588 | 44 |
| B2 | megagardevoirpack | sí | 66,8256 | 56,9971 | 93,0957 | 2,046 | 91 |
| B2a | paldeanwonderspack | sí | 71,4462 | 58,6313 | 95,7584 | 2,232 | 58 |
| B2b | megashinepack | sí | 60,7200 | 52,8581 | 92,8574 | 2,018 | 42 |
| B3 | pulsingaurapack | sí | 61,7578 | 45,4990 | 88,8798 | 1,746 | 78 |
| B3a | paradoxdrivepack | sí | 61,6483 | 53,1110 | 97,8593 | 2,574 | 48 |
| B3b | everydaywonderspack | sí | 43,7263 | 30,0593 | 72,7937 | 1,081 | 24 |
| B4 | ruleroftheskiespack | sí | 63,4564 | 50,9671 | 84,8922 | 1,546 | 80 |
| B4a | teamrocketsambitionpack | sí | 35,3323 | 19,4539 | 90,4955 | 1,757 | 49 |
| B4b | deluxepackmega | no | 62,9611 | 6,0472 | 34,8741 | 0,389 | 39 |
| P-A / P-B | everypack | no | sin `packStructure` (el tracker lanza error) | | | | |

Mejor sobre según el tracker (solo abribles): A3/solgaleopack en los tres filtros. Incluyendo Deluxe: con el filtro a gana A4b/deluxepack (96,5 %). Hoopa ex (B4-103) como única carta buscada en modo mazos: «modelo del tracker» → B4/ruleroftheskiespack 1,064 %, B4b 0 % (bug 2); corregido → B4b/deluxepackmega 1,4286 % (1/70; B4b tiene exactamente 70 ◊◊◊◊). Fixtures por carta (sin modo mazos): A1-4 Venusaur ex 1,66073 %; A1-286 Mewtwo ex Crown 0,07700 %; A4-32 Magby 2,41848 % (solo 6.ª carta); A4a-105 Mantyke Crown 0,20677 %; A2b-100 ✵ 0,36283 %; A4b-1 Bulbasaur 1,09688 %; A4b-360 ☆☆ 0,15625 %; B4b-428 Crown 0,09900 %; B1-109 ◊◊◊ bebé 1,76286 % (con el bug 1).

**Limitless, torneos reales** (`docs/fase0/limitless/`): NOEX `6a9ebbfc…` (79 jugadores): 190-204-40, 38 `placing` nulos; PMPT #45 `6a95b87b…` (393): 1051-1119-20, energías de 1/2/3 tipos en 367/23/3 listas, 277 listas distintas por nombre. Wilson 95 % (1 decimal): 137/268 → 51,1 % [45,2; 57,0]; 43/80 → [42,9; 64,3]; 190/434 → [39,2; 48,5]; 7/10 → [39,7; 89,2].

**deckgym**: `docs/fase0/deckgym-no-implementadas-fb792ebf.json` con las 46 ediciones no implementadas y su edición equivalente.

## Apéndice C · Informes de investigación

En `docs/fase0/`: `catalogo.md`, `sobres.md`, `deckgym.md`, `limitless.md`, `hosting-mcp.md` (informes automáticos del 6/10/2026 con referencias `archivo:línea`; sus números de colección usan la exportación del 1/10 que estaba en Descargas; los de este plan usan la de hoy), `limitless/` (respuestas crudas de la API con sus encabezados), `fixtures-sobres-2026-10-06.json` y `deckgym-no-implementadas-fb792ebf.json`.

## Apéndice D · Tools MCP (M8)

| Tool | Scope | Entrada → salida |
|---|---|---|
| `cards.search` | read | `{q, lang?, type?, limit?}` → cartas con `cardId, nameEs, nameEn, groupId, rarity, expansion, prizePoints, text` |
| `collection.playable_copies` | read | `{query}` (nombre es/en, `card_id` o grupo) → `{groupId, nameEs, playable, fromStock, adjustment?, editions[]}` |
| `collection.editions` | read | `{query}` → cantidades por edición y unidad de stock |
| `decks.list` / `decks.get` / `decks.find_by_card` | read | listado con completitud; detalle con validación, completitud, revisiones y cambios; mazos que usan un grupo |
| `decks.validate` | read | `{text, format}` o `{cards, energies}` → `{ok, errors[], warnings[], parsed}` |
| `decks.missing` | read | `{id}` → faltantes con edición más barata, puntos e intercambiabilidad |
| `packs.recommend` | read | `{alpha?, rarityFilter?, onlyAvailable?, model?: 'corrected' \| 'tracker'}` → tabla por sobre + supuestos |
| `tournaments.stats` / `tournaments.buildable` / `tournaments.unlock_cards` | read | por era: filas con `lists, games, w, l, t, winRate, ci95, orientative` y la media de la era |
| `matches.stats` / `simulations.results` | read | por mazo, con n e intervalo; resultados con motor, bot, n, semilla |
| `decks.create` / `decks.update` | write | desde cartas o texto; devuelve validación |
| `matches.log` | write | `{deckId, result, opponentArchetype?, wentFirst?, mode?, note?}` |
| `simulations.enqueue` | write | `{kind, decksA, decksB?, games?, bots?, seed?, replaySample?}` → `{jobId, chunks, estimatedMinutes, notSimulable[]}` |

## Apéndice E · Herramientas evaluadas (6/10/2026)

Doce servicios propuestos por Santi, verificados contra sus páginas de precios y documentación el 6/10/2026 (informe completo en `docs/fase0/herramientas.md`).

| Herramienta | Veredicto | Por qué |
|---|---|---|
| **Supabase** | **Sí** (reemplaza a Neon) | Postgres siempre encendida sin tope de cómputo, 500 MB, 1 GB de Storage para replays y backups, `pg_cron`/`pg_net`, TOTP incluido. Contras: sin restauración puntual, pausa tras 7 días sin actividad. Su servidor OAuth 2.1 está en beta, sin CIMD ni scopes propios: no usarlo como AS. |
| **Descope** | Quizás (plan B de M8) | Servidor OAuth para MCP con CIMD + DCR, JWT/JWKS, Claude citado en su doc, gratis (7.500 MAU, 2.000 consentimientos/mes, dominio propio incluido) y «Bring Your Own Auth» para que el consentimiento use nuestro login. 1–2 días. Riesgo: salto de 0 a 249 US$/mes si cambian el plan gratis. |
| **WorkOS / AuthKit** | Quizás (plan B de M8) | Lo más simple: CIMD y DCR, PKCE S256, JWKS, 1 M usuarios gratis con MFA y passkeys. Sin BYOA: un login de WorkOS aparte para el consentimiento. ~1 día. Dominio propio opcional (99 US$/mes). |
| **Scalekit** | Quizás | Técnicamente el mejor (BYOA limpio, scopes por tool), pero su precio para «Auth for MCP» es contradictorio (gratis vs add-on de 99 US$/mes). Vale 15 minutos crear la cuenta y ver si el menú MCP está habilitado en el plan gratis. |
| **Clerk** | No | El plan gratis no incluye TOTP ni passkeys (Pro 25 US$/mes), producción exige dominio propio, tokens opacos con introspección. No aporta nada que Descope/WorkOS no den gratis. |
| **PlanetScale** | No | Sin plan gratis (Postgres desde 5 US$/mes + tarjeta): duplica el costo total sin aportar nada frente a Supabase/Neon. |
| **Turso** | No | SQLite, no Postgres (sin `SKIP LOCKED`, `pg_trgm`, `unaccent`); Prisma Migrate no soportado; comprada por Supabase en octubre de 2026. |
| **Sentry** | Quizás (Fase 2–3) | Plan Developer gratis (1 usuario, 5 k errores/mes, 1 monitor de cron y 1 de uptime). Es lo único que te mostraría errores de la PWA en el celular y del worker en la PC, y avisaría si el backup diario o la máquina Fly se caen. ~1 h de setup; antes de la PWA no aporta. |
| **Blacksmith** | No | Exige una organización de GitHub (no repos personales); runners Windows en beta; con builds del motor solo al cambiar el commit, los 2.000 minutos gratis de GitHub sobran. |
| **CodeRabbit** | No | En repos privados el plan gratis solo resume PRs; la revisión cuesta 24–30 US$/mes y duplica `/code-review` de Claude Code. |
| **Linear** | Quizás/no | Gratis con MCP oficial, pero tope de 250 issues y otro sistema fuera del repo. Para una persona: `docs/TASKS.md` versionado o GitHub Issues con milestones por fase (`gh` ya autenticado). |

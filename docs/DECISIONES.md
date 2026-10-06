# Decisiones

Registro de decisiones que tomo sin preguntar, con una línea de motivo (BRIEF §0). Las decisiones caras (stack, modelo de datos, hosting, autenticación, motor) se preguntan antes (PLAN §8 bloque A) y se anotan acá cuando Santi las aprueba.

## Tomadas en la Fase 0 · 6/10/2026

| # | Decisión | Motivo |
|---|---|---|
| 0.1 | Los repositorios de referencia se clonan en `refs/` (shallow) y **no se versionan**; los pins quedan en este archivo y en `LICENCIAS.md`: tracker `3ab58f1`, deckgym-core `fb792ebf`. | Son 15 k archivos GPL/AGPL; alcanza con el commit. |
| 0.2 | La carpeta de documentación pasa a llamarse `docs/` (minúscula) al crear el repo (hoy `Docs/`). | El brief y CI en Linux distinguen mayúsculas. |
| 0.3 | Las exportaciones de la colección se guardan en `docs/context/` con la fecha en el nombre (`tcgcollectiontracterexport-AAAA-MM-DD.csv`) y su sha256 en el plan o en el test que las usa. | Hubo tres exportaciones distintas en una semana; los fixtures dependen del archivo exacto. |
| 0.4 | `displayCardId` de un grupo funcional = `alternate_versions[0]` tal cual (no `min()`); el orden canónico de sets es el de aparición en `cards.json`. | El tracker tiene 3 overrides deliberados; `expansionIds` va de más nuevo a más viejo. |
| 0.5 | Modelo de sobres: port literal de `stats.ts`; por defecto con dos correcciones (denominador de bebés; sin prefiltro por expansión en modo mazos); conmutador «modelo del tracker» en la UI para cumplir el criterio «coincide con el tracker». | Son bugs verificados del tracker; el criterio del brief se cumple con el conmutador. |
| 0.6 | `containsLinkedCards` se guarda como metadato de expansión y no interviene en probabilidades. | Es una directiva del scraper (fix #855); `stats.ts` no lo lee. |
| 0.7 | Exportación a deckgym siempre con `Energy:` explícito, sin cabeceras, `N Nombre SET NUM`; por grupo se elige una edición implementada en el motor. La energía nunca se infiere en silencio: si falta, la app propone y pide confirmación. | Energía inferida hace panic con Dragón/Incoloro y contamina la Zona con un Incoloro de relleno; 46 reimpresiones B4b no están implementadas. |
| 0.8 | Formato de intercambio de mazos = el del portapapeles de Limitless (`<count> <name> <SET> <NUMBER>` + `Energy:`), byte-compatible con deckgym. El texto español lleva línea `- Energía:`. | Un solo formato para los dos sistemas; el archivo de los 40 mazos no tenía energía por mazo. |
| 0.9 | Limitless: `format null → STANDARD`; `CUSTOM` excluido; NOEX como filtro aparte; era por fecha con tabla editable de sets (A4b/B4b no abren era) y control cruzado contra el set más nuevo de las listas recientes; umbral 12 jugadores configurable; un único cliente con token bucket 40/300 s. | Reproduce los 154 torneos que Limitless muestra para B4a; el límite es por IP y los contadores son inconsistentes. |
| 0.10 | Estadística: `WR = W/(W+L+T)`; Wilson 95 % sobre partidas; «orientativo» con menos de 30 listas (torneo) o 30 partidas (propias y simulación); media de la era al lado; intervalos a 1 decimal; torneo, partidas propias y simulación son tipos distintos que nunca se agregan. | Brief §2 y método de la guía. |
| 0.11 | Todo resultado de simulación lleva `engineRev`, bot, n y semilla; los empates se muestran aparte; la reproducibilidad entre procesos se mide el día 1 de la Fase 6 y se declara exacta o «mejor esfuerzo». | Brief M7; el motor itera un `HashMap` en ramas de ataque multiobjetivo. |
| 0.12 | Rareza del motor normalizada a la notación del tracker; ante conflicto de datos manda el tracker y se registra (HP de `P-A 22`: 60). | Solo difieren en notación (600) y un HP. |
| 0.13 | No se copia ningún componente, página, hook ni CSS del tracker; shadcn se regenera con su CLI. | El código del tracker es GPL-3.0; lo generado por shadcn es MIT. |
| 0.14 | Texto de ataques y habilidades en inglés; nombres de cartas, sets y sobres en español. | No existe fuente confiable en español (Limitless no tiene; TCGdex llega a B2a). |
| 0.15 | Excepciones de evolución impresas en cartas se modelan en una tabla `EvolutionAlias` sembrada desde el motor (hoy solo Eevee ex → Eevee). | El mazo 15 es legal por la habilidad «Veevee 'volve»; el motor la implementa como caso especial. |
| 0.16 | Los ajustes manuales (valor absoluto por carta funcional) no se exportan al CSV; la app ofrece convertirlos en edición manual por edición. | Un valor por carta funcional no se puede repartir entre ediciones sin que lo elijas. |
| 0.17 | El backup incluye todo lo propio (colección, ajustes, mazos, partidas, simulaciones con resultados, configuración, overrides, arquetipos y alias); opcionales solo replays y el crudo de Limitless; excluidos secretos. | Brief §4: «todos mis datos en un archivo». |
| 0.18 | Los informes de investigación y los datos crudos de la Fase 0 se guardan en `docs/fase0/` tal como salieron, con una nota de fecha y fuente de datos. | Trazabilidad de cada número del plan y fixtures sin volver a consumir la cuota de Limitless. |

## Aprobadas por Santi el 6/10/2026 (PLAN §8 bloque A)

| # | Decisión | Respuesta |
|---|---|---|
| A.1 | Stack A: NestJS proceso único + Prisma 7 + React/Vite PWA, monorepo pnpm; **Fly.io con `min_machines_running = 1`** (≈ 4 US$/mes). | A1: aprobado. |
| A.2 | **Supabase Free** como Postgres y Storage (replays, backups); Neon queda como alternativa documentada. | A2: aprobado. |
| A.3 | Login: **contraseña + TOTP + cookie de sesión a mano**; passkeys como mejora opcional después. Dominio: `*.fly.dev` (confirmado). | A3: aprobado. |
| A.4 | Modelo de datos: identidad `card_id`; carta funcional = `alternate_versions`; unidad de stock = ediciones que comparten `internal_id`; ajuste manual = valor absoluto por carta funcional, no exportable salvo conversión; nombre canónico `nameEn` para «2 por nombre»; lista exacta con dos claves (nombre y grupo), mostrada por grupo; foils de Deluxe cuentan. | A4: aprobados los cinco puntos. |
| A.5 | Motor: **`engine-cli`**, ejecutable propio que enlaza deckgym @ `fb792ebf` sin modificarlo, compilado en GitHub Actions; obra derivada AGPL no distribuida (ver LICENCIAS). | A5: aprobado. |
| A.6 | El formulario «Añadir conector personalizado» de claude.ai muestra «Encabezados de solicitud» (hasta cuatro) y la opción «Sin inicio de sesión» para servidores con clave de API: el conector remoto usa un **token fijo `tcg_mcp_*` en `Authorization: Bearer`**, sin OAuth. Descope queda solo como plan B documentado si Anthropic retira esa opción. | Confirmado con capturas el 6/10/2026. |
| A.7 | Crear el repo privado en GitHub; cuentas de Fly y Supabase las abre Santi y pasa los tokens por variables de entorno, nunca por el chat. | Aprobado. |

Las preguntas del bloque B (orden de fases, sobres, torneos, simulación, texto en inglés, pin manual, sin MCP stdio, «nada sin autenticar» literal) quedan con su valor por defecto salvo objeción.

## Fase 1 · decisiones de implementación (desde el 6/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 1.1 | El daño de ataque `'0'` del tracker se normaliza a `null` (136 ataques), además de las 280 palabras filtradas desde el nombre del ataque (que se reponen al nombre). | `'0'` es el marcador del scraper para ataques sin daño; Pocket nunca imprime 0. |
| 1.2 | `isDisplayEdition` es verdadero para exactamente una edición por grupo (la de `alternate_versions[0]`), no para todas las gemelas que comparten ese `internal_id`. | Para armar mazos alcanza con un representante por carta funcional. |
| 1.3 | Los datos del tracker dicen que A4b (Deluxe ex) es `tradeable: true` y `containsShinies: true`; los tests afirman esos valores reales. | Los asumimos distintos en la Fase 0; manda el dato del tracker al commit fijado. |
| 1.4 | La búsqueda del catálogo rankea coincidencia exacta de nombre, luego prefijo de palabra, luego contiene, luego texto de reglas; insensible a mayúsculas y acentos. | «Mew» debe mostrar «Mew ex» antes que «Mewtwo». |
| 1.5 | El dominio no usa `node:crypto`: el hash de reglas (`rulesHash`) es FNV-1a de 64 bits en hexadecimal. | El paquete corre también en el navegador; el hash solo verifica invariantes. |
| 1.6 | Base de datos local de desarrollo y tests: Postgres 17 en Docker Compose (puerto 5433, bases `tcg` y `tcg_test`); producción en Supabase. | Reproducible y gratis; Docker Desktop ya está en la PC. |
| 1.7 | pnpm se instaló como ejecutable de usuario (`%LOCALAPPDATA%\pnpm\bin`) porque `corepack enable` requiere permisos de administrador. | Funciona en PowerShell y Git Bash sin tocar `Program Files`. |
| 1.8 | `DATABASE_URL` local usa `127.0.0.1`, no `localhost`. | El motor de esquema de Prisma resuelve `localhost` a `::1` y Docker en Windows no responde en IPv6. |
| 1.9 | Variables de entorno sin `dotenv`: `util.parseEnv` de Node 24 lee `.env` de la raíz solo fuera de producción. | Una dependencia menos; en Fly las variables vienen de `fly secrets`. |
| 1.10 | La escritura del catálogo en la DB va por `pg` en una sola transacción con `INSERT … ON CONFLICT` por lotes; `rarity_rules` se siembra una vez y no se pisa. | 4.317 filas por sync; las reglas de rareza son configuración del usuario. |
| 1.11 | Las sesiones se memorizan 30 s en memoria del proceso; el logout invalida de inmediato. | Una consulta por carga de página en vez de una por chunk de la PWA. |
| 1.12 | `owner:init` rota el secreto TOTP y cierra todas las sesiones; `--no-totp` lo desactiva (solo desarrollo). | Un solo usuario; re-enrolar es el camino de recuperación. |
| 1.13 | `prisma` es dependencia de producción: las migraciones corren al arrancar el contenedor (`docker/entrypoint.sh`). | Deploy en un solo paso en Fly. |
| 1.14 | `apps/api/biome.json` anidado desactiva `style/useImportType`. | La inyección por constructor de NestJS necesita imports de valor con `emitDecoratorMetadata`. |
| 1.15 | Pendiente (TODO en `catalog-sync.service.ts`): el remapeo automático de I12 al cambiar unidades de stock o grupos; hoy el sync queda en `needs_review` con aviso. | Se implementa cuando haya un segundo commit del tracker que lo exija. |

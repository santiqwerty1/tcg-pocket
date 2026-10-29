# Brief para Claude Code: app personal de Pokémon TCG Pocket

Versión 1 · 6 de octubre de 2026

## 0. Cómo quiero que trabajes

- **Empezá por la Fase 0 y frená.** No escribas código de la app hasta que yo apruebe el plan.
- **Trabajá por fases.** Al terminar cada una mostrame qué quedó, cómo lo pruebo yo y qué decidiste, y esperá mi visto bueno antes de seguir.
- **Preguntame antes de las decisiones caras de revertir:** stack, modelo de datos, hosting y autenticación. El resto decidilo vos y anotalo en `docs/DECISIONES.md` con una línea de motivo.
- **Verificá con mis datos reales**, no solo con ejemplos inventados. Los archivos están en `docs/context/` (ver 3.4).
- **Tests para toda la lógica de dominio:** conteo de copias, validación de mazos, probabilidades de sobres, estadísticas, importadores y exportadores.
- **Antes de reimplementar algo, mirá si ya existe** en los dos repositorios de referencia (sección 3). Leé su código antes de diseñar.
- Creá y mantené `CLAUDE.md` con comandos, convenciones y estado del proyecto.
- Código, identificadores y commits en inglés. Interfaz y textos en español, con los nombres de cartas en español.
- Es una app para un solo usuario. No la diseñes como un SaaS.

## 1. Qué es y para qué

Una app personal para Pokémon TCG Pocket que uso desde la PC y el celular. Reemplaza un flujo manual: hoy exporto mi colección como CSV desde TCG Pocket Collection Tracker y, con chats de Claude y scripts descartables, armo mazos, los valido contra la colección, los comparo con resultados de torneo y decido qué sobres abrir. Cada chat rehace el trabajo desde cero y el CSV queda viejo.

Quiero que la app:

1. Lleve el registro de mi colección, importando y exportando el CSV del tracker.
2. Me deje armar, validar y administrar mazos, y saber qué le falta a cada uno.
3. Me recomiende qué sobres abrir según mis objetivos.
4. Traiga resultados de torneo y los cruce con mi colección.
5. Registre mis partidas y me muestre estadísticas honestas.
6. Simule partidas entre mazos con todas las mecánicas del juego.
7. Exponga todo eso a Claude como herramientas, para consultarlo desde un chat.

Los gráficos no importan: interfaz clara y rápida, texto primero. Las imágenes de cartas son opcionales.

## 2. Reglas del dominio

Estas reglas salen de mi uso real y de errores que ya cometimos. El detalle está en `docs/context/guia_del_proyecto.md`.

**Mazos**
- 20 cartas exactas.
- Máximo 2 cartas con el mismo nombre, sumando todas las ediciones. «Umbreon» y «Umbreon ex» son nombres distintos.
- Al menos un Pokémon Básico. Cada evolución necesita su línea previa en el mazo (o Caramelo Raro para saltar la Fase 1).
- Las energías del mazo se eligen entre los tipos que genera la Zona de Energía. Dragón e Incoloro no se pueden elegir.
- Se gana con 3 puntos. Un Pokémon común da 1, un ex da 2 y un Megaevolución ex da 3.
- El juego me deja tener 30 mazos armados a la vez (eran 25 hasta el 29/10/2026). La app puede guardar más.

**Conteo de copias**
- La unidad es la **carta funcional**: mismo nombre y mismo texto de reglas. Varias ediciones (artes alternativos, rarezas altas, reimpresiones) son la misma carta funcional y sus copias se suman.
- Hay cartas con el mismo nombre y distinto texto (por ejemplo Riolu A2-91 y Riolu B3-79). Comparten el límite de 2 por nombre, pero no son intercambiables. Por eso toda lista guarda el código de edición.
- **Las copias no se reparten entre mazos.** La misma carta puede estar en todos los mazos; cada mazo se valida solo contra la colección.
- Necesito **ajustes manuales** que pisen lo importado. Caso real: el CSV dice 3 Latias y 1 Latios, y yo tengo 2 y 2.

**Datos y honestidad estadística**
- Todo porcentaje se muestra con su tamaño de muestra y su intervalo de confianza.
- Con menos de 30 listas o partidas, el dato se marca como orientativo.
- Datos de torneo, partidas mías y simulaciones son tres fuentes distintas. Se muestran lado a lado y nunca se mezclan en un solo número.

## 3. Piezas existentes para reutilizar

Todo lo de esta sección lo verifiqué el 6 de octubre de 2026. Volvé a comprobarlo, porque el juego saca expansiones seguido.

### 3.1 TCG Pocket Collection Tracker

- Repositorio: https://github.com/marcelpanse/tcg-pocket-collection-tracker (GPL-3.0, React + TypeScript + Supabase). Último commit visto: 1/10/2026, que agrega el set B4b.
- `frontend/assets/cards.json`: 4.317 cartas. Campos: `card_id` (ej. `B3-81`), `internal_id`, `expansion`, `name` (inglés), `hp`, `energy`, `card_type`, `evolution_type` (basic, stage1, stage2, supporter, item, tool, stadium), `attacks[]` (cost, name, damage, effect), `ability`, `weakness`, `retreat`, `rarity`, `ex`, `baby`, `pack`, `alternate_versions`, `artist`, `image`.
- `alternate_versions` lista los `internal_id` de todas las ediciones de la misma carta funcional. Es la base del conteo de copias.
- `frontend/assets/pokemon_translations.json`, `trainers_translations.json` y `tools_translations.json`: nombres en varios idiomas, incluido `es-ES`.
- `frontend/src/lib/CardsDB.ts`: expansiones, sobres de cada una, `openable`, `tradeable`, `packStructure` (cartas por sobre, shinies, bebés, cartas enlazadas) y la tabla de costos en puntos de sobre.
- `frontend/src/lib/stats.ts`: modelo de probabilidad de sacar cartas por sobre. Incluye la tabla del sobre Deluxe de 4 cartas.
- `frontend/src/lib/MissionsDB.ts`: misiones por expansión.

**Formato del CSV que exporta** (archivo `tcgcollectiontracterexport.csv`, con BOM UTF-8), una fila por edición:

```
Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected
A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE
```

- `CardName` sale en el idioma de la interfaz; el mío está en español.
- Su importador exige las columnas `Id`, `InternalId`, `NumberOwned` y `Collected`.
- Las reimpresiones de los sets A4b y B4b que comparten `InternalId` con la carta original repiten su cantidad: son las mismas copias, no copias extra. Para contar, primero se deduplica por `InternalId` y después se suma por grupo de `alternate_versions`.

**Por qué no recomienda el Sobre Deluxe Mega:** A4b y B4b están definidos con `openable: false` y la pantalla de recomendación (`pages/overview/Overview.tsx`) solo recorre las expansiones con `openable: true`. Los datos y la tabla de probabilidades existen. Mi app tiene que incluirlos.

### 3.2 deckgym-core (motor de simulación)

- Repositorio: https://github.com/bcollazo/deckgym-core (AGPL-3.0, Rust). Último commit visto: 4/10/2026. Es el motor de https://www.deckgym.com.
- `cargo run --bin card_status` informa 4.271 de 4.317 cartas implementadas. Las 46 restantes son reimpresiones de Entrenadores de B4b (ej. `B4b 198` Lucky Ice Pop) cuya edición original sí está implementada. Hay que mapear cada carta a una edición implementada con el mismo texto.
- `database.json`: las mismas 4.317 cartas, con ids en formato `A1 001`.
- Formato de mazo (texto):

```
Energy: Darkness
2 Zorua B3 105
2 Zoroark ex B3 106
1 Sabrina A1 225
```

  Varias energías van separadas por coma (`Energy: Fire, Lightning`).
- CLI: `deckgym simulate <mazo> <mazo|carpeta> -n N --players e2,e2 -p`, `optimize` (completa un mazo incompleto probando cartas candidatas contra una carpeta de rivales), `play` (una partida con repetición), `--replay-dir` y `--replay-sample` (repeticiones en JSON), `--data-output` (pares estado-acción).
- Bots: `r` al azar, `w` al azar ponderado, `m` MCTS, `v` función de valor, `e<n>` expectiminimax de profundidad n, `er` apurador de evoluciones, `h` humano por terminal, `x` bot externo por stdin/stdout en líneas JSON (`docs/bot-protocol.md`).
- Tiene un visor web de repeticiones en `viewer/` (Vite), bindings de Python (feature `python`, pyo3) y un recolector de estadísticas de juego.
- **Prueba hecha:** convertí mis 40 mazos a este formato y los 40 quedaron simulables. Zoroark ex / Mega-Absol ex contra Mega-Blaziken ex, en 2 núcleos: 10.000 partidas con `r,r` en 15 s, 200 con `e2,e2` en 7 s y 100 con `e3,e3` en 12,5 s.
- **Advertencia medida:** el resultado depende del bot. Ese mismo enfrentamiento dio 61,5 % a 38 % con `e2` y 51 % a 49 % con `e3`. Con bots al azar, el 63 % de las partidas terminó en empate.

### 3.3 Limitless (datos de torneo)

- Documentación de la API: https://docs.limitlesstcg.com/developer.html. Para datos de torneos no pide clave; hay límites de uso que se leen en los headers de la respuesta.
- `https://play.limitlesstcg.com/api/tournaments?game=POCKET` devuelve objetos con `game`, `name`, `date`, `format`, `id`, `players`, `organizerId` (comprobado hoy).
- En análisis anteriores usé `/api/tournaments/{id}/standings` para obtener la lista de cada jugador con su récord. Confirmalo en la documentación.
- Texto de cartas: `https://pocket.limitlesstcg.com/cards/<SET>/<N>`. Limitless usa nombres en inglés; cruzá siempre por código.
- Referencia de tamaño: para el formato B4a, entre el 27/8 y el 5/10/2026, junté 151 torneos y 11.975 listas. Contando empates y abandonos, el promedio general de victorias dio 46,7 %, no 50 %.

### 3.4 Mis archivos de contexto

En `docs/context/`:

- `guia_del_proyecto.md`: cómo leer el CSV, reglas de validación, fuentes y método.
- `mazos_40_listas.md`: mis 40 mazos actuales, con código de edición en cada Pokémon y nombres en español.
- `tcgcollectiontracterexport.csv`: una exportación real de mi colección.

### 3.5 Licencias

La app es privada y de uso personal. Aun así:

- Anotá en `docs/LICENCIAS.md` qué código o datos tomaste de cada repositorio y bajo qué licencia.
- Usá deckgym-core como binario aparte, fijado a un commit, sin modificarlo salvo que haga falta.
- No copies imágenes de cartas al repositorio. Si mostrás imágenes, que sean enlaces.
- Si algún día abro la app a otras personas, GPL-3.0 y AGPL-3.0 obligan a publicar el código. Dejalo escrito para que yo lo revise llegado el caso.

## 4. Arquitectura

**Fijo**

- Un solo usuario. La app está expuesta a internet, así que igual lleva inicio de sesión, y nada se sirve sin autenticar.
- La app vive en la nube y se usa desde el navegador de la PC y del celular. En el celular tiene que poder instalarse y ser cómoda con una mano.
- Las simulaciones no corren en la nube. Las corre un **worker en mi PC** (Windows) que pide trabajos a la app por HTTPS saliente, ejecuta deckgym-core y sube los resultados. No abre puertos. Si la PC está apagada, los trabajos quedan en cola.
- Costo de hosting: gratis o muy bajo.
- Secretos en variables de entorno. El worker y el servidor MCP se autentican con tokens propios.
- Copia de seguridad: puedo exportar e importar todos mis datos en un archivo.

**A proponer en la Fase 0**

- Stack completo. Compará 2 o 3 opciones y recomendá una. Mi experiencia: React, NestJS, PostgreSQL y Prisma en producción; también Firebase y Python para datos. Criterios: costo de hosting, que el catálogo y el modelo de sobres del tracker están en TypeScript, que el motor es un binario de Rust, y que yo lo pueda mantener.
- Modelo de datos.
- Hosting y base de datos concretos.
- Cómo se actualiza el catálogo cuando sale una expansión.

## 5. Módulos y criterios de aceptación

### M1 · Catálogo de cartas
- Sincroniza cartas, traducciones, expansiones y sobres desde el repositorio del tracker, guardando el commit de origen. Se puede volver a correr.
- Búsqueda por nombre en español o inglés, por código y por texto de la carta.
- **Aceptación:** carga 4.317 cartas o más; cada carta sabe su grupo funcional; buscar «Copiona» y «Copycat» devuelve la misma carta.

### M2 · Colección
- Importa el CSV del tracker. Antes de aplicar muestra el diff: qué cartas cambian y cuánto. Cada importación queda como instantánea con fecha.
- Permite editar cantidades a mano por edición.
- Ajustes manuales por carta funcional, marcados a la vista. Al importar un CSV nuevo, avisa si un ajuste ya coincide con el CSV.
- Vista por carta funcional (copias jugables) y por edición.
- Exporta un CSV que el tracker importa sin errores.
- **Aceptación** con el CSV de contexto (valores del 5/10/2026; con un CSV más nuevo pueden ser mayores): Mega-Mawile ex = 2 copias jugables (B2-113 + B2-201); Globito = 3 (B3b-64 + B4b-372); Bulbasaur A1-1 no se duplica por la fila A4b-1; importar, exportar y volver a importar no produce diferencias.

### M3 · Mazos
- Alta, edición, duplicado y archivo. Cada mazo tiene nombre, energías, 20 cartas con su edición, etiquetas (competitivo, casual, misión), notas, si está armado en el juego (máximo 30) y, si es variante, de qué mazo deriva. Guarda historial de cambios.
- Validación en vivo con las reglas de la sección 2, con mensajes concretos.
- Completitud contra la colección: qué falta y cuántas copias.
- Importa y exporta: texto en español con códigos (el formato de `mazos_40_listas.md`), formato de deckgym y JSON. Investigá si el juego o Limitless tienen un formato de texto propio y sumalo.
- **Aceptación:** importa los 40 mazos de `mazos_40_listas.md`; los 40 validan con 20 cartas y máximo 2 por nombre; los 40 se exportan a formato deckgym sin cartas sin mapear.

### M4 · Sobres
- Para cada sobre, incluidos los Deluxe: probabilidad de sacar al menos una carta buscada en un sobre, cartas buscadas esperadas por sobre y sobres estimados para llegar al objetivo.
- Las cartas buscadas salen de dos objetivos con un control de peso entre ambos: **completar mazos** (marco mazos objetivo con prioridad) y **completar colección** (con filtro de rarezas).
- Cada sobre tiene un interruptor de «disponible», porque la disponibilidad cambia.
- Para cada carta que falta muestra también el costo en puntos de sobre y si es intercambiable.
- Portá el modelo de `stats.ts` del tracker en vez de inventar uno. Averiguá qué implica `containsLinkedCards` en los Deluxe.
- **Aceptación:** con el mismo filtro, el porcentaje de un sobre común coincide con el que muestra el tracker; las tablas de probabilidad por posición suman 100 %; B4b aparece en la recomendación.

### M5 · Torneos
- Sincroniza torneos y listas desde Limitless, de forma incremental, con caché y respetando los límites.
- Detecta el formato vigente y filtra por él.
- Calcula récord por arquetipo y por lista exacta (mismas 20 cartas por nombre, sin mirar la edición).
- Responde: qué listas de torneo puedo armar hoy, qué carta sola destraba más listas, y cuánto rinde un arquetipo con y sin una carta dada.
- **Aceptación:** reproduce el orden de magnitud de la referencia de 3.3; cada número se muestra con cantidad de listas e intervalo.

### M6 · Registro de partidas
- Carga rápida desde el celular: mazo, resultado, arquetipo rival (autocompletado con los de torneo), quién empezó, modalidad y nota opcional. Tiene que llevar pocos toques.
- Estadísticas por mazo y por enfrentamiento, con intervalo de Wilson.
- Vista que compara, por mazo: mis partidas, datos de torneo y simulación.

### M7 · Simulación
- Worker en mi PC según la sección 4, con progreso visible, cantidad de núcleos configurable y reanudación.
- **Matriz de enfrentamientos:** un conjunto de mazos contra otro (míos o listas de torneo), con partidas por cruce, bot y semilla configurables.
- **Optimización de listas:** comparar versiones de un mazo contra un grupo de rivales, y usar `optimize` para completar huecos con cartas candidatas de mi colección.
- **Repeticiones:** guardar una muestra por cruce y poder recorrerlas paso a paso. Evaluá reutilizar el `viewer/` de deckgym.
- **Jugar contra un bot** con una interfaz simple. Proponé en la Fase 0 cómo hacerlo: el protocolo de bot externo, compilar el motor a WebAssembly u otra vía.
- **Consistencia:** probabilidad de tener al atacante principal listo en el turno N, medida con el motor.
- Cada resultado guarda el commit del motor, el bot y la cantidad de partidas. La interfaz aclara siempre que el porcentaje depende del bot.
- Si una carta no está implementada en el motor, el mazo se marca como no simulable y se dice cuál es.
- **Aceptación:** corre la matriz de mis 40 mazos; reproduce aproximadamente los tiempos de 3.2 en mi PC.

### M8 · Conexión con Claude
- Servidor MCP con herramientas de lectura (buscar cartas, copias jugables, listar y ver mazos, validar una lista, qué falta para un mazo, recomendación de sobres, estadísticas de torneo y de mis partidas) y de escritura (crear o modificar mazos, registrar una partida, encolar una simulación).
- Dos formas de uso: local para Claude Code y remota con autenticación para conectarla desde las apps de Claude. Revisá la documentación vigente de MCP sobre transporte y autenticación antes de implementarlo.
- **Aceptación:** desde Claude Code pregunto «¿cuántas copias jugables tengo de Hoopa ex y qué mazos lo usan?» y la respuesta sale de las herramientas, sin leer archivos.

### Para más adelante
- Sugerir el mejor reemplazo cuando falta una carta de una lista de torneo.
- Misiones y eventos con restricciones (por ejemplo, 8 cartas de un tipo).
- Avisos cuando sale una expansión o cambia el formato.

## 6. Fases

- **Fase 0 · Exploración y plan.** Cloná y leé los dos repositorios. Entregá `docs/PLAN.md` con: comparación de stack y recomendación, arquitectura, modelo de datos, cómo se integra cada pieza reutilizada y qué implica su licencia, riesgos, plan de fases con criterios de aceptación y preguntas abiertas para mí. Frená acá.
- **Fase 1 · Núcleo:** M1, M2, M3 y copia de seguridad, con inicio de sesión y desplegado.
- **Fase 2 · Sobres:** M4.
- **Fase 3 · Torneos:** M5.
- **Fase 4 · Partidas:** M6.
- **Fase 5 · Simulación:** worker, matriz, optimización y repeticiones de M7.
- **Fase 6 · Claude:** M8.
- **Fase 7:** jugar contra un bot, consistencia y lo de «más adelante».

Podés proponer otro orden en la Fase 0 si lo justificás. Por ejemplo, adelantar una versión de solo lectura de M8.

## 7. Fuera de alcance

- Varios usuarios, amigos, chat e intercambios entre jugadores.
- Escanear capturas de pantalla: lo sigo haciendo en el tracker y paso el CSV.
- Automatizar el juego o leer datos del juego.
- Animaciones y gráficos elaborados.
- Publicar la app.

## 8. Primer paso

Hacé solo la Fase 0. Al terminar, resumime en el chat la recomendación de stack, los tres riesgos más grandes y las preguntas que necesitás que responda.

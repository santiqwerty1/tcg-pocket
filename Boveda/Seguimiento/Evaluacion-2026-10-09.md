---
tipo: documento
titulo: >-
  Evaluación de mejoras del 09/10/2026
area: proyecto
estado: vigente
actualizado: '2026-10-09'
origen:
  - pedido de Santiago (09/10/2026) «Evalúa en profundidad posibles mejoras/agregados a la app»
  - revisión del código en 0524489 (interfaz, API y operación, dominio, simulación y MCP)
  - datos de producción leídos por MCP el 09/10/2026
revisar: false
---

# Evaluación de mejoras del 09/10/2026

> [!info] Es una propuesta
> Nada de esto está aprobado. El orden propuesto está en [D-020](Decisiones/D-020.md), las fases en [T-014](Tareas/T-014.md) y lo que Santiago tiene que contestar en [P-006](Preguntas/P-006.md), [P-007](Preguntas/P-007.md) y [P-008](Preguntas/P-008.md). Cada defecto confirmado tiene su ficha (H-002 a H-015), verificada en el código en `0524489`.

## Resumen

**Qué dicen los datos de producción (09/10/2026, por MCP):**

- **Partidas:** 1 registrada en total.
- **Mazos:** 41, todos válidos y completos contra la colección, y 0 ajustes manuales.
- **Colección:** último CSV del 08/10.
- **Torneos:** era B4a con 149 torneos, 12.020 listas y 819 arquetipos.
- **Simulaciones:**
  - La matriz 100 × 100 (#4) corre desde el 08/10 a las 18:07 y va por el 89 %.
  - La búsqueda #9 del laboratorio tardó 1 h 47 min (59.700 partidas). La app había estimado unos 12 minutos.

**Conclusiones:**

1. **Primero que lo que ya muestra la app sea correcto.**
   - Hay 14 defectos confirmados. Varios cambian un número que Santiago usa para decidir:
     - [H-005](Hallazgos/H-005.md): la suerte de los sobres durante el Deluxe, que está a la venta hasta el 28/10.
     - [H-009](Hallazgos/H-009.md): «¿Mala racha?».
     - [H-010](Hallazgos/H-010.md): el laboratorio.
     - [H-012](Hallazgos/H-012.md): los «días para completar».
   - Hay fallas que hoy no se ven ([R-011](Riesgos/R-011.md)).
   - Las copias de seguridad viven en la misma base que pueden perder ([R-006](Riesgos/R-006.md)).
   - Conviene arreglar esto antes de que se junten datos que valga la pena cuidar.
2. **Lo de «mis partidas» está vacío.** Hoy no hay nada que analizar en:
   - la mala racha;
   - el orden de turno;
   - la semana;
   - las notas por rival;
   - la columna «mías» de «¿Cuál llevo hoy?».

   Lo que más cambia esto es que registrar una partida cueste menos. La Fase 28 ayudó; faltan el botón «Guardar» fijo y el atajo del ícono de la app.
3. **El objetivo «completar mazos» de Sobres no tiene nada que buscar.** Los 41 mazos están completos, así que solo sirve con «versión de torneo». La pregunta útil pasa a ser qué mazo armar después, y la colección.
4. **El próximo set nuevo va a encontrar tres puntos débiles:**
   - El botón Sincronizar vuelve al commit fijado ([H-004](Hallazgos/H-004.md)).
   - Los torneos del set nuevo se mezclan con la era vigente ([H-006](Hallazgos/H-006.md)).
   - Un valor nuevo en el catálogo (una rareza, un tipo de evolución) rompe la sincronización y todas las pantallas con cartas ([H-008](Hallazgos/H-008.md)).

## Lo que resolvieron las fases 25 a 35

La revisión se hizo sobre `8b97399` y después se comparó contra `0524489`.

| Tema de la revisión | Después de 25–35 |
|---|---|
| Cargar partidas sin señal | Resuelto (Fase 28: cola en el celu, `clientRef`, `playedAgoMs`). Sin señal, las pantallas de consulta siguen sin mostrar nada. |
| Buscador único | Resuelto (Fase 27). |
| Ver el estado de un vistazo | En parte (Fase 26, «Hoy»). Faltan los avisos de operación ([R-011](Riesgos/R-011.md)) y «CSV viejo». |
| Tests de pantallas | En parte (Fase 34, tres recorridos). Faltan el editor de mazos, la importación del CSV y la restauración del backup. |
| Restauración nunca probada | En parte (Fase 35, prueba mensual dentro de una transacción). Sigue sin haber copia fuera de Supabase ni una guía para reconstruir desde cero ([P-007](Preguntas/P-007.md)). |
| Copias que sobran para intercambiar | Resuelto (Fase 31). |
| Victorias empezando y yendo segundo | En parte (Fase 25). Falta el porcentaje ajustado por la moneda, y la prueba no sirve con pocas partidas ([H-011](Hallazgos/H-011.md)). |
| Demora de las partidas contra el bot en el celu | Resuelto (Fase 33, eventos del servidor). |
| Claude: analizar partidas, intercambio y semana | 4 tools nuevas (Fases 29, 31 y 32). |

**Lo que empeoró:**

- **«Hoy» pone «Para hoy» encima de la carga rápida.** El formulario ya medía unos 840 px, así que «Guardar partida» queda todavía más abajo, debajo de la barra inferior.
- **«Hoy» pide `/api/decks-today` cada vez que se abre** (la caché dura 30 s), y esa consulta es de las más caras de la API ([H-007](Hallazgos/H-007.md)).

## Defectos confirmados

| Ficha | Qué | Severidad | Esfuerzo |
|---|---|---|---|
| [H-002](Hallazgos/H-002.md) | La versión del worker se compara como texto: con la 0.2.10, el entrenador y la consistencia dejan de repartirse. | media | S |
| [H-003](Hallazgos/H-003.md) | La espera larga del worker no suelta su listener. | baja | S |
| [H-004](Hallazgos/H-004.md) | «Sincronizar» del catálogo vuelve al commit fijado, aunque el aviso de set nuevo manda a apretarlo. | alta | M |
| [H-005](Hallazgos/H-005.md) | La suerte de los sobres espera las ex del Deluxe a la tasa del sobre común. | media | S |
| [H-006](Hallazgos/H-006.md) | Un set que la tabla de eras no conoce se mezcla con la era vigente. | media | S |
| [H-007](Hallazgos/H-007.md) | «¿Cuál llevo hoy?»: cientos de consultas por apertura de «Hoy», y puntajes de un motor viejo. | media | S–M |
| [H-008](Hallazgos/H-008.md) | Un valor nuevo del tracker rompe la sincronización del catálogo y las pantallas con cartas. | media | S |
| [H-009](Hallazgos/H-009.md) | «¿Mala racha?» toma la tasa esperada como exacta y compara partidas sueltas con récords de BO3. | media | S–M |
| [H-010](Hallazgos/H-010.md) | El laboratorio acepta variantes por azar. | media | S–M |
| [H-011](Hallazgos/H-011.md) | Intervalos y pruebas más seguros de lo que son (torneos, esperado contra el meta, tendencias, orden de turno, optimizar). | media | S–M |
| [H-012](Hallazgos/H-012.md) | «Días para completar» no cuenta los puntos de sobre. | media | M |
| [H-013](Hallazgos/H-013.md) | Una partida tomada por el worker nunca se abandona sola. | baja | S |
| [H-014](Hallazgos/H-014.md) | El worker no detecta un motor colgado, y el latido no verifica de quién es el chunk. | media | S |
| [H-015](Hallazgos/H-015.md) | Descompresión sin límite, conexiones a la base sin tiempo máximo, respuestas sin comprimir. | baja | S |

Otros puntos:

- **Tope de tipos de energía.** La validación no limita cuántos tipos de energía lleva un mazo y la API acepta hasta 8. Si el juego permite 3, es un error de la validación ([P-006](Preguntas/P-006.md)).
- **Errores chicos del dominio que quedan en la evaluación** (no tienen ficha propia):
  - En las misiones, dos huecos que comparten opciones cuentan las mismas copias dos veces (`catalog/missions.ts:98-107`).
  - El consejo «canjear» revisa cada carta sola contra los puntos guardados, así que puede prometer más de lo que alcanza (`packs/recommend.ts:281-306`).
  - «Qué carta destraba» ordena por listas distintas, lo que favorece a los arquetipos con muchas variantes; debería ordenar por jugadores (`tournaments/buildable.ts:93`).

## Operación

- **Copias fuera de Supabase** ([R-006](Riesgos/R-006.md), [P-007](Preguntas/P-007.md)).
  - Las 14 copias diarias están en `backup_blobs`, en la misma base.
  - La prueba mensual (Fase 35) comprueba la cadena entera, pero no cubre perder el proyecto de Supabase.
  - Propuesta: un token con alcance `backup:read`, con el que el worker de la PC baja la copia del día a una carpeta sincronizada.
  - Y una guía de reconstrucción desde cero: migraciones, `owner:init`, catálogo al `catalogCommit` de la copia, tokens nuevos, conector de Claude, worker y backfill de Limitless.
- **Retención** ([R-006](Riesgos/R-006.md)).
  - Las repeticiones y los crudos de Limitless están dentro de Postgres (`schema.prisma`, DECISIONES 6.9), aunque la mitigación de R-006 decía lo contrario.
  - Estimado: 150–200 MB por año solo en torneos.
  - Propuesta: borrar los crudos y rondas de más de 2 eras y las repeticiones de más de 90 días (salvo las marcadas), y avisar por el tamaño de la base.
- **Fallas que nadie ve** ([R-011](Riesgos/R-011.md)). Avisos que hoy no existen:
  - la copia tiene más de 26 h;
  - la última corrida de Limitless falló o tiene más de 13 h;
  - hay trabajos en cola y ningún worker en 30 min;
  - la base pasa de 350 MB;
  - falló la sincronización del catálogo.

  Además, un chequeo externo gratis contra `/healthz`: si el servidor se cae, el aviso al celu tampoco sale.
- **Versión visible.**
  - `/healthz` y «Acerca de» dicen `0.0.0`. `APP_VERSION` existe en `config/env.ts`, pero nadie lo carga.
  - Propuesta: desplegar con el sha del commit y, al terminar, esperar a que `/healthz` lo informe.
  - Las migraciones corren al arrancar (`docker/entrypoint.sh`); si una falla, la única máquina queda reiniciándose. Conviene pasarlas a `release_command`.
- **Memoria** ([R-008](Riesgos/R-008.md)).
  - Nunca se midió.
  - El armado del dataset de torneos no comparte la construcción entre pedidos simultáneos, y la sincronización invalida la caché dos veces por torneo.
  - La caché de situaciones no tiene límite.
  - Propuesta: swap de 512 MB, `--max-old-space-size`, un solo armado a la vez y registrar la memoria después de cada armado.
- **Chequeos de GitHub sin token.**
  - El chequeo de set nuevo y el de motor nuevo salen desde las IP compartidas de Fly, con un límite de 60 pedidos por hora por IP.
  - Si GitHub devuelve 403, el aviso nunca aparece.
  - Propuesta: un `GITHUB_TOKEN` opcional.
- **Seguridad.**
  - No hay lista de sesiones abiertas ni forma de cerrarlas.
  - El freno de intentos de login vive en memoria y se reinicia con cada deploy.
  - Un login nuevo no avisa.
  - El conector de escritura lee texto de terceros ([R-010](Riesgos/R-010.md)).
- **CI.**
  - No arma la imagen de Docker.
  - El workflow no declara `permissions:`.
  - No hay Dependabot.

## Interfaz

- **Carga rápida.**
  - «Guardar partida» queda abajo de todo, y más ahora con «Para hoy».
  - Los chips de rival y modalidad miden 36 px.
  - Propuesta:
    - una barra fija con «Guardar», como en el editor de mazos;
    - chips de 44 px;
    - modalidad y nota en una sola fila;
    - en el manifiesto, un atajo «Cargar partida» al mantener apretado el ícono.
- **Rutas.**
  - Todo está en un solo archivo de 1,1 MB (318 kB comprimido), porque ninguna ruta se carga cuando se la necesita.
  - Falta `errorElement`: un error de pantalla muestra la página de react-router, en inglés.
  - Falta `ScrollRestoration`: «atrás» no vuelve a la posición de la lista.
- **Ficha del mazo.**
  - Tiene 12 secciones y hace unos 10 pedidos al abrirse. «Completitud» va décima.
  - «Cambios» muestra identificadores crudos (`builtInGame: false → true`).
  - Propuesta: Cartas y Falta primero, el resto plegado y pedido recién al abrirlo, y los campos traducidos.
- **Enlaces que faltan:**
  - del mazo a su arquetipo, y del arquetipo a mis mazos y mi récord;
  - de la carta a qué sobre la da, su costo en puntos y si se intercambia (la API ya manda `pack`);
  - de una fila de «por rival» al historial filtrado;
  - los filtros de estadísticas, guardados en la URL;
  - «Editar nota», que hoy pierde el formulario a medio llenar.
- **Navegación.**
  - «Más» es una lista plana de 13 entradas.
  - Propuesta: agruparla en Analizar, Jugar, Herramientas y Cuenta y datos.
  - La barra inferior no marca ninguna pestaña en `/simulacion`, `/laboratorio`, `/jugar` ni `/eventos`.
- **CSV.**
  - Ningún aviso dice «el último CSV es de hace N días», y el brief arranca justamente de ese problema.
  - Hoy hacen falta dos toques para subirlo; podría subirse al elegir el archivo.
  - El diff no dice qué mazos se completan.
  - Falta `share_target` en el manifiesto, para compartir el CSV o el texto de un mazo directo a la app.
- **Detalles.**
  - Contraste bajo en modo oscuro: el blanco sobre verde y rojo da unos 2,5:1.
  - Las miniaturas nunca entran en la caché (respuestas opacas).
  - Un 401 da de baja el service worker y, con él, las notificaciones.
  - Exportar un mazo además descarga un archivo.
  - `apps/web/README.md` está desactualizado.
  - Algunos enums del cliente están cerrados ([H-008](Hallazgos/H-008.md)).

## Simulación y worker

- **Rendimiento real lejos del estimado.**
  - En producción, la #9 tardó 1 h 47 min contra unos 12 min estimados, y la #8 106 s contra 37 s.
  - Cada worker toma un chunk por vez y cada ronda del laboratorio espera al último.
  - Propuesta:
    - medir el tiempo entre el claim y el resultado contra la duración del motor;
    - después, dos lugares por worker o pedir el siguiente chunk por adelantado;
    - repetir los últimos chunks en workers libres (el servidor ya ignora un segundo resultado).
- **Partidas que se reutilicen.**
  - Hoy cada trabajo arranca con una semilla nueva.
  - Propuestas:
    - un registro por (lista A, lista B, bots, motor) que solo juegue las partidas que faltan;
    - partidas por rival según su peso en el puntaje (hoy un rival del 2 % cuesta lo mismo que uno del 15 %);
    - cortar antes una comparación cuyo intervalo ya alcanza.
- **Dependencia del bot** ([R-012](Riesgos/R-012.md)). Propuestas:
  - jugar la confirmación también con e3 y marcar cada resultado «robusto» o «sensible al bot»;
  - un informe de calibración: matriz de los 15 del banco contra los matchups de torneo, cruce por cruce y siempre lado a lado.
- **Motor nuevo.** Reencolar en el motor nuevo los trabajos del viejo, con las mismas semillas. Hoy quedan esperando, y las partidas en curso también.
- **Worker que se actualiza solo.** La respuesta del claim avisaría que hay versión nueva; el worker baja el paquete de la CI, verifica la firma y se reinicia después del chunk.
- **Jugar sin la PC** ([P-008](Preguntas/P-008.md)). deckgym `33ff2a5` compila sin cambios a WebAssembly. Medido en Node:

  | Bot contra bot | WebAssembly | Nativo |
  |---|---|---|
  | e2 | 83 ms por partida | 66 ms |
  | e3 | 316 ms por partida | 282 ms |

  - Pesa 1,1 MB comprimido.
  - La misma semilla no da la misma partida que en la PC, así que una partida empezada en el navegador se juega y se deshace ahí.
  - Repartir los motores es AGPL: hay que ofrecer el código, como ya se hace con `/viewer/`.

## Claude (MCP)

- **Tools que faltan, de más a menos útil:**
  - editar la colección («saqué 2 Hoopa ex»);
  - cancelar o archivar una simulación (hoy Claude puede lanzar una búsqueda de 1 h y no frenarla);
  - `dryRun` y un tope de tamaño en `simulations_enqueue`;
  - estado de los workers con la hora estimada de fin;
  - los avisos;
  - la consistencia;
  - crear o editar eventos;
  - los ajustes de sobres;
  - la fecha de los datos de torneo.
- **Costo de las respuestas.**
  - `decks_get` ocupa unos 1.800 tokens: repite las 20 cartas tres veces, más notas fijas en cada llamada.
  - `matches_list` corta en 50, sin desplazamiento ni rango de fechas.
- **Sin prompts ni recursos MCP.** Por ejemplo, un «repaso semanal» que encadene `week_summary`, `matches_luck`, `tournaments_trends` y `packs_recommend`.
- **Errores internos sin id de pedido** (`mcp-tools.service.ts:241`).
- **Auditoría de escrituras** y borrado suave de partidas ([R-010](Riesgos/R-010.md)).
- **Si sacan el encabezado fijo** ([R-002](Riesgos/R-002.md)): un OAuth 2.1 propio y mínimo, que reutiliza contraseña + TOTP, evita sumar a Descope.

## Análisis nuevos con datos que ya están

| Análisis | Con qué | Esfuerzo |
|---|---|---|
| Tabla de techs por arquetipo: cada carta jugada por el 10–90 %, con y sin, y el intervalo de la diferencia (remuestreo por lista) | `cardUsage`, `withWithout` | S |
| Núcleo y cartas libres: lo que juega el ≥ 90 % y el rendimiento con 1 contra 2 copias | ídem | S |
| Conversión al top: cuota de listas en el top contra cuota del campo, con intervalo | `placing`, `players`, `phases` | S |
| Porcentaje ajustado por la moneda: ½ empezando + ½ segundo, por mazo | mis partidas | S |
| «Mi meta»: cuota de rivales de mis partidas, con más peso a lo reciente, como pesos opcionales del esperado contra el meta, el banco y «¿Cuál llevo hoy?» | mis partidas | S |
| Probabilidad de la Zona de Energía en mazos de 2–3 tipos, turno por turno | cuenta exacta | S |
| Robo con cartas que buscan (Poké Ball, Investigación de Profesores, Comunicación Pokémon) en la mano inicial | Monte Carlo con semilla en el dominio | M |
| Misiones como tercer objetivo de Sobres (el tracker ya lo calcula) | `catalog_syncs.missions` | S |
| Qué mazo armar después: listas de torneo cercanas a la colección, por rendimiento y costo | `buildable` y `closest` | S |
| Fuerza del jugador: modelo de jugador + arquetipo sobre las rondas de Limitless | `tournament_pairings` | M–L |

## Ideas abiertas

Son para decidir; no tienen ficha.

- **Código QR del juego.** `KevinGutowski/tcgp-deck-qr`, MIT. Quedó «para más adelante» en PLAN §3.
- **Seguir el rango de la modalidad Competitiva**, partida a partida, si a Santiago le sirve.
- **Torneos en la barra inferior** en lugar de Sobres.
- **Pantallas de consulta sin señal**, con la última copia de los datos.

## Lo que está bien y conviene no tocar

- **Carga rápida.** Botones grandes, mazo y modalidad que se mantienen, «Deshacer» de 10 s y `?mazo=`.
- **Estados de pantalla.** Los de carga, vacío y error están en todas.
- **Borrados.** Las acciones destructivas piden confirmación.
- **Porcentajes.** Todos llevan n e intervalo.
- **Mesa y repeticiones.** Son accesibles, con etiquetas y teclado.
- **Seguridad.**
  - La cookie `__Host-` es HttpOnly, Secure y SameSite=Lax.
  - Hay control de origen en las escrituras, CSP y HSTS.
  - Las contraseñas usan argon2id y el TOTP no se puede reusar.
  - Los tokens se guardan con hash, y la importación de backups tiene límite de tamaño.
- **Simulaciones.** Son reproducibles con la misma semilla ([R-003](Riesgos/R-003.md)).
- **Respuestas para Claude.** Son compactas, con ids estables y el `text` canónico.

## Verificación del 09/10

Una segunda revisión (cuatro verificaciones en paralelo, en el código de `0524489`) contrastó cada hallazgo y cada afirmación concreta. El detalle está en la nota «Verificación del 09/10» de cada ficha. En resumen:

- **Confirmados:** H-003, H-004 (peor de lo escrito: bajar el commit borra copias y cartas de mazos), H-006, H-007, H-009, H-010 (peor: la confirmación no se usa como filtro) y H-013.
- **Parcialmente correctos:** H-002 (con la 0.2.10 solo se frena el entrenador), H-005 (el sesgo existe, pero el número es ~6,5 veces más chico), H-008 (la parte de la app no puede pasar; severidad baja), H-011, H-012 (el número principal es la mediana y casi no cambia), H-014 y H-015.
- **Arreglos propuestos que hay que corregir:** H-002 (no castear la versión en SQL), H-003 (`this` dentro de `done`), H-013 (hace falta un estado «estacionada»), H-015 (excluir los eventos del servidor de la compresión).
- **Otros puntos:** las misiones que cuentan dos veces son un error latente (ninguna de las 443 misiones comparte opciones); ordenar «qué carta destraba» por listas es lo que piden BRIEF M5 y DECISIONES 5.9, no un error; el chequeo de set nuevo no está bajo el límite de GitHub (solo el del motor).

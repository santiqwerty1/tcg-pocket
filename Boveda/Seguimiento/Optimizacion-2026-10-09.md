---
tipo: documento
titulo: >-
  Optimización de mazos: qué más se puede hacer (09/10/2026)
area: proyecto
estado: vigente
actualizado: '2026-10-09'
origen:
  - pedido de Santiago (09/10/2026) «Fíjate qué más podemos hacer para mejorar la optimización de mazos, anotá todo en la bóveda y commiteá»
  - dos revisiones del código en paralelo (algoritmo de búsqueda; motor y bots de deckgym @ 33ff2a5), con corridas cortas del motor
  - datos de producción leídos por MCP el 09/10/2026 (búsquedas #5, #7, #9 y #11; pruebas #6, #8 y #12)
revisar: false
---

# Optimización de mazos: qué más se puede hacer (09/10/2026)

> [!info] Es una propuesta
> Lo que ya estaba aprobado en [T-014](Tareas/T-014.md) lo hace la sesión «Selección de cartas en simulación», según el reparto de [D-021](Decisiones/D-021.md). Eso es la parte del laboratorio de la fase 37 ([H-010](Hallazgos/H-010.md)) y la fase 42 completa. Lo nuevo está en [T-017](Tareas/T-017.md) y espera la respuesta de Santiago en [P-009](Preguntas/P-009.md). Las variantes fijas siguen en [T-016](Tareas/T-016.md), «para luego».

## Resumen

- **El bot es el problema más grande** ([H-018](Hallazgos/H-018.md)). e2 no evoluciona a un Pokémon cuyos ataques no hacen daño fijo, como Ivysaur, que tiene solo Síntesis. El mazo 40 da 2,2 % con bots y 38,9 % con gente. El laboratorio optimiza contra ese punto ciego.
- **La búsqueda corre a un décimo de su velocidad con la configuración por defecto.** Con 60 partidas por cruce saca ~10 partidas/s; con 500 por cruce, ~95. Parte del costo es medio segundo perdido por cada corrida del motor ([H-019](Hallazgos/H-019.md)).
- **Las semillas comunes, en las que se apoya la comparación, casi no sirven.** Las variantes reordenan la lista y el motor mezcla por posición ([H-020](Hallazgos/H-020.md)). Además, la búsqueda no se puede reproducir ([H-021](Hallazgos/H-021.md)).
- **La búsqueda es codiciosa y prueba poco.** En la #11 aceptó +Gible (21 %) en la ronda 0 y no vuelve atrás, aunque +1 Bulbasaur da 27,1 % (#12). Con 8 a 12 variantes por ronda ve unas 96 de los 5.800 a 8.100 cambios de una carta posibles.
- **Funciona contra el bot, pero hay que medir mejor.** La búsqueda subió el mazo 1 de 58,2 % a 63,4 % y el mazo 20 de 60,5 % a 66,2 % (confirmación, n = 1.500 cada uno). Con el corte actual, cambios de 1 a 3 puntos no se distinguen del azar.

## Qué dicen los datos de producción

Todos son bots e2 contra e2, contra el banco del meta de 15 arquetipos de la era B4a. No se combinan con torneos ni con partidas propias.

| Trabajo | Partidas por cruce | Partidas | Duración | Partidas/s | Resultado |
|---|---|---|---|---|---|
| #5 búsqueda, mazo 1 Butterfree / Mega-Sceptile ex | 60 | 59.700 | 92 min | ~10,8 | 58,2 % → 63,4 % (confirmación, n = 1.500 c/u; IC 55,5–60,9 % y 60,8–66,1 %) |
| #7 búsqueda, mazo 21 Cachorros (todas las cartas) | 60 | 24.300 | 105 min (junto con la #5) | ~3,9 | sin mejora en 3 rondas |
| #9 búsqueda, mazo 20 Mega-Steelix ex | 60 | 59.700 | 107 min | ~9,3 | 60,5 % → 66,2 % (confirmación, n = 1.500 c/u; IC 57,9–63,0 % y 63,7–68,7 %) |
| #11 búsqueda, mazo 40 Mega-Venusaur ex | 500 | ~147.000 a los ~25 min | sigue | ~95 | ronda 0: +Gible −Casco Pesado, 21 % (n = 15.000, IC 20,2–21,7 %) |
| #12 prueba, mazo 40 con 2 Bulbasaur | 500 | 7.500 | 84 s | ~89 | 27,1 % (n = 7.500, IC 26,0–28,2 %) |

- **Bot contra gente.** La lista de partida del mazo 40 da 2,2 % contra el meta (n = 7.500, IC 1,7–2,6 %). En torneos, el arquetipo Mega Venusaur ex da 38,9 % (n = 247 en 47 listas, IC 33,0–45,1 %), y 39 de esas 47 listas juegan un solo Bulbasaur.
- **Ruido.** La misma lista de partida de la #5 dio 52,6 % en la búsqueda (n = 900, IC 49,1–56,1 %) y 58,2 % en la confirmación (n = 1.500, IC 55,5–60,9 %). Son 5,6 puntos entre dos medidas de lo mismo.
- **Empates.** Contra Dedenne ex Indeedee ex, el mazo 20 empató 36 y 45 de cada 100 partidas (#9), por el límite de 30 turnos del motor. Hoy un empate cuenta como no victoria.

## Hallazgos nuevos

| Ficha | Qué | Severidad | Esfuerzo |
|---|---|---|---|
| [H-018](Hallazgos/H-018.md) | El bot e2 no evoluciona a Pokémon sin ataque de daño fijo, por la función de valor de deckgym. | alta | M |
| [H-019](Hallazgos/H-019.md) | engine-cli pierde ~0,5 s por corrida, y los chunks chicos hunden la velocidad del laboratorio. | media | S |
| [H-020](Hallazgos/H-020.md) | Las semillas comunes casi no sirven: las variantes reordenan la lista, y «Probar contra el meta» no usa semilla por rival. | media | S |
| [H-021](Hallazgos/H-021.md) | La búsqueda no se puede reproducir: la vista previa usa otra semilla y los datos cambian entre rondas. | baja | S |

## Propuestas

Dónde va cada una: **42** y **H-010** ya están aprobadas ([T-014](Tareas/T-014.md)); **T-016** es «para luego»; **T-017** es nueva y espera [P-009](Preguntas/P-009.md).

### A. Que el bot juegue como una persona

| # | Propuesta | Beneficio | Esfuerzo | Dónde |
|---|---|---|---|---|
| A1 | **Bot corregido** (código nuevo, por ejemplo `e2f`), armado en engine-cli sin tocar deckgym-core: los campos de `ExpectiMiniMaxPlayer` y `ValueFunctionParams` son públicos. Lleva un reloj propio que mira las evoluciones (`get_highest_evolutions`) y el daño variable. Primero se compara contra e2 en el banco del meta y contra los torneos, y si se parece más a la realidad pasa a ser el bot por defecto del laboratorio, la consistencia y el entrenador. Cada resultado queda con su bot. El error se reporta a deckgym. | muy alto | M | T-017 |
| A2 | **Más datos por partida** en `simulate`: victorias empezando y yendo segundo; por qué perdió cada lado (puntos, sin Pokémon en juego, empate a los 30 turnos); turno medio; etapa máxima a la que llegó. El estado final ya está a mano (`engine/src/main.rs:244-249`) y el worker ya pasa un campo `extra`. Con eso el diagnóstico del mazo 40 sale solo («96 % de las derrotas: sin Pokémon, nunca evolucionó»). Opcional: que cada lado empiece la mitad de las veces. | alto | S en el motor, M con API y pantallas | T-017 (sirve a la calibración de la 42) |
| A3 | **Puntos ciegos por carta.** Que `engine-cli status` marque las cartas que el bot juega mal o el motor aproxima: daño variable, una etapa sin daño, y aproximaciones conocidas. Hay cuatro: las búsquedas ven el orden del mazo (`apply_trainer_action.rs:1519`); «descartá una Energía al azar» descarta siempre la última; Tabla Mítica mira «es Básico» en vez de «Pokémon Psíquico»; el segundo jugador ve el Activo del primero antes de poner el suyo. Las variantes que las usen llevan «sensible al bot». | medio | S | T-017 |
| A4 | Confirmación con e3 e informe de calibración contra torneos ([R-012](Riesgos/R-012.md)). Sumar al informe el contraste por arquetipo: puntaje del laboratorio contra el % de torneo del arquetipo. | alto | M | 42 |

### B. Más rápido

| # | Propuesta | Beneficio | Esfuerzo | Dónde |
|---|---|---|---|---|
| B1 | Arreglar el hilo de progreso de engine-cli ([H-019](Hallazgos/H-019.md)): `recv_timeout` o `park_timeout` en vez de `sleep(500)`. | alto en chunks chicos | S | 42 |
| B2 | Menos costo fijo por chunk: chunks con varios cruces (todos los rivales de una lista en un proceso) o un mínimo de partidas por chunk, y dos lugares por worker. Evidencia: ~10 partidas/s con 60 por cruce contra ~95 con 500. | muy alto | M | 42 |
| B3 | Que la matriz no se meta entre rondas de una búsqueda: entre ronda y ronda el worker toma un chunk de la matriz #4, que tarda de 2 s a 9 min. Opciones: preparar la ronda siguiente antes de que termine la actual, o no darle chunks de matriz a un worker mientras una búsqueda espera su próxima ronda. | medio | S–M | 42 |
| B4 | Carreras dentro de la ronda y partidas por rival según su peso. Ya están en la 42. | alto | M | 42 |

### C. Qué variantes se prueban

| # | Propuesta | Beneficio | Esfuerzo | Dónde |
|---|---|---|---|---|
| C1 | **Variantes fijas** en cada ronda: +1 copia de lo que ya tiene y el paso hacia la lista de torneo más cercana. | alto | S | T-016 |
| C2 | **Cada carta en su lugar** ([H-020](Hallazgos/H-020.md)): una variante reemplaza el lugar de la carta que sale. La razón de varianzas baja de 0,51–0,64 a 0,28–0,30, cerca de 1,8 veces menos partidas para la misma precisión. Solo rinde junto con la prueba apareada de H-010. | alto | S | H-010 |
| C3 | **Ronda «carta más floja»**: antes de buscar, cambiar una copia de cada grupo por un relleno fijo en su lugar y sacar después del tercio más flojo. Hoy lo que sale es un sorteo: en el mazo 2 todo tiene ≥ 80 % de afinidad, la protección del núcleo no hace nada y Torchic, su única línea de Básicos, salió en 17 de 96 variantes. | alto | M | T-017 |
| C4 | **Aprender por carta entre rondas**: estimar el efecto de cada «+carta» y «−carta» con las diferencias apareadas, usarlo para pesar el sorteo (Thompson) y proponer cada ronda una variante que junte los dos mejores cambios. Hoy Helio aparece en 17 a 23 de cada 96 variantes, gane o pierda. | alto | M | T-017 |
| C5 | **No quedarse con el primer cambio**: cada tanto, probar sacar un cambio ya aceptado, o seguir 2 o 3 listas a la vez. Caso: #11 con Gible, cuando 2 Bulbasaur rinde más. | medio | M | T-017 |
| C6 | **Variantes de Energía**: como mucho una por ronda (sacar un tipo o sumar uno), dentro del tope de 3 ([P-006](Preguntas/P-006.md)). Sirve para los mazos 9, 10, 11, 30 y 32. | medio | S–M | T-017 |
| C7 | Dos cambios por variante solo cuando van juntos (una línea evolutiva, o la combinación de C4). Hoy el 25–32 % de las variantes cambia dos cartas al azar. | medio | S | T-017 |
| C8 | **«Optimizar» con semillas comunes**: hoy cada combinación tiene sus semillas (`engine/src/main.rs:565-569`). Después, usarlo dentro del laboratorio para llenar a fondo los 1 o 2 lugares más flojos con las N mejores candidatas, ponderado por el meta y confirmando las 3 primeras. | medio | S + M | 42 (semillas) y T-017 |

### D. Cuándo se acepta una variante

| # | Propuesta | Beneficio | Esfuerzo | Dónde |
|---|---|---|---|---|
| D1 | Prueba apareada; volver a probar con semillas nuevas antes de aceptar; la confirmación como filtro, con 200–300 partidas por rival ([H-010](Hallazgos/H-010.md)). Números: con este banco (Σw² = 0,087, unos 11,4 rivales de información) el error de un puntaje es 1,9 puntos a 60 partidas por rival. Lo mínimo que se detecta con 80 % de potencia es 6,7 puntos en una ronda y 5,2 en la confirmación; con la prueba apareada y las cartas en su lugar, 3,7 y 2,8. Si ninguna variante es mejor, la regla actual igual acepta una en el 50 % de las rondas, y en el 62–67 % cuando la vigente ya junta 3 a 6 rondas. | muy alto | M | H-010 |
| D2 | **«Frenar y confirmar»**: hoy cancelar tira la búsqueda (no confirma y `deckScores` ignora las canceladas). Un botón que frene y encole la confirmación. | medio | S | T-017 |
| D3 | **Más de una lista por arquetipo** en el banco: dos listas para los 3 a 5 primeros con el peso repartido, o un chequeo final contra las listas siguientes. Hoy se premian techs contra una lista puntual. | medio | M | T-017 |
| D4 | **Objetivo a elección**: el meta de torneo (hoy), «mi meta» (los rivales de mis partidas, como la fase 44) o un rival puntual. | medio | S–M | T-017 |

### E. Entender y dirigir la búsqueda

| # | Propuesta | Beneficio | Esfuerzo | Dónde |
|---|---|---|---|---|
| E1 | Por cada ronda, mostrar la diferencia de cada candidata contra la vigente, con intervalo, y por qué se propuso cada carta (uso en la era y en el arquetipo). | alto | S–M | T-017 |
| E2 | Marcar «te falta» en las cartas que no tiene y listar las de su arquetipo que quedaron afuera por no tenerlas, con «incluir». Casos: Erika y Capa Hoja en el mazo 40; Weezing del Team Rocket ex en el 7. | alto | S | T-017 |
| E3 | «Probar estas cartas» (lo opuesto a bloquear), y bloqueos también para listas pegadas y de torneo (hoy solo para mazos guardados). | medio | S | T-017 |
| E4 | Arrancar una búsqueda desde la mejor de una prueba, o sumar una lista a una búsqueda en curso. Por ejemplo, la de 2 Bulbasaur de la #12 a la #11. | medio | S | T-017 |
| E5 | Reproducible ([H-021](Hallazgos/H-021.md)): la semilla de la vista previa es la de la búsqueda, y el uso, la afinidad y el pool se congelan al empezar. | medio | S | 42 |

## Orden propuesto

1. **Ya aprobado** (carril de «Selección de cartas en simulación», [D-021](Decisiones/D-021.md)): B1 y B2 primero, porque multiplican todo lo demás; después C2 + D1 ([H-010](Hallazgos/H-010.md), [H-020](Hallazgos/H-020.md)), E5 ([H-021](Hallazgos/H-021.md)) y el resto de la 42 (B3, B4, A4, C8 en sus semillas).
2. **Espera el visto bueno** ([P-009](Preguntas/P-009.md)), en este orden: A1 y A2 (el bot y los datos por partida), C1 ([T-016](Tareas/T-016.md)), C3 + C4, E1 + E2, D2, C5, C6, C7, D3, D4, A3, E3 y E4.

## Lo que no es problema

- Entre el 84 % y el 92 % de las variantes salen válidas al primer intento: las inválidas no gastan tiempo.
- La validación ya impide sacar el último Básico o cortar una línea evolutiva. El colapso del mazo 40 viene del bot ([H-018](Hallazgos/H-018.md)), no de las variantes.
- El motor no tiene mulligans y garantiza un Básico en la mano inicial, como el juego. Quién empieza es una moneda.
- El `optimize` de deckgym es peor que el nuestro (repite la misma semilla en todas las partidas): no hay nada para copiar. Su búsqueda por mitades sucesivas (`examples/value_function_grid_search.rs`) sirve para afinar el bot de A1.

## Fuentes

- Código: `packages/domain/src/lab/*`, `apps/api/src/lab/lab.service.ts`, `apps/api/src/simulation/*`, `apps/web/src/pages/laboratorio/*`, `engine/src/*` y deckgym @ 33ff2a5 (`src/players/*`, `src/state/*`, `src/actions/*`).
- Corridas cortas del motor e2 contra e2 (unos 15 s de CPU para el bot, y 400–600 partidas por corrida para las semillas). Pool y variantes medidos con la colección real y el dataset de PMPT #45, en 10 mazos de Santiago.
- Producción, por MCP: `lab_results` de #5, #7, #9, #11 y #12, `simulations_results` y `tournaments_stats` de Mega Venusaur ex (B4a).

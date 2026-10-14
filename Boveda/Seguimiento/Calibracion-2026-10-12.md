---
tipo: documento
titulo: >-
  Calibración de los bots contra torneos: qué bot conviene por defecto (12/10/2026)
area: datos
estado: vigente
actualizado: '2026-10-14'
origen:
  - pedido del Coordinador del 12/10/2026 (P-009 punto 2, R-012)
  - calibraciones de B4a en producción, #21 a #35, leídas con la tool simulations_calibration (#77) el 13/10/2026
  - velocidad leída de los chunks de esas calibraciones, con un SELECT de solo lectura en producción
  - e4 (#31) y, para compararlo, e2 y e3 contra los mismos torneos, leídos con simulations_calibration el 14/10/2026; velocidades de #29 a #31 medidas por el Coordinador el 14/10 con la misma consulta
revisar: false
---

# Calibración de los bots contra torneos: qué bot conviene por defecto (12/10/2026)

> [!info] Decidido por Santiago el 13/10/2026 ([D-029](Decisiones/D-029.md))
> Santiago respondió en [P-009](Preguntas/P-009.md) que el bot corregido pasa a ser el de por defecto (laboratorio, consistencia y entrenador) si la comparación con e2 y con los torneos lo confirma. Este informe es esa comparación, y la condición **no se cumple**. Santiago decidió el 13/10 que e2 sigue por defecto, por ahora, y que se repita la comparación con un banco más grande cuando terminen e4 y MCTS. Las matrices y búsquedas viejas siguen con su bot.

## Resumen

- **f2 no se acerca más a los torneos que e2, y cuesta más.**
  - El orden de los pares da ρ = 0,35 con f2 y 0,37 con e2; la diferencia es −0,02 (IC −0,07 a 0,05).
  - La diferencia media con el torneo es 15,5 puntos con f2 y 14,8 con e2: +0,7 (IC −0,7 a 1,8).
  - Los dos bots casi coinciden entre sí: ρ = 0,98.
  - f2 juega a la mitad de velocidad que e2 en la PC.
- **Subir la profundidad apunta a mejor, pero no alcanza para afirmarlo.**
  - e3 da ρ = 0,48 contra 0,37 de e2: +0,11 (IC −0,07 a 0,37).
  - La diferencia media baja 2,4 puntos (IC −6,8 a 1,4).
  - e3 cuesta 4,6 veces lo de e2. f3 y f4 quedan parecidos a e3 (ρ = 0,42 y 0,45).
- **e4 (14/10) sigue la misma línea, y tampoco alcanza para afirmarlo** ([Con e4](#Con%20e4)).
  - ρ = 0,51 contra 0,37 de e2 (Δ +0,14, IC −0,08 a 0,40) y 0,48 de e3 (Δ +0,03, IC −0,06 a 0,11).
  - La diferencia media con el torneo es 11,6 puntos: 3,2 menos que e2 (IC −8,3 a 1,0).
  - Cuesta unas 11 veces lo de e2. No cambia la recomendación.
- **Todos los bots exageran las diferencias** ([R-012](Riesgos/R-012.md)). Lo que se mueve el torneo es más o menos un cuarto de lo que dice e2. Por eso «50 % en todos los pares» queda a 10,4 puntos del torneo en promedio, más cerca que cualquier bot. En los 44 pares que el torneo inclina con claridad (su IC no contiene el 50 %), e2 acierta el lado en 30 y e3 en 35. Pero ninguno acierta por cuánto.
- **Decisión de Santiago (13/10, [D-029](Decisiones/D-029.md)):** e2 sigue de bot por defecto; f2 y e3, como opciones y como confirmación. Se repite la comparación con un banco más grande cuando terminen e4 y MCTS (ver [Decisión](#Decisión)).

## Qué se comparó

El mismo banco del meta de B4a (18 listas de 15 arquetipos, 153 cruces, 2.000 partidas por cruce: 306.000 partidas por bot) jugado contra sí mismo por cada bot, en las calibraciones #21 a #35. El motor es el mismo (deckgym `33ff2a5`).

- **Cómo se compara con los torneos.** Las listas de un mismo arquetipo se juntan en un solo par, con el peso de cada lista, y cada par queda al lado de lo que hicieron los mismos arquetipos en los torneos de la era. Hay 105 pares, más 3 espejos que no se comparan.
- **Torneos:** Limitless, era B4a, 33.113 partidas de 159 torneos con rondas. Cada par tiene entre 21 y 405 partidas de torneo (mediana 82). Los 105 pasan el mínimo de 20.
- **Todo por partida y sin empates**, como en el informe de la pantalla. Los empates del motor salen del límite de turnos y se cuentan aparte.

| # | Bot | Estado |
|---|---|---|
| 21 | r (al azar) | terminada |
| 22 | w (al azar ponderado) | terminada |
| 23 | aa (adjunta y ataca) | terminada |
| 24 | et (termina el turno) | falló entera: el motor de entonces no conocía el bot ([H-051](Hallazgos/H-051.md)) |
| 25 | v (función de valor) | terminada |
| 26 | er (evoluciona primero) | terminada |
| 27 | m (MCTS) | corriendo; un cruce falla siempre por un pánico de deckgym ([H-052](Hallazgos/H-052.md)) |
| 28 | e1 | terminada |
| 29 | e2 (el de por defecto) | terminada |
| 30 | e3 | terminada |
| 31 | e4 | terminada el 14/10 |
| 32 | f1 | terminada |
| 33 | f2 | terminada |
| 34 | f3 | terminada |
| 35 | f4 | falló un cruce ([H-054](Hallazgos/H-054.md)): 104 pares; se completa con «Reintentar lo que falló» |

Simulación y torneos son fuentes separadas: cada número va con su n y su intervalo, y nunca se combinan en uno. Los números de bots son pistas, no lo que pasa en el juego.

### Cómo se midió

- **Lo que da el informe de la pantalla** (`simulations_calibration`): los pares compatibles, la diferencia media y el ρ del orden de los pares con su IC. El IC sale de un bootstrap sobre los arquetipos, con 1.000 remuestras.
- **Lo que agrega este informe**, con el mismo bootstrap sobre los arquetipos y 2.000 remuestras:
  - el IC de la diferencia media;
  - el **error propio del bot**: la raíz de la media de (simulado − torneo)², menos la varianza que explica el azar de los dos lados. Es lo que se aparta el bot más allá del ruido;
  - las comparaciones **de a pares** entre dos bots sobre los mismos 105 pares y los mismos torneos. El lado de torneo es el mismo para los dos, así que lo que cambia es solo el bot.
- **Arquetipos:** cada arquetipo contra el resto del banco, con los mismos rivales en los dos lados y pesados por su cuota en el meta.

## Velocidad

Sale de los chunks de las calibraciones (`duration_ms`, sin los copiados de la caché): partidas por segundo de cada worker con todos sus hilos, y por hilo. No es una prueba controlada. Los workers comparten la máquina con la CI y con el uso normal, y cada bot corrió en días distintos: tomarlo como orden de magnitud.

| Bot | PC: partidas/s (16 hilos) | por hilo | partidas medidas | Segundo worker de 16 hilos (0.2.7): partidas/s | Celu (4 hilos): partidas/s |
|---|---|---|---|---|---|
| e1 | 373,2 | 23,3 | 300.000 | — | 8,8 |
| e2 | 70,1 | 4,4 | 264.000 | 38,6 | 1,1 |
| e3 | 15,4 | 0,96 | 174.000 | 10,1 | — |
| e4 | 6,3 | 0,39 | 83.000 | 3,5 | 0,2 |
| f1 | 184,7 | 11,5 | 152.000 | 159,6 | 5,1 |
| f2 | 35,5 | 2,2 | 151.000 | 30,4 | 1,1 |
| f3 | 15,3 | 0,96 | 223.000 | 8,1 | 0,4 |
| f4 | 5,2 | 0,33 | 200.000 | 2,6 | 0,1 |
| m (MCTS) | 0,46 | 0,03 | 39.000 | 0,27 | — |

- **f2 contra e2.** En la PC, que jugó la mayor parte, f2 cuesta el doble que e2 (35,5 contra 70,1 partidas/s). En el segundo worker, 1,3 veces (30,4 contra 38,6). En el celu, lo mismo (1,1 y 1,1).
- **Profundidad 3.** e3 y f3 van a la misma velocidad (15,4 y 15,3 partidas/s en la PC). Subir a profundidad 3 cuesta 4,6 veces lo de e2 y 2,3 veces lo de f2.
- **Profundidad 4** cuesta unas 11 veces lo de e2 en las dos máquinas: 6,3 contra 70,1 partidas/s en la PC, y 3,5 contra 38,6 en el segundo worker. Contra e3 es 2,5 veces en la PC. La fila de e4 sale de #31 completa, medida el 14/10; las demás, del 12/10. MCTS no es usable para esto: 0,46 partidas/s.
- **En tiempo, con la PC sola**, una calibración de 21.000 partidas (15 listas × 200) tarda unos 5 minutos con e2, 10 con f2, 23 con e3 o f3 y 56 con e4.

## Contra torneos

### Bot por bot

Sobre los mismos 105 pares (104 en f4). La diferencia media y el error propio van en puntos.

| Bot | Pares compatibles | Diferencia media (IC) | Error propio del bot (IC) | Orden de los pares, ρ (IC) |
|---|---|---|---|---|
| r | 33 | 21,1 | — | 0,16 (−0,09 a 0,43) |
| w | 42 | 16,6 | — | 0,26 (−0,00 a 0,50) |
| aa | 29 | 20,5 | — | 0,21 (−0,07 a 0,46) |
| v | 36 | 19,2 | — | 0,08 (−0,21 a 0,33) |
| er | 38 | 16,1 | — | 0,23 (−0,07 a 0,52) |
| e1 | 26 | 22,9 (16,5–30,6) | 26,8 (19,8–34,0) | 0,10 (−0,24 a 0,42) |
| **e2** | **41** | **14,8 (10,9–19,7)** | **17,1 (12,3–22,1)** | **0,37 (0,08–0,58)** |
| e3 | 56 | 12,5 (9,3–16,6) | 14,0 (9,5–19,0) | 0,48 (0,21–0,69) |
| f1 | 28 | 21,6 (14,8–29,8) | 26,0 (18,0–33,6) | 0,14 (−0,20 a 0,47) |
| **f2** | **41** | **15,5 (11,4–20,7)** | **17,8 (12,6–22,9)** | **0,35 (0,09–0,57)** |
| f3 | 49 | 13,3 (9,9–17,4) | 14,8 (10,0–19,4) | 0,42 (0,15–0,65) |
| f4 | 52 de 104 | 12,6 (9,2–16,2) | 14,2 (9,6–18,6) | 0,45 (0,16–0,66) |
| «50 % en todo» (sin bot) | 61 | 10,4 | 11,1 | — |

- **Pares compatibles:** aquellos en que la diferencia, con el error de los dos lados, puede ser 0. Para «50 % en todo» se cuentan los pares cuyo IC de torneo contiene el 50 %.
- **Los bots simples** salen de la lista de calibraciones: no tienen el IC de la diferencia media ni el error propio. Profundidad 1 (e1 y f1) queda peor que «al azar ponderado» (w) y empata mucho más: 16.853 y 15.472 empates, contra 1.523 de e2.
- **«50 % en todo»** es la referencia sin bot. No ordena nada, pero queda más cerca del torneo que cualquier bot (ver [Todos los bots exageran](#Todos%20los%20bots%20exageran)).

### e2 contra f2, de a pares

Los mismos 105 pares y los mismos torneos; las diferencias son f2 menos e2, con bootstrap sobre los arquetipos.

- **Orden de los pares:** ρ 0,37 → 0,35. Diferencia −0,02 (IC −0,07 a 0,05).
- **Diferencia media con el torneo:** 14,8 → 15,5 puntos. Diferencia +0,7 (IC −0,7 a 1,8).
- **Error propio:** 17,1 → 17,8 puntos. Diferencia +0,7 (IC −0,8 a 1,9).
- **Quién queda más cerca:** f2 en 38 de 105 pares, y en 7 de 15 arquetipos contra el banco. En promedio, f2 queda 0,4 puntos más lejos (IC −0,6 a 1,4).
- **Entre ellos:** el orden de los dos bots coincide casi del todo, ρ = 0,98 (IC 0,95–0,99).

**Conclusión.** En el banco de B4a, f2 juega como e2. Lo que corrige f ([H-018](Hallazgos/H-018.md): e2 no evoluciona a un Pokémon sin ataque de daño fijo) casi no mueve los cruces de los arquetipos más jugados. Sí importa en mazos con ese punto ciego, como el mazo 40.

Por arquetipo, las diferencias entre los dos bots son chicas: la mayor es de 3,6 puntos. Cada arquetipo tiene entre 32.870 y 63.988 partidas simuladas, así que el IC de la diferencia entre bots es de ±0,6 a ±0,8 puntos.

- **Gana f2:**
  - Mega Manectric ex Heliolisk, de 64,2 % a 61,1 % (−3,1, IC −3,9 a −2,4). Torneo 48,4 % (n = 802, IC 44,9–51,9 %).
  - Mega Altaria ex Espeon, de 38,8 % a 41,9 % (+3,1, IC 2,4–3,7). Torneo 52,4 % (n = 2.753, IC 50,6–54,3 %).
- **Pierde f2:**
  - Suicune ex Baxcalibur, de 54,1 % a 57,7 % (+3,6, IC 2,8–4,3). Torneo 50,1 % (n = 1.663, IC 47,7–52,4 %).
  - Dragonair Mega Rayquaza ex, de 36,2 % a 33,2 % (−3,0, IC −3,7 a −2,3). Torneo 50 % (n = 1.282, IC 47,2–52,8 %).

### Profundidad

| De a pares | Orden de los pares, Δρ (IC) | Diferencia media, Δ puntos (IC) | Más cerca en |
|---|---|---|---|
| e2 → e3 | +0,11 (−0,07 a 0,37) | −2,4 (−6,8 a 1,4) | 63 de 105 pares; 10 de 15 arquetipos |
| f2 → f3 | +0,08 (−0,12 a 0,33) | −2,2 (−6,8 a 1,4) | 62 de 105 pares; 10 de 15 arquetipos |
| f2 → f4 (104 pares) | +0,09 (−0,14 a 0,35) | −2,9 (−7,8 a 0,9) | 62 de 104 pares; 11 de 15 arquetipos |
| e1 → e2 | +0,27 (−0,09 a 0,68) | −8,0 (−17,0 a −0,6) | 69 de 105 pares; 9 de 15 arquetipos |
| e3 → f3 | −0,06 (−0,13 a 0,02) | +0,8 (−0,4 a 2,1) | 42 de 105 pares; 4 de 15 arquetipos |

- **De 1 a 2 la mejora es clara:** la diferencia media baja 8 puntos, con un IC que no llega a 0.
- **De 2 a 3 la dirección se repite** con e y con f, y con f4, pero ningún intervalo excluye el 0. Con un banco de 15 arquetipos no alcanza para afirmarlo.
- **La mejora no es pareja.** Dedenne ex Indeedee ex da 50,3 % en torneos (n = 933, IC 47,1–53,4 %), y pasa de 28,2 % con e2 (n = 32.870, IC 27,7–28,7 %) a 46,5 % con e3 (n = 33.726, IC 46,0–47,1 %). Dragonair Mega Rayquaza ex da 50 % en torneos (n = 1.282, IC 47,2–52,8 %), y empeora de 36,2 % con e2 (n = 33.983, IC 35,7–36,8 %) a 26,5 % con e3 (n = 33.990, IC 26,0–27,0 %).
- **Entre e3 y f3 gana e3** por poco: f3 queda 0,7 puntos más lejos por arquetipo (IC 0,2–1,2).

### Con e4

e4 (expectiminimax de profundidad 4, #31) terminó el 14/10. Para compararlo de a pares con e2 y e3, los tres informes se leyeron juntos ese día, así que los tres usan los mismos torneos. Desde el 13/10 los torneos crecieron: ahora son 33.667 partidas de 161 torneos con rondas, contra 33.113 de 159. Cada par tiene entre 21 y 417 partidas de torneo (mediana 84).

Con esos torneos, los números de e2 y e3 se mueven como mucho 0,1. La excepción son los pares compatibles de e3: 57, antes 56. El método y los scripts son los mismos del resto del informe.

| Bot | Pares compatibles | Diferencia media (IC) | Error propio del bot (IC) | Orden de los pares, ρ (IC) | Mismo lado del 50 % que el torneo | En los pares que el torneo inclina con claridad |
|---|---|---|---|---|---|---|
| e2 | 41 | 14,8 (10,9–19,7) | 17,1 (12,3–22,1) | 0,37 (0,10–0,59) | 62 de 105 | 27 de 41 |
| e3 | 57 | 12,5 (9,3–16,5) | 14,0 (9,4–18,9) | 0,48 (0,21–0,69) | 73 de 105 | 32 de 41 |
| **e4** | **58** | **11,6 (8,6–15,0)** | **13,1 (8,9–17,0)** | **0,51 (0,25–0,72)** | **73 de 105** | **34 de 41** |
| «50 % en todo» (sin bot) | 64 | 10,3 | 11,1 | — | — | — |

| De a pares | Orden de los pares, Δρ (IC) | Diferencia media, Δ puntos (IC) | Error propio, Δ puntos (IC) | Más cerca en | Entre los dos bots, ρ |
|---|---|---|---|---|---|
| e2 → e3 | +0,11 (−0,07 a 0,37) | −2,4 (−6,9 a 1,4) | −3,1 (−9,0 a 1,5) | 63 de 105 pares; 10 de 15 arquetipos | 0,81 |
| e2 → e4 | +0,14 (−0,08 a 0,40) | −3,2 (−8,3 a 1,0) | −4,1 (−10,2 a 0,9) | 64 de 105 pares; 10 de 15 arquetipos | 0,77 |
| e3 → e4 | +0,03 (−0,06 a 0,11) | −0,9 (−2,3 a 0,6) | −1,0 (−2,5 a 1,0) | 66 de 105 pares; 8 de 15 arquetipos | 0,97 |

- **e4 queda un poco más cerca de los torneos que e3 en todas las medidas, pero ningún intervalo excluye el 0.** Contra e2, la diferencia media baja 3,2 puntos (IC −8,3 a 1,0). Contra e3, 0,9 (IC −2,3 a 0,6). e3 y e4 casi coinciden entre sí: ρ = 0,97.
- **Cada nivel de profundidad acerca un poco al torneo, cada vez menos:**
  - el orden de los pares pasa de ρ 0,37 con e2 a 0,48 con e3 y 0,51 con e4;
  - la diferencia media, de 14,8 a 12,5 y 11,6 puntos;
  - e4 también exagera un poco menos: k = 0,41 (IC 0,18–0,72), contra 0,26 de e2 (ver [Todos los bots exageran](#Todos%20los%20bots%20exageran)).
- **Por arquetipo, de e2 a e4, la mejora sigue sin ser pareja.** Dos se acercan mucho al torneo:
  - Dedenne ex Indeedee ex: de 28,2 % (n = 32.870, IC 27,7–28,7 %) a 46,9 % (n = 33.738, IC 46,3–47,4 %). En torneos, 50,2 % (n = 959, IC 47,0–53,3 %).
  - Mega Charizard Y ex Entei ex: de 35,5 % (n = 33.756, IC 35,0–36,0 %) a 46,8 % (n = 33.628, IC 46,3–47,4 %). En torneos, 49,8 % (n = 832, IC 46,5–53,1 %).

  Y dos se alejan:
  - Magnezone Miraidon ex: de 53,1 % (n = 33.972, IC 52,5–53,6 %) a 43 % (n = 33.992, IC 42,5–43,6 %). En torneos, 51,8 % (n = 1.142, IC 49,0–54,7 %).
  - Dragonair Mega Rayquaza ex: de 36,2 % (n = 33.983, IC 35,7–36,8 %) a 29,7 % (n = 33.990, IC 29,2–30,2 %). En torneos, 50,1 % (n = 1.340, IC 47,3–52,8 %).
- **Costo:** e4 cuesta unas 11 veces lo de e2 y 2,5 veces lo de e3 (ver [Velocidad](#Velocidad)).

**Conclusión.** e4 no cambia la recomendación: e2 sigue por defecto ([D-029](Decisiones/D-029.md)). Si algún día conviene subir la profundidad, el banco de B4a apunta a e3 antes que a e4. De e3 a e4 la ganancia es chica (Δρ +0,03; −0,9 puntos) y el costo, 2,5 veces mayor. Lo confirma o no el banco más grande de D-029.

### Todos los bots exageran

Si se ajusta (torneo − 50) contra (simulado − 50), la pendiente k dice cuánto del movimiento del bot se ve en el torneo. Es un ajuste sobre los mismos pares, con IC por bootstrap de arquetipos.

| Bot | k (IC) | Distancia típica al 50 %: simulado | torneo | Diferencia media achicando a 50 + k·(simulado − 50), dejando afuera cada arquetipo |
|---|---|---|---|---|
| e1 | 0,05 (−0,10 a 0,21) | 25,7 | 12,5 | 10,5 |
| e2 | 0,26 (0,09–0,50) | 19,0 | 12,5 | 9,5 |
| e3 | 0,37 (0,15–0,69) | 16,8 | 12,5 | 9,2 |
| f2 | 0,24 (0,08–0,48) | 19,5 | 12,5 | 9,5 |
| f3 | 0,33 (0,12–0,64) | 16,9 | 12,5 | 9,4 |
| f4 | 0,35 (0,13–0,66) | 16,2 | 12,5 | 9,4 |
| e4 | 0,41 (0,18–0,72) | 15,9 | 12,5 | 9,0 |

- **La fila de e4 usa los torneos del 14/10** ([Con e4](#Con%20e4)). Con esos torneos, e2 y e3 dan 9,4 y 9,1 en la última columna.
- **Los bots suelen acertar el lado de cada par, pero exageran el tamaño.** e2 cae del mismo lado del 50 % que el torneo en 63 de 105 pares, y en 30 de los 44 que el torneo inclina con claridad; e3, en 74 y en 35. Con e2, el torneo se mueve un cuarto de lo que se mueve el bot. Sus arquetipos van de 28,2 % a 65,7 % contra el banco; en torneos, de 46,2 % a 52,4 %.
- **Achicado, e2 quedaría a 9,5 puntos del torneo y e3 a 9,2,** apenas mejor que «50 % en todo» (10,4). La «distancia típica» del torneo (12,5 puntos) incluye su propio azar: el error típico de un par de torneo es 5,5 puntos.
- **El orden de los arquetipos contra el banco no lo reproduce ningún bot:** ρ = −0,17 con e2 (IC −0,69 a 0,73) y −0,06 con e3 (IC −0,64 a 0,79). Con 15 arquetipos y los de torneo entre 46 % y 52 %, ese orden está dominado por el azar: este dato no sirve para elegir bot.
- **Por qué pueden diferir, además del bot:** el banco juega 1 o 2 listas por arquetipo y el torneo, todas las del arquetipo. También pesan la gente y cómo se adapta el meta. Las partidas de torneo se toman como independientes, así que su IC puede ser un poco angosto.

## Decisión

Lo que el informe proponía sobre el punto 2 de [P-009](Preguntas/P-009.md). Santiago lo decidió el 13/10/2026 ([D-029](Decisiones/D-029.md)). En el punto 3 pidió un banco más grande: de 25 a 30 listas, e2 y e3, y 1.000 partidas por cruce.

1. **e2 sigue de bot por defecto** del laboratorio, la consistencia y el entrenador. f2 no pasa a ser el de por defecto. En el banco de B4a no se acerca más a los torneos (Δρ −0,02, IC −0,07 a 0,05; diferencia media +0,7 puntos, IC −0,7 a 1,8) y cuesta entre 1,3 y 2 veces el tiempo de e2. f2 sigue disponible para mazos con el punto ciego de [H-018](Hallazgos/H-018.md).
2. **La profundidad por defecto no sube.** e3 apunta a mejor (Δρ +0,11, IC −0,07 a 0,37; −2,4 puntos, IC −6,8 a 1,4), pero no alcanza para afirmarlo y cuesta 4,6 veces lo de e2. Sigue como la confirmación del laboratorio («robusto / sensible al bot», #49).
3. **Repetir esta comparación** cuando termine MCTS (#27), y con el banco de la era siguiente (B4b) cuando tenga torneos con rondas. Si e3 vuelve a quedar mejor con otro banco, revisar el punto 2.
   - e4 (#31) ya está sumado, el 14/10 ([Con e4](#Con%20e4)). Apunta como e3, sin alcanzar para afirmarlo, y cuesta unas 11 veces lo de e2, así que no cambia los puntos 1 y 2.
4. **Sobre [R-012](Riesgos/R-012.md):** las diferencias que dan los bots hay que leerlas como dirección, no como tamaño. Mostrar al lado una versión achicada (k de esta calibración) es una idea para evaluar aparte, no parte de esta propuesta.

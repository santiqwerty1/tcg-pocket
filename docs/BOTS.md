# Bots del motor

Diseño del bot «g» y de cómo se mide (sesión «TCG · Bots», 14/10/2026). Es la primera de las cinco líneas que Santi
aprobó el 14/10: una evaluación mejor, sin trampa, afinar los pesos, una evaluación aprendida y la red para los pesos.
Las otras van al final, como plan.

## Para qué

- **La meta es la fuerza de juego:** ganarles a los otros bots y a sus versiones anteriores, medido con una liga. No
  hace falta que el bot juegue como una persona; puede encontrar algo que nadie vio.
- **Los torneos son una baranda, no la meta.** Sirven para ver un bot roto o un punto ciego: un mazo fuerte en los
  torneos que el bot hunde.
- **Sin trampa:** lo que el bot descubra tiene que servir en una partida real. Una estrategia que necesita ver la mano
  del rival o el orden del mazo no sirve.

## Lo que hay hoy

- **e\<N>** es el expectiminimax de deckgym (`src/players/expectiminimax_player.rs`):
  - la profundidad cuenta decisiones, no turnos (e2 mira 2);
  - la evaluación es lineal (`value_functions.rs`);
  - cuando minimiza, juega con la mano real del rival, y los robos salen del orden real del mazo.
- **f\<N>** ([H-018](../Boveda/Seguimiento/Hallazgos/H-018.md), `engine/src/fair_bot.rs`) es la misma búsqueda con un
  reloj propio, que:
  - ve las evoluciones que quedan en el mazo y la mano propios;
  - lee «N damage» del texto de los ataques sin daño fijo.

Medido el 14/10 en esta sesión: Linux, 1 hilo, 40 partidas por cruce, e2 contra e2 entre los mazos 16, 23 y 40.

| | 16 contra 23 | 40 contra 16 | 23 contra 40 |
|---|---|---|---|
| Decisiones por partida | 93 | 36 | 28 |
| Posiciones evaluadas por decisión | 36 | 33 | 21 |
| Tableros distintos por decisión | 18,9 | 15,5 | 10,6 |
| Una evaluación de e2 | 18 µs | 14 µs | 17 µs |
| Copiar el estado | 12 µs | 10 µs | 12 µs |
| Una partida | 206 ms | 76 ms | 42 ms |

**Por qué falla en los puntos ciegos del informe de Infra del 14/10:**

1. **Mazo 40, Mega-Venusaur ex.** El reloj de e2 solo cuenta los ataques con daño fijo, y Synthesis de Ivysaur no
   tiene. Con ese reloj, evolucionar a Ivysaur parece perder unos 2.500, así que el bot nunca evoluciona. f lo arregla.
2. **Mazo 16, Dedenne ex.**
   - En la base de deckgym, Dede-Circuit tiene `fixed_damage` 40. El reloj cree que pega 40 siempre, tenga 0 o 4
     herramientas en juego; el motor hace 0, 40, 80 o 120 según cuántas haya.
   - De las herramientas, la evaluación solo premia la del Activo, y con un peso de 10. Poner una en la Banca no le
     cambia nada.
3. **Mazo 23, Mismagius / Latias.**
   - **Cursed Prose** deja 90 de daño que cae al final del turno rival. e2 no lo cuenta ni en el reloj. f sí, porque
     lee «90 damage» del texto. Pero después de usarlo, el tablero no muestra nada hasta el final del turno rival.
     Para los dos bots, Cursed Prose «no hizo nada», y un ataque de 20 que se ve en el acto parece mejor.
   - **Luster Purge** descarta 3 Energías. Por eso la evaluación pierde unos 830: 330 de «PS × Energía» de Latios y 500
     de «Activo listo». El daño, en cambio, suma menos que eso si no da KO, y un KO vale 10.000 por punto. Por eso el
     bot solo ataca cuando noquea.
   - **Los dos relojes son independientes.** Que el rival noquee a Latios, el mejor atacante, no alarga el reloj
     propio. Por eso subirlo al Activo sin Energía no le cuesta nada al bot.
4. **El bot ve el orden de su mazo** al buscar con Poké Ball. Es de la búsqueda, no de la evaluación: entra en la
   línea 2.

## El bot g

g usa la misma búsqueda que e y f (`ExpectiMiniMaxPlayer`) y los códigos `g1` a `g9`, con la profundidad en
decisiones. Lo único que cambia es la evaluación, que vive en nuestro crate (`engine/src/g_bot.rs`); deckgym no se
toca. La evaluación usa solo lo que un jugador ve: el tablero, el descarte, el tamaño de las manos y de los mazos, y la
lista de su propio mazo. Del rival, solo lo que está en juego.

### 1. El daño, del motor

El motor ya calcula el daño esperado de un ataque contra cada Pokémon, sin jugarlo: es
`AttackOutcomes::expected_damage_to`. Ese cálculo incluye la debilidad, las herramientas, las habilidades, los
conteos del tablero y las monedas. Hoy no se puede llamar desde afuera de deckgym. Con un cambio aditivo en el fork
(ver [Lo que pide al fork](#lo-que-pide-al-fork)), la evaluación lo usa en vez de leer el texto.

Lo medí sobre una copia local de deckgym con ese cambio, con tableros armados a mano:

| Ataque | Tablero | Daño esperado |
|---|---|---|
| Dede-Circuit | 0, 1, 2 y 3 herramientas en juego | 0, 40, 80 y 120 |
| Crossing Flights (Latias) | sola, y con Latios en la Banca | 20 y 40 |
| Dede-Circuit, con 1 herramienta | contra Oricorio (Safeguard: no recibe daño de los ex) | 0 |
| Luster Purge | contra Dedenne ex | 120 |
| Cursed Prose | contra Dedenne ex | 0: es un efecto, ver el punto 4 |

Cada llamada cuesta **1,6 µs**. Pronosticar y aplicar cada resultado sobre una copia cuesta 19 µs. Por la API pública
de hoy (`Game::from_state`, `apply_action` y `get_state_clone`, con dos copias del estado) cuesta unos 45 µs, unas 20
veces una evaluación de e2: no sirve para evaluar cada posición.

Para un atacante de la Banca, o para una evolución que todavía está en el mazo, la evaluación hace una sola copia del
tablero. En esa copia pone ese Pokémon en el lugar del Activo, con la evolución sobre la misma Energía y las mismas
herramientas.

### 2. Evoluciones y aceleración

- Sigue el reloj de f: ve las evoluciones propias que quedan en el mazo y la mano, y del rival solo lo que está en
  juego.
- **Lo nuevo:** cuenta los ataques que se cargan Energía solos (mecánica `SelfChargeActive` del mapa público
  `EFFECT_MECHANIC_MAP`, sin leer el texto). Synthesis de Ivysaur pone 2 Energías [G] por turno, así que la línea
  Ivysaur → Mega-Venusaur ex se carga en unos 2 turnos y no en 4.

### 3. Herramientas en la Banca

No llevan un término propio:

- su efecto sale del daño real: Dede-Circuit pasa de 0 a 40, 80 y 120;
- también de los PS: Capa Gigante alarga el reloj del rival.

El peso de la herramienta del Activo (10) queda como parámetro.

### 4. Daño diferido y estados

- **En el tablero:**
  - el daño que ya está programado (`DelayedDamage` y daño diferido sobre un lugar), el veneno (10, o lo que diga el
    ataque) y la quemadura (20) se restan de los PS del objetivo antes de contar golpes;
  - todo eso es público y se lee de `PlayedCard::public_details`;
  - así, después de Cursed Prose, el tablero ya vale 90 de daño.
- **En lo que viene:**
  - un ataque que deja daño para después (`DamageAndCardEffect` con `DelayedDamage`, y `DelayedSpotDamage`) cuenta
    ese daño como suyo;
  - uno que envenena suma 10 por turno.
- **Sueño y parálisis:** un Activo paralizado no ataca el turno que viene, y le suma 1 turno a su reloj. Un Activo
  dormido le suma 0,5, porque despierta con una moneda.

### 5. Repetir un ataque y llegar al Activo

- **Repetir:** un ataque que descarta su Energía no se puede repetir el turno siguiente. Cada golpe después del
  primero cuesta un turno por Energía descartada (al menos uno), con 1 Energía por turno, o más con aceleración.
  Luster Purge, por ejemplo, pega cada 3 turnos.
- **Llegar al Activo:** un atacante de la Banca necesita que el Activo se vaya, así que a su preparación se le suma el
  costo de retirada del Activo. Ese costo es 0 para Latios con Latias en juego (Fantastical Floating). El costo real
  lo calcula el motor, y es el tercer cambio que se le pide al fork.

### 6. La carrera (g 1.1, con un interruptor)

En vez de dos relojes independientes, la evaluación juega una carrera turno por turno, como mucho 15:

- cada lado pega con el mejor atacante que tiene listo;
- un KO da sus puntos y saca a ese Pokémon de la carrera, con su amenaza;
- el que lo pierde sube el Pokémon que más lo ayuda en la carrera.

El resultado es quién gana y en cuántos turnos.

Es lo que arregla lo de Latios: si sube sin Energía y lo noquean, el mazo pierde a su mejor atacante. Va con su propio
interruptor y se mide contra g sin carrera.

### 7. Pesos

- Los pesos (puntos, reloj o carrera, mano, mazo y los demás términos de deckgym) van en una estructura `GParams`.
- Por defecto son los de f: los de deckgym, con su reloj en 0.
- «PS × Energía» y «Activo listo» cuentan dos veces lo que el reloj ya mide, y son los que hunden a Luster Purge. Bajan
  o salen si la liga lo confirma, no a ojo.
- `GParams` es lo que afina la línea 3.

## Lo que pide al fork

Todo para Infra (D-031). Son cambios aditivos, que no cambian ningún resultado: e, f, m y los demás bots juegan igual,
y `GAMES_REV` no se toca.

1. **`pub fn expected_attack_damage(state, acting_player, attack, target_player, target_idx) -> f64`** en `actions`.
   - Son unas 15 líneas: `forecast_attack_inner`, `apply_attack_common_modifiers` y `expected_damage_to`, el mismo
     camino que usa la partida.
   - Es la versión que medí arriba.
2. **`pub use apply_action::forecast_action`**, que hoy es `pub(crate)`. Lo necesita la línea 2: una búsqueda propia
   con nodos de azar y sin ver lo oculto.
3. **El costo de retirada efectivo** (`hooks::get_retreat_cost`, hoy `pub(crate)` en un módulo privado), con
   Globito, Fantastical Floating y los demás.

Sin el primero, g no se puede usar: el único camino público es el de los 45 µs.

## Costo

- **Por evaluación:**
  - una copia del tablero (11 µs);
  - entre 10 y 40 llamadas de 1,6 µs;
  - la cuenta del reloj.

  Son entre 30 y 80 µs, contra 13–21 µs de e2. La búsqueda cuesta lo mismo, así que **g2 debería costar 2 a 3 veces lo
  de e2 por partida**.
- **Presupuesto:** g2 no puede pasar de 3 veces e2. Como referencia, f2 cuesta 2 veces y e3, 4,6.
  - Si se pasa, el daño se guarda por tablero. La clave es exacta: lo que hay en juego, el estadio y los efectos del
    turno. Con 10–19 tableros distintos por decisión, se ahorra la mitad.
  - La caché va en un `BTreeMap` o un `Vec`, nunca recorriendo un `HashMap`.
- **Determinismo:**
  - los decimales se suman siempre en el mismo orden;
  - no hay cortes por tiempo;
  - da el mismo resultado con 1 hilo o con muchos, y en Windows y Android (la prueba de cada worker al arrancar).

## Cómo se mide

1. **Tests (`cargo test`):**
   - cada parte sobre tableros reales: Dede-Circuit 0, 40, 80 y 120; Latias 20 y 40; Safeguard 0; Cursed Prose con
     90 pendientes; Luster Purge cada 3 turnos; Synthesis;
   - cada uno falla sin su cambio.
2. **Los puntos ciegos,** con semilla fija:
   - el mazo 40 llega a Mega-Venusaur ex (`stagesA` de `perGame`);
   - el mazo 16 pone herramientas en la Banca antes de atacar;
   - el mazo 23 no sube a Latios sin Energía.

   Además, el porcentaje contra los mismos rivales que los trabajos #52 y #53 de Infra, con e2, f2 y e3.
3. **La fuerza, que es la meta:** una liga entre g2, e2, f2 y e3, y más adelante g2 contra sus versiones anteriores.
   - Los mazos son el banco del meta (las 18 listas de B4a), más el 16, el 23 y el 40.
   - Se juega cada par en los dos lados, con las mismas semillas, así que se compara partida por partida.
   - Resultado: el porcentaje de g2 contra cada bot con su intervalo del 95 % (bootstrap sobre los pares), y un Elo
     (Bradley–Terry) entre todos.
   - **Criterio:** g2 le gana a e2 y a f2 con el intervalo entero por encima del 50 %.
4. **La baranda de torneos:**
   - cuando haya calibraciones con el motor del fork, el ρ y la diferencia media de g2 no pueden empeorar los de e2
     más allá del intervalo;
   - los tres mazos tienen que acercarse a su porcentaje de torneo (el 16 está en 18,8 % con e2 y en 50,6 % en los torneos).
5. **La velocidad:** partidas por segundo y por hilo contra e2, en los mismos cruces, en la PC y en el celu.

Las ligas chicas corren en esta sesión, con 4 núcleos. Las grandes necesitan un trabajo de liga en la app, con su
propio PR más adelante.

## Cómo entra en la app

- El código `g<1-9>` va en `parse_bot_code`, en nuestro crate.
- La feature `gBots` va en `FEATURES` (`engine/src/main.rs`, una línea) y en `ENGINE_FEATURES`
  (`packages/domain/src/simulation/capabilities.ts`). Así la cola le manda un trabajo con g solo a un motor que lo
  tiene.
- La lista de bots en la pantalla viene después.
- `engine/Cargo.toml` y `GAMES_REV` son de Infra. g no cambia los resultados de los bots viejos.

## Plan

1. **Este diseño** (PR de riesgo bajo).
2. **g 1.0** (puntos 1 a 5 y 7), con sus tests, apenas el fork tenga los cambios. Es un PR de riesgo alto, porque toca
   el motor.
3. **La carrera** (punto 6) y la herramienta de la liga, con las primeras mediciones.
4. **Línea 2, sin trampa:**
   - una búsqueda propia: el expectiminimax de deckgym copiado en nuestro crate (unas 150 líneas, AGPL), con
     `forecast_action`;
   - con determinización: en cada decisión, K mundos posibles;
   - en cada mundo se mezcla el mazo propio, y la mano del rival se reparte de nuevo con sus cartas que no se ven
     (mano y mazo juntos);
   - el rival minimiza con las acciones de su mano en ese mundo, y cada acción se promedia sobre los mundos;
   - arregla también lo de Poké Ball;
   - cuesta K veces más (K de 4 a 8).
5. **Línea 3, los pesos:**
   - CMA-ES sobre `GParams`, con un subcomando de engine-cli que corre afuera de la app;
   - la nota es el porcentaje contra la liga, con semillas comunes y mazos fijos;
   - los torneos quedan como control.
6. **Línea 4, la red:** primero el diseño:
   - autojuego al estilo AlphaZero, con lo que el tablero muestra como entrada;
   - inferencia con enteros, o en Rust con el orden de las operaciones fijo, para que Windows y Android den lo mismo.

## Preguntas abiertas

- **Para Infra:** ¿entran los tres cambios en el fork, y cuándo?
- **Para Santi, con la línea 2:** ¿la determinización supone conocida la lista del rival? Sería el arquetipo y sus 20
  cartas, sin el orden ni la mano. En el juego se infiere del meta, pero no se ve.

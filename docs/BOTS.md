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
  - la búsqueda termina cuando cambia el turno: solo minimiza en las elecciones del rival dentro del turno propio, como
    qué Pokémon sube después de un KO;
  - la evaluación es lineal (`value_functions.rs`);
  - los robos (`DrawCard`, Investigación de Profesores) salen del orden real del mazo, así que el bot sabe qué va a
    robar. Poké Ball, en cambio, es un nodo de azar sobre lo que queda en el mazo.
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
   - En la base de deckgym, Dede-Circuit tiene `fixed_damage` 40. El reloj cree que pega 40 siempre. El motor, en
     cambio, hace 40 por cada Pokémon propio con herramienta: de 0 a 160.
   - De las herramientas, la evaluación premia la del Activo, con un peso de 10, y los PS que suma Capa Gigante. Poner
     en la Banca una herramienta que no suma PS no le cambia nada.
3. **Mazo 23, Mismagius / Latias.**
   - **Cursed Prose** deja 90 de daño que cae al final del turno rival. e2 no lo cuenta ni en el reloj. f sí, porque
     lee «90 damage» del texto. Pero después de usarlo, el tablero no muestra nada hasta el final del turno rival.
     Para los dos bots, Cursed Prose «no hizo nada», y un ataque de 20 que se ve en el acto parece mejor.
   - **Luster Purge** descarta 3 Energías, y la evaluación pierde por eso:
     - 330 de «PS × Energía» de Latios;
     - 500 de «Activo listo»;
     - hasta 300 más del reloj, porque vuelven a faltarle 3 Energías.

     El daño suma menos que eso si no da KO, y un KO vale 10.000 por punto. Según esa cuenta, solo le conviene atacar
     cuando noquea, que es lo que vio Infra.
   - **Los dos relojes son independientes.** Que el rival noquee a Latios, el mejor atacante, no alarga el reloj
     propio. Por eso subirlo al Activo sin Energía no le cuesta nada al bot.
4. **El bot sabe qué va a robar.** Es de la búsqueda, no de la evaluación: entra en la línea 2.

## El bot g

g usa la misma búsqueda que e y f (`ExpectiMiniMaxPlayer`) y los códigos `g1` a `g9`, con la profundidad en
decisiones. Lo único que cambia es la evaluación, que vive en nuestro crate (`engine/src/g_bot.rs`). De deckgym solo
pide tres funciones públicas al fork. La evaluación usa solo lo que un jugador ve:
- el tablero, el descarte, el tamaño de las manos y de los mazos;
- la lista de su propio mazo;
- del rival, solo lo que está en juego.

### 1. El daño, del motor

El motor ya calcula el daño esperado de un ataque contra cada Pokémon, sin jugarlo: es
`AttackOutcomes::expected_damage_to`. Incluye la debilidad, las herramientas, las habilidades (como Safeguard), los
conteos del tablero y las monedas del ataque. Hoy es código sin usar dentro de deckgym, y no se puede llamar desde
afuera. Con un cambio aditivo en el fork (ver [Lo que pide al fork](#lo-que-pide-al-fork)), la evaluación lo usa en
vez del texto.

Lo medí sobre una copia local de deckgym con ese cambio, con tableros armados a mano:

| Ataque | Tablero | Daño esperado |
|---|---|---|
| Dede-Circuit | 0, 1, 2 y 3 herramientas en juego | 0, 40, 80 y 120 |
| Crossing Flights (Latias) | sola, y con Latios en la Banca | 20 y 40 |
| Dede-Circuit, con 1 herramienta | contra Oricorio (Safeguard: no recibe daño de los ex) | 0 |
| Luster Purge | contra Dedenne ex | 120 |
| Cursed Prose | contra Dedenne ex | 0: es un efecto, ver el punto 4 |

**Costo:**
- cada llamada cuesta **1,6 µs**;
- pronosticar y aplicar cada resultado sobre una copia cuesta 19 µs;
- la API pública de hoy (`Game::from_state`, `apply_action` y `get_state_clone`) cuesta unos 45 µs. Son dos copias
  del estado, y además da una sola rama sorteada, no el esperado. Es unas 20 veces una evaluación de e2: no sirve para
  evaluar cada posición.

**Lo que hay que cuidar** (de la autorrevisión):
- **El turno.** El cálculo lee `state.current_player`, no solo quién ataca, y lo mismo hace el costo de retirada (la
  retirada gratis de Latios con Latias). Con el turno del otro lado da mal: Latias con Latios da 20 en vez de 40, y
  Dede-Circuit con 2 herramientas da 0 en vez de 80. La evaluación hace una sola copia del tablero y, antes de leer
  nada, le pone el turno del lado que ataca. Al rival del que juega se lo cuenta en su turno siguiente: así los
  efectos de este turno (los +10 de Giovanni) no le suman, y los que le dejaron para ese turno (menos daño) sí. Para el
  lado que juega, los efectos de este turno quedan contados en los turnos que vienen. Es una aproximación, y sus tests
  la muestran.
- **Los que eligen después.** El motor guarda todo el daño de un ataque que también pega a un Pokémon de la Banca
  elegido (Shadow Bullet de Hoopa ex y otros 41) hasta esa elección: con Banca, el cálculo da 0. A esos se los
  pregunta otra vez con las Bancas fuera de la copia, y queda el golpe al Activo con la debilidad y lo demás. Los que
  eligen cualquier Pokémon del rival y no tienen daño fijo (`DirectDamage*`) dan 0 también. Para esos, el daño es el
  que dice el texto, como lo lee f, salvo Pierce the Pain, que solo pega a uno que ya tiene daño. Toxic de Toxicroak
  no pega: su veneno hace 20 en cada control. Así g nunca queda más ciego que f.
- **Lo que no ve:**
  - Guts y las monedas que salvan de un KO;
  - los efectos antes del daño;
  - la prevención del primer ataque.

  Además, aplica los modificadores por golpe, y la partida los aplica a la suma por objetivo. Un test los compara
  contra el ataque aplicado de verdad (ver [Cómo se mide](#cómo-se-mide)).
- **Atacantes que no son el Activo.** Para un atacante de la Banca, o para una evolución que todavía está en el mazo,
  la misma copia pone ese Pokémon en el lugar del Activo. Una evolución va sobre la misma Energía y las mismas
  herramientas.

### 2. Evoluciones y aceleración

- Sigue el reloj de f: ve las evoluciones propias que quedan en el mazo y la mano, y del rival solo lo que está en
  juego.
- **Lo nuevo:** cuenta los ataques que se cargan Energía solos (mecánica `SelfChargeActive` del mapa público
  `EFFECT_MECHANIC_MAP`, sin leer el texto). Synthesis de Ivysaur pone 2 Energías [G] por turno, así que la línea
  Ivysaur → Mega-Venusaur ex se carga en unos 2 turnos y no en 4.
- La Energía que falta se cuenta con el costo y la Energía efectivos del motor: `State::effective_attack_cost` y
  `effective_attached_energy`, que son públicos, con Jungle Totem y los demás.

### 3. Herramientas en la Banca

No llevan un término propio:
- su efecto sale del daño real: Dede-Circuit pasa de 0 a 40, 80, 120 y 160;
- también de los PS: Capa Gigante alarga el reloj del rival.

El peso de la herramienta del Activo (10) queda como parámetro.

### 4. Daño diferido y estados

- **En el tablero.** Antes de contar golpes, a los PS del objetivo se les resta lo que ya va a caer:
  - `DelayedDamage`, en los efectos del Pokémon (`PlayedCard::public_details`);
  - el daño diferido sobre un lugar, en `State::public_turn_effects`;
  - el veneno: 10 por cada control, o lo que diga el ataque, y hay un control al final de cada turno, así que son 20
    por vuelta;
  - la quemadura (`is_burned`): 20 por control, con una moneda para curarse.

  Así, después de Cursed Prose, el tablero ya vale 90 de daño. Cambiar de Activo borra `DelayedDamage`, así que el
  rival lo puede esquivar retirándose. Por eso ese daño lleva su propio peso, 1 por defecto, para afinar en la línea 3.
- **En lo que viene:**
  - un ataque que deja daño para después (`DamageAndCardEffect` con `DelayedDamage`, y `DelayedSpotDamage`) cuenta
    ese daño como suyo;
  - uno que envenena suma 20 por turno del atacante.
- **Sueño y parálisis:**
  - un Activo paralizado no ataca el turno que viene: le suma 1 turno a su reloj;
  - uno dormido tira una moneda en cada control, y pierde en promedio 2/3 de turno;
  - cambiar de Activo o evolucionar cura los dos.

### 5. Repetir un ataque y llegar al Activo

- **Repetir:** un ataque que descarta su Energía no se puede repetir el turno siguiente. Cada golpe después del
  primero cuesta un turno por Energía descartada (al menos uno), con 1 Energía por turno, o más con aceleración.
  Luster Purge, por ejemplo, pega cada 3 turnos.
- **Llegar al Activo:** un atacante de la Banca necesita que el Activo se vaya, así que a su preparación se le suma el
  costo de retirada del Activo. Ese costo baja con Globito y es 0 si el Activo es Latios con Latias en juego
  (Fantastical Floating). El costo efectivo lo calcula el motor, y es el tercer cambio que se le pide al fork.

### 6. La carrera (g 1.1, con un interruptor)

En vez de dos relojes independientes, la evaluación juega una carrera turno por turno, como mucho 15:
- cada lado pega con el mejor atacante que tiene listo;
- un KO da sus puntos y saca a ese Pokémon de la carrera, con su amenaza;
- el que lo pierde sube el Pokémon que más lo ayuda en la carrera.

El resultado es quién gana y en cuántos turnos.

Es lo que arregla lo de Latios: si sube sin Energía y lo noquean, el mazo pierde a su mejor atacante. Va con su propio
interruptor y se mide contra g sin carrera.

### 7. Pesos

- Los pesos (puntos, reloj o carrera, mano, mazo, daño diferido y los demás términos de deckgym) van en una estructura
  `GParams`.
- Por defecto son los de f: los de deckgym, con su reloj en 0.
- «PS × Energía» y «Activo listo» cuentan dos veces lo que el reloj ya mide, y son los que hunden a Luster Purge. Bajan
  o salen si la liga lo confirma, no a ojo.
- `GParams` es lo que afina la línea 3.

## Lo que pide al fork

**Contexto:** el fork `santiqwerty1/deckgym-core` es D-031: lo decidió Santi el 14/10, según el arranque del
Coordinador, y su ficha todavía no está en main. Desde ese día deckgym ya no se usa «sin modificar», como decía
CLAUDE.md. Lo arma Infra.

Estos tres cambios son aditivos y no cambian ninguna partida: e, f, m y los demás bots juegan igual, y `GAMES_REV` no
se toca.

1. **`pub fn expected_attack_damage(state, acting_player, attack, target_player, target_idx) -> f64`** en `actions`.
   - Son unas 15 líneas: `forecast_attack_inner`, `apply_attack_common_modifiers` y `expected_damage_to`.
   - Da bien solo si `state.current_player` es `acting_player`: lo pone la evaluación.
   - Es la versión que medí arriba. Está en el fork desde `018b419` (rama `feat/bot-api`).
2. **`pub use apply_action::forecast_action`**, que hoy es `pub(crate)`. Lo necesita la línea 2: una búsqueda propia
   con nodos de azar y sin ver lo oculto.
3. **El costo de retirada efectivo** (`hooks::get_retreat_cost`, hoy `pub(crate)` en un módulo privado), con
   Globito, Fantastical Floating y los demás.

Sin el primero, g no se puede usar: el único camino público es el de los 45 µs.

Lo demás que g necesita ya es público:
- `effective_attack_cost` y `effective_attached_energy`;
- `public_turn_effects` y `public_details`;
- `observation::knockout_points`;
- `is_asleep`, `is_paralyzed`, `is_burned` e `is_poisoned`;
- `EFFECT_MECHANIC_MAP` y `Mechanic`;
- el campo `attacks` de `PokemonCard`.

## Costo

- **Por evaluación:**
  - una copia del tablero (11 µs);
  - entre 10 y 40 llamadas de 1,6 µs;
  - la cuenta del reloj.

  Son entre 30 y 80 µs, contra 13–21 µs de e2. La búsqueda cuesta lo mismo, así que **g2 debería costar 2 a 3 veces lo
  de e2 por partida**.
- **Presupuesto:** g2 no puede pasar de 3 veces e2 en la PC.
  - Como referencia, e3 cuesta 4,6 veces. f2 cuesta 2 veces en la PC, 1,3 en el segundo worker y 1,1 en el celu.
  - Si g2 se pasa, el daño se guarda por tablero. La clave es exacta: lo que hay en juego, el estadio, los efectos del
    turno y de quién es el turno. Con 10–19 tableros distintos por decisión, se ahorra la mitad.
  - La caché va en un `BTreeMap` o un `Vec`, nunca recorriendo un `HashMap`.
- **Determinismo:**
  - en la evaluación, solo sumas, restas, productos, divisiones, `sqrt`, `floor` y `ceil`, que dan lo mismo en todas
    las plataformas. Nada de `exp`, `ln` ni `powf`, que dependen de la biblioteca matemática de cada sistema;
  - los decimales se suman siempre en el mismo orden;
  - no hay cortes por tiempo;
  - los mundos de la línea 2 salen del generador de la partida;
  - tiene que dar el mismo resultado con 1 hilo o con muchos, y en Windows y Android: es la prueba de cada worker al
    arrancar.

## Cómo se mide

1. **Tests (`cargo test`):**
   - cada parte sobre tableros reales: Dede-Circuit de 0 a 160; Latias 20 y 40; Safeguard 0; Cursed Prose con 90
     pendientes; el veneno; Luster Purge cada 3 turnos; Synthesis; y el turno del otro lado;
   - **contra la partida:** en tableros sacados de partidas reales, el daño esperado de cada ataque sin azar tiene que
     coincidir con el que deja aplicarlo de verdad (`Game`). Las diferencias quedan listadas y explicadas;
   - cada test falla sin su cambio.
2. **Los puntos ciegos,** con semilla fija:
   - el mazo 40 llega a Mega-Venusaur ex (`stagesA` de `perGame`);
   - el mazo 16 pone herramientas en la Banca antes de atacar;
   - el mazo 23 no sube a Latios sin Energía.

   Además, el porcentaje contra los mismos rivales de los trabajos de simulación #52 y #53 de Infra, con e2, f2 y e3.
3. **La fuerza, que es la meta:** una liga entre g2, e2, f2 y e3, y más adelante g2 contra sus versiones anteriores.
   - Los mazos son el banco del meta (las 18 listas de B4a), más el 16, el 23 y el 40.
   - Se juega cada par en los dos lados, con las mismas semillas, así que se compara partida por partida.
   - Resultado: el porcentaje de g2 contra cada bot con su intervalo del 95 % (bootstrap sobre los pares), y un Elo
     (Bradley–Terry) entre todos.
   - **Criterio:** g2 le gana a e2 y a f2 con el intervalo entero por encima del 50 %.
4. **La baranda de torneos:**
   - cuando haya calibraciones con el motor del fork, el ρ y la diferencia media de g2 no pueden empeorar los de e2
     más allá del intervalo;
   - los tres mazos tienen que acercarse a su arquetipo en los torneos. El 16 da 18,8 % con e2 y su arquetipo,
     50,6 % en los torneos, aunque esas listas llevan 2 Indeedee ex y 2 Oricorio.
5. **La velocidad:** partidas por segundo y por hilo contra e2, en los mismos cruces, en la PC y en el celu.

Las ligas chicas corren en esta sesión, con 4 núcleos. Las grandes necesitan un trabajo de liga en la app, con su
propio PR más adelante.

## Resultados de g 1.0 (15/10/2026)

**La liga:**
- 11 mazos: 8 del banco de B4a (lab_meta_bank del 15/10) más el 16, el 23 y el 40;
- los 55 pares de mazos, cada uno en los dos lados con las mismas semillas, 20 partidas por lado: 2.200 partidas
  apareadas por cruce de bots;
- el intervalo, por bootstrap sobre los pares de mazos;
- motor del fork `018b419`, 4 hilos.

| Cruce | g2 gana | IC 95 % |
|---|---|---|
| g2 contra e2 | 58,2 % | 54,7–62,3 % |
| g2 contra f2 | 50,9 % | 49,5–52,4 % |

- **Contra e2 cumple el criterio. Contra f2 no:** en este banco juegan parejo.
- **La ablación** se hizo con g 1.0 antes de los arreglos de la autorrevisión. Cada parte se apagó por separado y se
  jugó g2 contra f2:

  | Sin | g2 gana (IC 95 %) |
  |---|---|
  | (nada: g entero) | 50,7 % (49,0–52,4 %) |
  | el daño del motor | 50,3 % (49,4–51,3 %) |
  | repetir | 50,0 % (48,4–51,7 %) |
  | el veneno | 50,7 % (49,0–52,4 %) |
  | el daño pendiente | 51,0 % (49,4–52,7 %) |
  | la retirada | 51,4 % (49,8–52,9 %) |
  | la aceleración | 50,7 % (49,0–52,4 %) |
  | los estados | 50,7 % (49,0–52,5 %) |

  Ninguna parte pesa sola en el promedio. Cada una cambia los pocos cruces de los mazos que usan esas cartas.
- **La velocidad,** en los mismos 10 cruces con 40 partidas y 4 hilos:

  | Bot | Por partida y por hilo |
  |---|---|
  | e2 | 121 ms |
  | f2 | 128 ms |
  | g2 | 255 ms |

  g2 cuesta 2,1 veces e2: dentro del tope de 3.
- **Lo siguiente:**
  - la carrera (punto 6);
  - los pesos (línea 3): «PS × Energía» y «Activo listo» cuentan dos veces lo que mide el reloj;
  - el comportamiento en los puntos ciegos, con un contador por partida: herramientas en la Banca, a quién sube el
    mazo 23;
  - la liga con más mazos, en la app.

## Cómo entra en la app

- **Hecho en g 1.0:**
  - el código `g<1-9>` en `parse_bot_code`, en nuestro crate;
  - la feature `gBots` en el motor;
  - `g_bot.rs` en el motor del navegador.

  La app todavía no acepta los códigos: eso, el filtro de la cola, los avisos, las partidas contra el bot y las
  tools van en otro PR, como se hizo con f.
- **Lo que falta para la feature `gBots`:** sumarla a `ENGINE_FEATURES` de
  `packages/domain/src/simulation/capabilities.ts`, con su `canPlayGBots` como el de f, así la cola le manda un
  trabajo con g solo a un motor que lo tiene. En el motor ya está, en los dos `FEATURES` de `engine/src/main.rs`.
- **El motor del navegador** (`engine/wasm`) incluye `fair_bot.rs` con `#[path]` y fija su propio deckgym. Tiene que
  pasar al fork junto con el resto, o no compila. Si g entra ahí, va igual que f.
- **La lista de bots** en la pantalla viene después.
- **`engine/Cargo.toml` y `GAMES_REV` son de Infra.** g no cambia los resultados de los bots viejos. El cambio de
  motor al fork, en cambio, cambia `engineRev`: claves nuevas en la cola, trabajos que se juegan enteros otra vez, la
  caché de chunks vacía y `games-rev.json` nuevo. Eso es del cambio al fork, no de g.

## Plan

1. **Este diseño** (#111, integrado).
2. **g 1.0** (puntos 1 a 5 y 7), con sus tests, contra el fork `018b419`. Es un PR de riesgo alto, porque toca el
   motor, y va después del PR de Infra que pasa `engine/Cargo.toml` al fork. Resultados arriba.
3. **La app acepta g:** los códigos, el filtro de la cola, los avisos, las partidas contra el bot y las tools (riesgo
   medio).
4. **La carrera** (punto 6) y la herramienta de la liga, con las primeras mediciones.
5. **Línea 2, sin trampa:**
   - una búsqueda propia: el expectiminimax de deckgym copiado en nuestro crate (unas 150 líneas, AGPL), con
     `forecast_action`;
   - con determinización: en cada decisión, K mundos posibles en los que se mezcla el mazo propio, así los robos dejan
     de saberse;
   - si la búsqueda llega a cruzar al turno del rival, en cada mundo también se reparte de nuevo su mano;
   - la mano del rival sale de la lista típica de su arquetipo en el meta (sus 20 cartas, sin el orden ni la mano;
     decidido por Santi el 15/10), menos lo que ya se vio: lo que reveló (Darkness Claw de Mega-Absol ex muestra la
     mano entera), lo que se infiere (buscó un Básico con Poké Ball y no lo jugó), lo jugado y lo descartado. Un test:
     después de Darkness Claw, el bot juega distinto que sin la revelación;
   - cada acción se promedia sobre los mundos;
   - cuesta K veces más (K de 4 a 8).
6. **Línea 3, los pesos:**
   - CMA-ES sobre `GParams`, con un subcomando de engine-cli que corre afuera de la app;
   - la nota es el porcentaje contra la liga, con semillas comunes y mazos fijos;
   - los torneos quedan como control.
7. **Línea 4, la red:** primero el diseño:
   - autojuego al estilo AlphaZero, con lo que el tablero muestra como entrada;
   - inferencia con enteros, o en Rust con solo las operaciones de arriba y su orden fijo, para que Windows y Android
     den lo mismo.

## Preguntas abiertas

- **Para Infra:**
  - los tres cambios entraron en el fork (`018b419`, rama `feat/bot-api`);
  - en deckgym, `sample_down` mezcla con el hash de un `usize`. En el motor del navegador (wasm32), el bot puede
    resumir las ramas distinto que en la PC. Es de antes de g, y conviene confirmarlo.
- **Respondida por Santi (15/10), para la línea 2:** la determinización supone la lista típica del arquetipo del meta,
  no la real, sin el orden ni la mano.

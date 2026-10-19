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

Para eso evalúa sobre una copia en la que la mano y el mazo del rival son cartas desconocidas: cuántas hay es público,
qué son no (`hide`, de la revisión de #111). Así no se cuela lo oculto por un ataque que lo cuenta (Cyberjack de
Porygon-Z cuenta los Entrenadores del mazo rival; Puppy Pile de Lillipup, los Lillipup de la mano de su dueño) ni por
el término «Activo listo» de deckgym, que busca evoluciones en la mano y el mazo de cada lado. Un test compara dos
tableros iguales en lo público y distintos en lo oculto: dan lo mismo.

Qué son las desconocidas: en g 1.0 eran todas Objetos sin nombre, y Cyberjack las contaba todas como Entrenadores
(Codex en #117). Desde g 1.1 son lo que le quedaría a una lista del banco, según lo que el rival ya mostró:
- una lista del banco de B4a lleva de 10 a 16 Entrenadores de 20 (12,4 por peso), así que se toman 12 Entrenadores y
  8 Pokémon;
- a eso se le resta lo que está en juego (un Fase 2 son tres cartas, y cada Herramienta un Entrenador) y lo
  descartado;
- lo que queda se reparte una sola vez entre la mano y el mazo juntos, así que nunca hay más Entrenadores de los que
  quedan (Codex en #128).
Los Pokémon desconocidos son Básicos sin ataques, sin Habilidad y sin evolución. Con la línea 2 pasan a ser la lista
típica del arquetipo.

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

En g 1.1 (18/10), dos cambios para que las juegue de verdad:
- **«Atacar ahora» en la hoja.** Jugar una Herramienta son dos decisiones: la carta y después el Pokémon. Con
  profundidad 2, el ataque queda pasado la hoja, y atacar primero muestra su daño enseguida. Por eso g 1.0 atacaba
  con Herramientas en la mano. Ahora una hoja en medio de su propio turno vale al menos lo que da atacar ahí mismo.
  El ataque se aplica sobre la copia con lo del rival tapado, y como termina el turno, es un paso más y nada más hondo.
  Si el ataque pide una elección (el Pokémon de la Banca de Shadow Bullet), hace la mejor, hasta 2, y después termina
  el turno antes de valer (Codex en #128). Una hoja de la búsqueda justo después de un ataque propio también se vale
  después de terminar el turno: lo dice deckgym (`end_turn_pending`), no que solo quede terminarlo, así que un Activo
  bloqueado (Prismatic Laser) no es un turno terminado. Si a esa hoja le queda una elección del ataque, queda como
  está: la eligió la partida con las cartas reales, y sobre la copia tapada podía nombrar una que no está.
- **El golpe que sobra** (`margin`, 0,1 de golpe). Un KO con daño de sobra vale un poco más que uno justo. Así, una
  Herramienta que suma daño sin ahorrar un golpe entero paga la carta que saca de la mano. Sola apenas mueve; desempata.

### 4. Daño diferido y estados

- **En el tablero.** Antes de contar golpes, a los PS del objetivo se les resta lo que ya va a caer:
  - `DelayedDamage`, en los efectos del Pokémon (`PlayedCard::public_details`);
  - el daño diferido sobre un lugar, en `State::public_turn_effects`, y el KO programado sobre un lugar (Abyssal
    Drop), que vale todos sus PS;
  - la quemadura (`is_burned`): 20 por control, con una moneda para curarse. Si el ataque no la vuelve a poner, se
    apaga: 20 + 10 + 5… son 40 en total, no 30 por golpe (Codex en #128).

  El veneno se cuenta golpe a golpe: 10 por cada control, o lo que diga el ataque, y hay un control al final de cada
  turno, así que son 20 por vuelta después de cada golpe. Antes del primero cae una vuelta por cada turno que el
  atacante tarda en prepararse (Codex en #128), y el control que cierra el turno del defensor, si ese turno viene
  primero. A un Activo envenenado que el ataque no puede dañar (un ex contra Safeguard) se lo espera hasta que el
  veneno lo noquea, igual que si al atacante le faltara Energía (autorrevisión de g 1.1.1). Un KO en los controles que
  siguen a un golpe cuenta en el turno de ese golpe. Un veneno con moneda que ya cayó se queda: Stun Poison envenena con 50 % después del primer golpe y con 75 %
  después del segundo (Codex en #128).

  Así, después de Cursed Prose, el tablero ya vale 90 de daño. Cambiar de Activo borra `DelayedDamage`, así que el
  rival lo puede esquivar retirándose. Por eso ese daño lleva su propio peso, 1 por defecto, para afinar en la línea 3.
- **En lo que viene:**
  - un ataque que deja daño para después (`DamageAndCardEffect` con `DelayedDamage`, y `DelayedSpotDamage`) cuenta
    ese daño como suyo;
  - uno que envenena o quema suma su vuelta (20 o 30) por golpe, con la probabilidad de su mecánica: la mitad con
    una moneda, 11/16 en Cross Poison (al menos 2 caras de 4). Un test lo compara con el motor en los 23 textos que
    envenenan o queman;
  - envenenar de nuevo reemplaza el veneno anterior, con su probabilidad: Toxic sobre un veneno común da 40 por
    vuelta, no 20, y un veneno común con moneda sobre el de Toxic lo reemplaza de a poco, 30, 25 y 22,5 por vuelta,
    no 30 en cada golpe (Codex en #128). Un estado que solo pone el primer ataque (`FirstAttackBonusDamageAndStatus`) no se cuenta golpe a
    golpe, y su daño de más tampoco: Cold Start pega 80 la primera vez y 60 después, y esos 20 van al primer golpe del
    plan aunque caiga en otro objetivo, como el que sube después de que el Activo cae envenenado (Codex en #128);
  - una quemadura que el Activo ya tiene sigue durante el primer golpe de un ataque que vuelve a quemar con moneda
    (Fire Fang de B1 029): esa vuelta es segura, y la de los golpes siguientes lleva la moneda (Codex en #128).
- **Sueño y parálisis:**
  - un Activo paralizado no ataca el turno que viene: le suma 1 turno a su reloj;
  - uno dormido tira una moneda en cada control: pierde 4/3 de turno si es su turno (este y ¼ de cada siguiente) y
    2/3 si es el del rival;
  - la Energía y el estado corren a la vez: un Activo paralizado carga la Energía de su retirada mientras tanto;
  - cambiar de Activo o evolucionar cura los dos;
  - un ataque que duerme a su propio usuario (Collapse, Flop-Down Punch) espera ⅓ de turno más entre golpes: sigue
    dormido en su turno siguiente con ¼, en el otro con 1/16, y así (Codex en #128).

### 5. Repetir un ataque y llegar al Activo

- **Repetir:** un ataque que descarta su Energía no se puede repetir el turno siguiente. Cada golpe después del
  primero cuesta un turno por Energía descartada (al menos uno), con 1 Energía por turno, o más con aceleración.
  Luster Purge, por ejemplo, pega cada 3 turnos. Entre golpes vuelve solo lo que el ataque usa: un Raichu con 5
  Energías descarta las 5 en el primer Thunderbolt, pero para el siguiente le faltan 3. Mega Burst, en cambio, pega
  por cada Energía que descarta: para pegar lo mismo tiene que recuperarlas todas (Codex en #128). Uno que no puede
  atacar el turno siguiente (Prismatic Laser, Big Beat) pega cada dos turnos.
- **Cargar:** la Energía que falta se pone de a una, como llega turno a turno, así lo que cuenta doble (Jungle Totem)
  necesita menos, también si el que ataca evoluciona a Serperior. deckgym cuenta cada [G] dos veces mirando el
  tablero, la evolución de la copia incluida, así que cada una se pone una sola vez: g 1.1 la volvía a doblar y valía 4
  (verificación del Coordinador en #128). Un ataque que pega más con más Energía prueba hasta
  2 de más, o hasta su umbral si pide más (Energy Whip de Dhelmise: 3 de más): Mega Burst con una tercera hace 150 y noquea de un golpe a un Pokémon de 120 PS. Prueba los dos pasos
  aunque el primero no sume (en Crush the Weak de Scrafty, la primera puede empatar la Energía del rival y recién la
  segunda la pasa), con la Energía del tipo que cuenta
  la mecánica, si la zona la hace: Psykick de Medicham pega 50 más con una [P] (Codex en #128). Las mecánicas que
  cuentan la Energía de un tipo en juego o descartan la de un tipo también piden el suyo, aunque hoy en todas sus cartas
  es el del atacante.
- **Retroceso:** un plan no pide más golpes de los que su atacante aguanta (Beat Punk, Enormous Explosion), ni más KO
  de los que sobrevive (Head Smash: 50 por cada KO). Solo cuentan los KO de sus golpes, no el de un objetivo que cayó
  antes del primero, por un veneno o un KO programado (Codex en #128). Un ataque que baraja a su usuario en el mazo (Deck and Cover)
  gana solo con un golpe (Codex en #128).
- **A todos a la vez:** un ataque que también le pega a toda la Banca (Swirling Disaster, Gigashock) la desgasta
  junto con el Activo. Tres Pokémon de 50 PS caen juntos en 5 golpes, no en 15. Puede ganar por la Banca aunque el
  Activo no reciba daño (Safeguard). Lo que recibe cada uno de la Banca es lo que da el motor para ese lugar: sin
  Debilidad, con la escalada de Wild Spin, Damaging Spark solo a los que ya tienen daño y sin las reducciones que un
  Luxray tendría como Activo (Codex en #128).
- **Llegar al Activo:** un atacante de la Banca necesita que el Activo se vaya. A su preparación se le suma la
  Energía que al Activo todavía le falta para pagar su retirada: el costo menos lo que ya tiene puesto, a una por
  turno. Si ya la tiene, no suma nada. El costo baja con Globito y es 0 si el Activo es Latios con Latias en juego
  (Fantastical Floating). El costo efectivo lo calcula el motor, y es el tercer cambio que se le pide al fork.

### 6. La carrera (g 1.1, con un interruptor)

En vez de dos relojes independientes, la evaluación juega una carrera turno por turno, como mucho 15 y nunca más allá
del límite de la partida (deckgym la empata cuando empieza el turno 31: una carrera sin terminar ahí es un empate):
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
  - g 1.0 cuesta 2,1 veces e2, así que no lleva caché. Si un día hace falta, la clave tiene que llevar todo lo que lee
    el cálculo del daño, no solo lo que hay en juego: también el descarte (Past Friends suma por cada Partidario
    descartado), el tamaño de la mano y del mazo, el estadio, los efectos del turno y de quién es el turno.
  - La caché iría en un `BTreeMap` o un `Vec`, nunca recorriendo un `HashMap`.
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
- el intervalo, por bootstrap sobre los pares de mazos. Toma los 55 pares como independientes aunque cada mazo está
  en 10 de ellos, así que puede quedar algo angosto (revisión del Coordinador);
- el desglose «con <mazo>» de `bots-league.mjs` dice cómo le fue a cada bot con ese mazo, y mezcla la fuerza del
  mazo con la del bot: sirve para mirar, no como prueba;
- motor del fork `018b419`, 4 hilos.

| Cruce | g2 gana | IC 95 % |
|---|---|---|
| g2 contra e2 | 58,2 % | 54,7–62,3 % |
| g2 contra f2 | 50,9 % | 49,5–52,4 % |

Después de tapar lo oculto (`hide`), con `scripts/bots-league.mjs` (40 partidas por lado, 2.200 apareadas por
cruce):

| Liga | Cruce | g2 gana | IC 95 % |
|---|---|---|---|
| semilla 20261015 | g2 contra e2 | 59,0 % | 55,9–62,4 % |
| semilla 20261015 | g2 contra f2 | 52,0 % | 50,6–53,4 % |
| semilla 20261016 (nueva) | g2 contra f2 | 52,7 % | 51,1–54,3 % |
| semilla 20261016, g sin `hide` | g2 contra f2 | 52,8 % | 51,2–54,3 % |

Elo de la liga de tres (semilla 20261015): e2 0, f2 +48, g2 +63.

- **Contra e2 cumple el criterio.**
- **Contra f2 está en el borde:** en dos de las tres ligas el intervalo queda entero arriba del 50 %, y en la otra
  no. g2 le gana a f2 por 1 a 3 puntos. Tapar lo oculto no le cambia la fuerza (52,7 contra 52,8 en las mismas
  partidas).
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

  g2 cuesta 2,1 veces e2: dentro del tope de 3. Con `hide`, en otra corrida: e2 94 ms, f2 114 y g2 212, 2,3 veces.
  La verificación del Coordinador midió 2,35 veces.
- **Lo siguiente:**
  - la carrera (punto 6);
  - los pesos (línea 3): «PS × Energía» y «Activo listo» cuentan dos veces lo que mide el reloj;
  - el comportamiento en los puntos ciegos, con un contador por partida: herramientas en la Banca, a quién sube el
    mazo 23;
  - la liga con más mazos, en la app.

## Resultados de g 1.1 (18/10/2026)

**Dedenne y sus Herramientas.** Partidas reales del mazo 16 contra 6 mazos del banco, 72 por bot, el mismo bot de los
dos lados. Se cuentan los ataques de Dede-Circuit hechos con una Herramienta todavía en la mano que se podía poner:

| Bot | Ataques | Con una Herramienta jugable en la mano |
|---|---|---|
| e2 | 123 | 119 |
| g2 1.0 | 110 | 83 |
| g2 1.0 con el golpe que sobra | 111 | 75 |
| g2 con «atacar ahora» | 105 | 4 |
| e3 | 102 | 6 |

Queda como caso fijo en `dedenne_attaches_its_tools_before_attacking`: como mucho un quinto de los ataques. Con
«atacar ahora» apagado, el test falla.

**Dedenne contra el banco del meta B4a** (`lab_meta_bank` del 18/10: 18 listas de 15 arquetipos, con sus pesos).
Son 200 partidas por lista (n = 3.600 por fila), el mismo bot de los dos lados, la misma semilla por lista y la
fórmula del `metaScore` de la app (un empate no cuenta como victoria):

| Bot | Mazo 16 | Lista de torneo 1d76b8c1b53c88 |
|---|---|---|
| e2 | 17,0 % (IC 95 % 15,7–18,2 %) | 27,6 % (26,1–29,0 %) |
| g2 1.0 | 29,2 % (27,7–30,7 %) | 41,7 % (40,1–43,3 %) |
| e3 | 39,5 % (37,9–41,2 %) | 46,9 % (45,3–48,6 %) |
| g2 1.1 antes de la autorrevisión | 46,1 % (44,4–47,7 %) | 54,2 % (52,5–55,8 %) |
| g2 1.1 antes de Codex en #128 | 44,9 % (43,2–46,6 %) | 52,5 % (50,8–54,1 %) |
| g2 1.1 antes de los últimos de Codex | 42,2 % (40,5–43,8 %) | 50,4 % (48,7–52,1 %) |
| g2 1.1 (25554ff, motor `0b510d1`) | 42,0 % (40,4–43,7 %) | 50,3 % (48,6–51,9 %) |
| **g2 1.1.1** (motor `0b510d1`) | **42,1 % (40,4–43,8 %)** | **50,1 % (48,4–51,8 %)** |

- En torneos, el arquetipo da 52,4 % (n = 584). Es otra fuente y no se combina con estas: sirve de baranda. g2 1.1
  es el bot que deja a la lista de torneo más cerca de donde está en los torneos, con el intervalo apenas abajo.
- La autorrevisión (veneno y quemadura después del golpe, la Debilidad del texto) le baja un punto y medio a Dedenne,
  y los 12 arreglos de #128, otros dos o tres: los rivales del banco que envenenan, queman o pegan a la Banca también
  juegan mejor.
- El rival también juega con el bot de la fila, así que parte del cambio es la fuerza del banco, no solo la de
  Dedenne.

**La liga** (`scripts/bots-league.mjs`, los 11 mazos de siempre, 40 partidas por lado, 2.200 apareadas por fila, IC
por bootstrap sobre los 55 pares):

| g2 | Semilla | contra e2 | contra f2 |
|---|---|---|---|
| 1.0 | 20261015 | 59,0 % (55,9–62,4 %) | 52,0 % (50,6–53,4 %) |
| 1.0 + «atacar ahora» y el golpe que sobra | 20261015 | 65,6 % (62,3–69,1 %) | 59,5 % (57,4–61,8 %) |
| 1.1 antes de la autorrevisión | 20261015 | 66,3 % (63,0–69,9 %) | 60,3 % (58,2–62,5 %) |
| 1.1 antes de la autorrevisión | 20261018 (nueva) | | 59,1 % (57,0–61,3 %) |
| 1.1 antes de Codex en #128 | 20261015 | 67,2 % (63,9–70,6 %) | 59,7 % (57,6–62,0 %) |
| 1.1 antes de Codex en #128 | 20261018 (nueva) | | 61,7 % (59,6–64,0 %) |
| 1.1 en a75be19 | 20261015 | 68,8 % (65,7–72,0 %) | 63,5 % (61,4–65,7 %) |
| 1.1 en a75be19 | 20261018 (nueva) | | 62,1 % (60,2–64,0 %) |
| 1.1 (25554ff, motor `0b510d1`) | 20261015 | 68,7 % (65,6–71,9 %) | 63,5 % (61,5–65,7 %) |
| 1.1 (25554ff, motor `0b510d1`) | 20261018 (nueva) | | 62,4 % (60,5–64,4 %) |
| **1.1.1** (motor `0b510d1`) | 20261015 | **68,7 % (65,6–71,9 %)** | **63,5 % (61,5–65,7 %)** |
| **1.1.1** (motor `0b510d1`) | 20261018 (nueva) | | **62,4 % (60,5–64,4 %)** |

- g 1.1.1 cambia algunas partidas de dos mazos (Mega Lucario ex y Butterfree / Mega Sceptile ex), no los totales.
- Con el motor `c87bad0` (#138), g 1.1.1 juega las mismas partidas: g2 contra f2 con la semilla 20261015 sale idéntico.
- g2 con «atacar ahora» le gana a g2 1.0 57,9 % (IC 56,0–59,8 %).
- Terminar el turno antes de valer el ataque (autorrevisión) compra poco pero algo: g2 le gana 51,6 % (IC 50,8–52,5 %)
  al mismo g2 sin ese paso.
- **Cumple el criterio contra los dos:** le gana a e2 y a f2 con el intervalo entero arriba del 50 %, también con
  semillas nuevas.
- Casi toda la ganancia viene de «atacar ahora». Los 14 arreglos de Codex en #117 suman menos de un punto en el
  promedio: cada uno cambia pocos cruces, como en la ablación de g 1.0. Los 12 de #128 suben a f2 casi 4 puntos con la
  semilla de siempre, pero medio punto con la nueva: lo firme es que no bajan.
- Con su mazo, g2 contra f2: el 16 gana 56,4 % y f2 10,8 %; el 23, 35,6 % y 17,3 %; el 40, 77,0 % y 51,4 % (n = 400
  por bot). Mezcla la fuerza del mazo con la del bot.

**La velocidad,** en los mismos 10 cruces de antes con 40 partidas y 4 hilos:

| Bot | Por partida y por hilo |
|---|---|
| e2 | 104–109 ms |
| f2 | 119 ms |
| g2 1.0 | 236 ms |
| g2 1.1, primera versión | 359 ms (3,45 veces e2) |
| g2 1.1 antes de la autorrevisión | 293 ms (2,7–2,8 veces e2) |
| g2 1.1 antes de Codex en #128 | 335 ms (3,2 veces e2, con e2 en 106) |
| g2 1.1 en a75be19 | 324–335 ms (2,9–3,2 veces e2, con e2 en 106–115) |
| g2 1.1 (25554ff, motor `0b510d1`) | 333–345 ms (unas 3 veces e2, con e2 en 111–112) |

**g2 1.1 queda en el borde del tope de 3 que pone este diseño.** Lo que suma la autorrevisión es terminar el turno después de
cada ataque de «atacar ahora» (unos 46 ms por partida), y se queda: es un error de reglas, no una heurística. El
Coordinador aceptó el 18/10 hasta 3,5 veces e2 mientras la app no use g.

La evaluación base de deckgym no es lo que pesa en g. Una variante en el fork que saltea los términos con peso 0 y no
copia el mazo y la mano para «Activo listo» (santiqwerty1/deckgym-core#1) juega las mismas partidas: 30 trabajos de 40 partidas
de e2, f2 y g2, idénticos. Pero baja e2 un 15 % (113 a 96 ms) y f2 un 19 % (132 a 107), y g2 solo un 2 % (318 a 312).
Lo de g es su propio reloj y «atacar ahora». Con esa variante, g2 queda en 3,25 veces e2, porque e2 se abarata más.

La primera versión se pasaba del tope de 3. Bajó así:
- la mecánica de cada ataque se busca una vez;
- solo los ataques que escalan con la Energía prueban más;
- «atacar ahora» no genera las acciones donde el Activo no tiene pagado ningún ataque;
- `public_details`, que copia los efectos, se lee solo donde hace falta;
- las cartas tapadas no llevan texto.

En 120 partidas de g2 contra sí mismo, los ganadores son los mismos antes y después. En la autorrevisión se
saltean además los planes cuyo armado ya no le gana al mejor, y el fin del turno se aplica sin copiar el tablero (160
partidas idénticas).

**Las partidas doradas:** g1 y g2 salen de `games-rev.json` (de 38 casos a 34) sin subir `GAMES_REV`. Vuelven en el
PR que deja que la app use g, ya con su comportamiento final. Lo decidió el Coordinador el 18/10: ningún trabajo de la
cola puede pedir g todavía.

**Dos pánicos de deckgym, encontrados midiendo y arreglados, cada uno con su test:**
- una hoja justo después de un ataque con una elección en la pila: esa elección se hizo con las cartas reales, y
  aplicarla sobre la copia con la mano del rival tapada nombraba una carta que no está. Esa hoja queda como está;
- pedirle al motor el daño a un lugar de la Banca cuando el rival todavía no eligió su nuevo Activo: deckgym mira las
  habilidades del Activo (Intimidating Fang) y no lo encuentra. Ahí la Banca no recibe nada.

Después, todos los cruces de la liga con g1, g2 y g3 (y g2 contra e2) y las 36 corridas del banco terminaron sin
fallas.

### La deuda de g (Codex en #128)

Codex revisó #128 nueve veces y dejó 35 hallazgos: 29 arreglados con su test (los 4 de la última, en g 1.1.1), 2 que
no se sostienen (el robo del rival después del fin del turno, que la búsqueda de deckgym tampoco aplica, y Stretch Kick
sobre el Activo, que ya daba 0) y 4 que piden modelar algo nuevo. La verificación del Coordinador sumó tres: Jungle
Totem, arreglado en g 1.1.1; el tope de Head Smash, en dos partes (el KO de antes del primer golpe es el mismo caso
que el último de Codex, y el de una vuelta de estado después de un golpe va a la deuda); y Fire Fang, a la deuda. Con
la regla que aceptó el Coordinador el 19/10, lo que pide modelar algo nuevo queda acá, respondido en su hilo con el
enlace, para la carrera o la evaluación aprendida (líneas 3 y 4). Siempre se arreglan, en cambio, los pánicos, las
fallas de un cruce y cualquier cosa que deje ver lo oculto. Desde g 1.1.1, lo que Codex encuentre después de la
verificación del Coordinador va al PR siguiente de g, salvo esos tres casos, que se arreglan en el mismo.
- **El daño del ataque que se carga solo** (Plasma Hurricane de Tapu Koko ex): el reloj cuenta la carga como ritmo de
  Energía, no el daño que hace mientras carga. Pide modelar el ataque de carga con su costo y sus turnos.
- **La carta de arriba de lo oculto** (Cliff Crumbler, Crackling Snap): cualquier orden sintético deja fija la clase
  de la carta de arriba. Promediar pide pedir esos ataques con las dos clases.
- **Las chances de Chemical Panic** según los estados que el objetivo ya tiene: `inflicts` es por ataque, y esto lo
  vuelve por objetivo.
- **Los ataques que le pegan a un solo Pokémon de la Banca** (Stretch Kick): el reloj no los cuenta como amenaza
  aunque su KO pueda ganar. Pide elegir objetivos de la Banca por puntos mientras el Activo queda.
- **Menores:**
  - una quemadura de antes que sigue después de dos controles (¼) en los golpes siguientes de un ataque que quema con
    moneda, sin hallazgo propio;
  - **la quemadura de antes contra Fire Fang** (B1 029, quema con moneda) cuando el turno del rival va primero: el
    control de ese turno la puede curar antes del golpe, así que después del primero sigue con ½ + ½ · ½ = ¾, unos
    22,5, no los 30 seguros que cuenta g (verificación del Coordinador en #128);
  - **el KO de una vuelta de estado después de un golpe de Head Smash:** si el veneno o la quemadura terminan al Activo
    en el control que sigue al golpe, el tope lo cuenta como KO del ataque, y en el juego ese KO no dispara el
    retroceso. Pide separar en cada golpe el daño del estado del daño del ataque;
  - de la autorrevisión de g 1.1.1, tres que cuentan de más los turnos: el veneno cae una vuelta por golpe aunque el
    atacante espere más entre golpes (una Energía que vuelve, un ataque que no se repite el turno siguiente); una
    quemadura que el ataque vuelve a poner cae solo el control de antes mientras el atacante se prepara; y Eruption
    (Camerupt) descarta Energía con moneda, pero `self_discard` no lo sabe y lo deja repetir cada turno.

## Cómo entra en la app

- **Hecho en g 1.0:**
  - el código `g<1-9>` en `parse_bot_code`, en nuestro crate;
  - la feature `gBots` en el motor;
  - `g_bot.rs` en el motor del navegador.

  La app todavía no acepta los códigos: eso, el filtro de la cola, los avisos, las partidas contra el bot y las
  tools van en otro PR, como se hizo con f.
- **Lo que falta para que la app acepte g** (revisión de #111): en el motor la feature ya está, en los dos
  `FEATURES` de `engine/src/main.rs`. Con f se hizo así, y con g va igual:
  - `BOT_CODE_PATTERN` y la lista de códigos de `packages/domain/src/simulation/jobs.ts` (hoy rechazan `g`);
  - `gBots` en `ENGINE_FEATURES` y su `canPlayGBots` en `capabilities.ts`;
  - el filtro del reclamo de chunks (`worker-queue.service.ts`) y el de las partidas en vivo
    (`live-games.service.ts`), que hoy miran los códigos de f, más el aviso al worker que no puede jugarlos;
  - los avisos (`alerts.service.ts`), las tools de MCP y sus tests.
- **El motor del navegador** (`engine/wasm`) incluye `fair_bot.rs` con `#[path]` y fija su propio deckgym. Tiene que
  pasar al fork junto con el resto, o no compila. Si g entra ahí, va igual que f.
- **La lista de bots** en la pantalla viene después.
- **`engine/Cargo.toml` y `GAMES_REV` son de Infra.** g no cambia los resultados de los bots viejos. El cambio de
  motor al fork, en cambio, cambia `engineRev`: claves nuevas en la cola, trabajos que se juegan enteros otra vez, la
  caché de chunks vacía y `games-rev.json` nuevo. Eso es del cambio al fork, no de g.

## Plan

1. **Este diseño** (#111, integrado).
2. **g 1.0** (#117, integrado): puntos 1 a 5 y 7, engine-cli 0.3.13, con sus tests, contra el fork `018b419`.
   Resultados arriba.
3. **g 1.1** (18/10, #128): «atacar ahora» en la hoja, el golpe que sobra y los 14 hallazgos de Codex en #117.
   Resultados arriba. **g 1.1.1** (19/10): los 4 últimos hallazgos de Codex en #128 y el Jungle Totem de la
   verificación del Coordinador.
4. **La app acepta g:** los códigos, el filtro de la cola, los avisos, las partidas contra el bot y las tools (riesgo
   medio). Ahí vuelven g1 y g2 a las partidas doradas, que g 1.1 dejó afuera.
5. **La carrera** (punto 6) y la herramienta de la liga, con las primeras mediciones.
6. **Línea 2, sin trampa:**
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
7. **Línea 3, los pesos:**
   - CMA-ES sobre `GParams`, con un subcomando de engine-cli que corre afuera de la app;
   - la nota es el porcentaje contra la liga, con semillas comunes y mazos fijos;
   - **sin sobreajuste** (revisión de #111): el afinado elige con unas semillas y unos mazos, y la nota que vale (el
     criterio, el intervalo y el Elo) sale de otra liga, con semillas nuevas y, si se puede, otras listas, con los
     `GParams` ya fijos. Elegir sobre las mismas partidas que dan el intervalo lo deja angosto de más;
   - los torneos quedan como control.
8. **Línea 4, la red:** primero el diseño:
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

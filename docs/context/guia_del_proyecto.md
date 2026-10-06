# Guía del proyecto · Pokémon TCG Pocket

Actualizada el 6 de octubre de 2026. Es el contexto de trabajo para cualquier chat de este proyecto: qué hay, cómo leer la colección de Santi, cómo se valida un mazo, de dónde salen los datos y en qué estado quedó todo. Leer antes de armar o revisar mazos.

## 1. Qué hay y dónde

| Qué | Dónde | Para qué sirve |
|---|---|---|
| Colección de Santi | `tcgcollectiontracterexport.csv`, en los archivos del proyecto | Inventario de cartas. Ver la sección 2 y el aviso de la sección 6. |
| Los 40 mazos y la selección de 25 | Documento «Mazos TCG Pocket – selección de 25»: https://claude.ai/code/artifact/a1e2b8ac-a9a0-453e-b1da-fe4ebbd6e6fd | Fuente de verdad de las listas. Tiene una pestaña «Registro de partidas» para anotar victorias y derrotas. |
| Copia de esas 40 listas | `claude/mazos_40_listas.md` | Instantánea del 5/10/2026 para consultar sin abrir el documento. |
| Diez barajas por tipo, revisión 5 | `claude/10_barajas_pocket_revision_v5.md` | Detalle, evidencia y alternativas de los mazos 1 a 10. |
| «Decklists definitivos – TCG Pocket» | https://claude.ai/code/artifact/509da7a0-5252-4fd6-bfea-766ccc55c33d (también enlazado como https://claude.ai/artifact/AxNuVmiBDdQCVSLkwkPnkC) | Documento del 1/10/2026 con 27 mazos, hecho con una exportación anterior. Origen de los mazos 13–15, 18–23, 26 y 30–39 y base del 24. Quedó superado por el de 40. |

Cuando haya que cambiar una lista, se edita el documento de los 40 mazos y después se actualiza la copia `claude/mazos_40_listas.md`. No se crea un documento nuevo salvo que Santi lo pida.

## 2. Cómo leer la colección

El CSV sale de la app de seguimiento de colección (TCG Pocket Collection Tracker). Columnas: `Id` (expansión-número, por ejemplo `B3-81`), `CardName` (nombre en español), `InternalId`, `NumberOwned`, `Expansion`, `Pack`, `Rarity`, `Collected`. Hay una fila por edición de cada carta, y eso tiene tres trampas:

1. **Reimpresiones que comparten `InternalId`.** Los sets A4b y B4b reimprimen cartas de sets anteriores. Esas filas repiten el `InternalId` y el `NumberOwned` de la original: son las mismas copias, no copias extra. Ejemplo: `A4b-1` Bulbasaur y `A1-1` Bulbasaur tienen el `InternalId` 65600. Antes de sumar, quedarse con una sola fila por `InternalId`.
2. **Otras ediciones de la misma carta con `InternalId` propio.** Las versiones ☆, ☆☆, ☆☆☆, ✵, ✵✵ y Crown Rare tienen su propia fila y su propio `InternalId`, pero en juego son la misma carta. Esas sí se suman. Ejemplo: Mega-Mawile ex `B2-113` (1 copia) y `B2-201` (1 copia) dan 2 Mega-Mawile ex jugables. Pasa lo mismo con la segunda tanda de B4b (de `B4b-237` en adelante), que repite cartas con otro `InternalId` y su propia cantidad: Globito `B3b-64` (1) más `B4b-372` (2). Ante la duda, confirmar que el texto de las dos ediciones sea idéntico.
3. **Mismo nombre, carta distinta.** Varias cartas comparten nombre y tienen texto diferente: Riolu `A2-91` y `B3-79`, Dratini `A1-183` y `B4-116`, Magnezone `A2-53` y `B1a-26`, los distintos Furfrou, Oricorio, Eevee o Silvally. El límite de 2 por nombre las cuenta juntas, pero no son intercambiables. Por eso las listas llevan siempre el código.

La unidad correcta es la **carta funcional**: mismo nombre y mismo texto de reglas. Para agrupar bien, comparar el texto de la carta en Limitless o usar el campo `alternate_versions` del `cards.json` del repositorio `marcelpanse/tcg-pocket-collection-tracker`.

Otras cosas a tener en cuenta:

- **Correcciones dichas por Santi que pisan al CSV:** tiene 2 Latias (`A4a-36`) y 2 Latios (`A4a-37`). La exportación marca 3 y 1. Si Santi corrige otra cantidad, se anota acá y se aplica como ajuste manual.
- **Las copias no se reparten entre mazos.** La misma carta puede estar en todos los mazos que haga falta; cada mazo se valida solo contra la colección.
- Las promos están en `P-A` y `P-B`. Poké Ball, Investigación de Profesores, Velocidad X, Poción, Tarjeta Roja y Pokédex son `P-A`.
- Limitless usa los nombres en inglés y el CSV en español: cruzar siempre por código, no por nombre.

## 3. Reglas que debe cumplir una lista

- 20 cartas exactas.
- Máximo 2 cartas con el mismo nombre, sumando todas las ediciones. «Umbreon» y «Umbreon ex» son nombres distintos.
- Al menos un Pokémon Básico, y cada evolución con su línea previa o con Caramelo Raro que la justifique.
- Energías coherentes con los costos de ataque del mazo.
- Todas las cartas en la colección, contadas por carta funcional y con las correcciones de la sección 2.
- Recordar los puntos: se gana con 3. Un Pokémon común entrega 1, un ex entrega 2 y un Megaevolución ex entrega 3, o sea que perderlo termina la partida.

La validación se hace con un script, no a ojo, y la respuesta dice que se hizo. Si a una lista de torneo le falta una carta, se propone el mejor reemplazo que Santi sí tiene y se aclara cuál es y qué datos lo respaldan, si hay.

Durante el evento «Deluxe Pack: Mega» hubo una regla extra de 8 cartas del tipo por mazo. Santi ya completó esas misiones, así que no rige más.

## 4. Datos de torneo: fuentes y método

Fuente principal: **Limitless**.

- Texto de las cartas por expansión: `https://pocket.limitlesstcg.com/cards/<SET>?display=text&show=all`. Carta individual: `https://pocket.limitlesstcg.com/cards/<SET>/<N>`.
- Arquetipos del formato: `https://play.limitlesstcg.com/decks?game=POCKET`. Página de un arquetipo: `https://play.limitlesstcg.com/decks/<slug>?game=POCKET&format=standard&set=<SET>`.
- Torneos terminados: `https://play.limitlesstcg.com/tournaments/completed?game=POCKET`. Para bajar las listas con su récord: `/api/tournaments?game=POCKET` y `/api/tournaments/<id>/standings`.

Base usada hasta ahora: 151 torneos del formato B4a, del 27 de agosto al 5 de octubre de 2026, con 11.975 listas y sus victorias, derrotas y empates.

Cómo leer esos números:

- El promedio de todas las listas en ese cálculo es **46,7 %**, no 50 %, porque cuenta empates y derrotas por abandono. Los porcentajes salen uno o dos puntos por debajo de los que publica el sitio. Un mazo por encima de 48 % está arriba de la media.
- **Lista exacta** es el récord de las listas con las mismas 20 cartas por nombre, sin mirar la edición. **Arquetipo** es el de todas las listas de ese mazo, que no siempre coinciden con la de Santi.
- Con menos de 30 listas el dato orienta, pero no prueba nada. Decirlo cada vez.
- Antes de citar números, verificar cuál es el formato vigente: el juego saca expansiones seguido y la base de arriba envejece. La colección ya incluye B4b (Deluxe Pack: Mega).

Consultas que dieron buen resultado: récord de una lista exacta; récord de un arquetipo con y sin una carta puntual (por ejemplo, 1 o 2 copias de un Mega); y qué carta única destraba más listas de torneo con la colección actual.

Los scripts y la base descargada de chats anteriores no se conservan entre sesiones. Si hace falta rehacer el análisis: bajar el texto de las cartas, bajar los standings de los torneos del formato, agrupar la colección por carta funcional y recién ahí cruzar.

Fuentes secundarias que se usaron: pocketcards.net (estadísticas por variante; sus datos del formato anterior valen poco hoy), ptcgpocket.gg (listas de la comunidad que Santi trae para revisar, y la página del evento), Game8 y Bulbapedia (misiones en solitario y modos de juego). Ante un conflicto, pesan más los resultados de torneo del formato vigente que la reputación de un mazo o una tier list.

## 5. Estado al 6 de octubre de 2026

- **Lugares en el juego:** Santi puede tener 25 mazos armados. Los mazos 1 a 25 del documento son los recomendados; del 26 al 40 quedan para rotar.
- **Qué busca:** probar variaciones. No todos los mazos tienen que ser competitivos; también juega casual. En su momento pidió tener un mazo Incoloro, uno que mezcle energías y un par sin Pokémon ex.
- **Favoritos:** Cachorros para casual (mazo 21). Hydreigon (19) y Mega-Steelix ex (20) los jugó en casual y le fue bien.
- **Metal:** quiere seguir probando la versión de Mega-Mawile ex con Perrserker de Galar (mazo 8). La de Mega-Mawile ex solo (mazo 39) ya la tiene armada.
- **Plan de prueba:** jugar unas 10 partidas con cada uno de los 40 mazos y anotarlas en «Registro de partidas». Al 6/10 la tabla está vacía. Con 10 partidas por mazo el margen es de unos ±30 puntos: sirve para separar lo muy bueno de lo muy flojo, no para ordenar mazos parejos. Cuando haya resultados, se comparan con los datos de torneo y se rearma la selección.
- **Modalidad para esas partidas:** se le recomendó jugar los 40 mazos en la misma modalidad de encuentro al azar, y que sea Competitiva. Lo único documentado sobre Principiante, Distendida y Competitiva es que son una postura que elige cada jugador; cómo empareja cada una no está documentado en ninguna fuente oficial, y lo demás es deducción.
- **Pregunta abierta:** en el documento hay un comentario sin responder sobre el lugar 25: si se queda Garchomp ex / Mega-Lucario ex o entra Magnezone / Meowscarada (mazo 32), que es sin ex.
- **Cartas que más le convendría conseguir:** Greninja `A1-89`, el segundo Hoopa ex, el segundo Riolu `A2-91`, el segundo Hydreigon, el segundo Milotic ex, Tapu Lele, Capa Hoja y Erika. El detalle está al final de `claude/mazos_40_listas.md`.

## 6. Aviso: el CSV del proyecto está una exportación atrasado

El documento de los 40 mazos se validó el 5/10/2026 contra una exportación más nueva (`tcgcollectiontracterexport_1.csv`) que Santi subió en ese chat y que no quedó guardada en el proyecto. Diferencias comprobadas contra el CSV que sí está en el proyecto:

- Espeon ex `A4-83`: el CSV del proyecto marca 1; la exportación nueva tenía 2. El mazo 12 usa 2.
- Mega-Sharpedo ex `B4-35`: el CSV del proyecto marca 0; la exportación nueva tenía 1. El mazo 17 lo usa.

Puede haber más diferencias que no se ven desde acá. Hasta que Santi suba la exportación actual, tratar el CSV del proyecto como un piso: si una carta de los mazos 12 o 17 aparece como faltante, no es un error de la lista. Cuando suba una exportación nueva, reemplazar el CSV, revalidar los 40 mazos y actualizar esta sección.

## 7. Cómo se entregan las listas

- Nombres de cartas en español, como en el juego, con el código de expansión y número cuando hay más de una edición del mismo nombre.
- Por mazo: energía, Pokémon, Entrenadores, el plan de juego en dos o tres líneas, qué cambió y por qué, y el dato de torneo con su tamaño de muestra.
- Separar lo confirmado por una fuente, lo deducido y lo que no se pudo verificar.
- Fuentes con enlace al final.

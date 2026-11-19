# Dirección D · «Fusión»

**En una línea:** la piel y la forma de usar de B, la respuesta primero de A y los tableros de C, con una regla fija para
que no quede un collage.

Es la dirección que Santi fue armando el 12/11/2026 después de ver A, B y C, y que quedó cerrada en un acuerdo de trece
puntos con el Coordinador (está al final). Sus pedidos: **acción fija**, **el mazo siempre visible**, **el marcador de
C**, **los gráficos** y **el lanzador**; no le molestan los botones sin texto («un simple + alcanza»). La maqueta está en
`d/` y esta es su receta: lo que la maqueta muestra y lo que la implementación tiene que respetar.

El contrato de las maquetas (`ESPECIFICACION.md`: 16 puntos, 18 estados por fragmento, parámetros `tema`, `movimiento` y
`vistas`) vale entero para D. Los datos son solo `../datos.js`.

---

## 1. La regla (vale para todas las pantallas)

Cada pantalla se arma siempre en este orden:

1. **Marcador** (solo donde hay cifras que importan) y **una línea de veredicto**.
2. **Tarjetas** para lo que se toca: la mesa, el sobre recomendado, los trabajos, las preguntas.
3. **Tablas** para lo que se compara: filas planas separadas por líneas, ordenables, con un mini-gráfico por fila.
4. Abajo, **una sola fila fija**: las vistas de esa pantalla a la izquierda y la acción principal a la derecha.

Y dos reglas de color y de números:

- **Un solo color de acento por pantalla.** Los colores de energía se usan únicamente para identificar un mazo (su
  lomo, sus fichas de energía, el tinte de su cabecera). Nada de arcoíris.
- **Tres fuentes, nunca mezcladas.** Mis partidas, torneos y bots llevan cada una su sello: **M**, **T**, **B** (el
  sello va en cada columna o celda; una leyenda por pantalla dice qué es cada uno). Todo porcentaje lleva su **n**
  escrito al lado. «orientativo» es una marca chica cuando n < 30. Sin datos: «sin datos», nunca «0 %». Se ordena por
  una fuente a la vez; no existe un puntaje combinado.

## 2. El marco

### Arriba

- Encabezado de la app como en B (título, y el botón del menú).
- **Lo único fijo arriba, además de ese encabezado, es la cabecera del mazo en su ficha** (punto 3). En todas las demás
  pantallas el marcador y el veredicto se van al desplazar.

### Abajo

- **Barra de pestañas:** Hoy · Mazos · Cartas · Meta · Pruebas, y la **lupa** al final (como en B). La lupa abre el
  lanzador (punto 10). Cada pestaña recuerda dónde estaba; tocarla de nuevo vuelve a su inicio.
- **Fila fija**, justo encima de la barra, de un solo renglón (unos 60 px):

| Pantalla | Vistas (izquierda) | Acción (derecha) |
|---|---|---|
| Hoy | — | «+ Registrar partida», ancho completo |
| Mazos | — | «+ Nuevo mazo», ancho completo |
| Ficha del mazo | Lista · Rinde · Mejorar · Notas | «+» solo (48 × 48), con nombre accesible «Registrar partida con este mazo» |
| Cartas | Sobres · Colección | «Sincronizar», con su ícono y texto |
| Pruebas | Pruebas · Practicar · Motor | «+» solo (48 × 48): «Nueva prueba» |
| Un resultado | — | «Actualizar el mazo #1», con texto |
| Meta | — | «Probar contra el meta», con texto |
| Un arquetipo | — | «+ Registrar contra este», con texto |
| Menú | — | sin fila |

  - Cada segmento de vistas mide 44 px de alto o más y 60 px de ancho o más a 360 px. El «+» mide 48 × 48.
  - La fila se esconde cuando hay una hoja abierta; nunca tapa un campo ni el teclado.
  - Con `vistas=abajo` (lo natural en D) las vistas van en la fila fija. Con `vistas=arriba` pasan a pestañas pegadas
    arriba (en la ficha, debajo de la cabecera del mazo) y la fila fija muestra solo la acción, con texto.
- El contenido deja margen abajo para que nada quede tapado por la fila y la barra.

## 3. La ficha del mazo: el mazo siempre visible

- **Cabecera fija** (se queda al desplazar y en las cuatro vistas): «atrás», ficha de energía, «#1 Butterfree /
  Mega-Sceptile ex» en hasta **dos renglones, nunca cortado con «…»**, y un renglón con las tres fuentes:
  `M 51,1 % n 47 · T 12,5 % n 8 · B 50 % n 14.179`, cada una con su sello y la marca de orientativo si toca. Mide
  **72 px con el nombre en un renglón y 92 px con dos**. Tinte suave del color de energía del mazo.
- **En Lista, arriba de todo y desplazable:** la cabecera grande de B (abanico de arte, «armado · válido · completo ·
  rev. 10», las tres cifras grandes con n e intervalo, dos renglones de nota con «ver más», y los botones «Probar» y
  «Mejoras»). En Rinde, Mejorar y Notas no se repite.
- **Lista:** las dos respuestas («Tu lista: falta 0 · Versión de torneo: faltan 0») con el enlace al sobre cuando falta
  algo; alternar lista / grilla; filas densas de C (cantidad, miniatura, nombre, etapa · código, ficha de energía,
  puntos). Tocar una carta abre la ficha única de carta, con sus ediciones adentro.
- **Rinde:** línea de veredicto de A («Parejo en tus partidas: …»); «Tres fuentes · nunca se mezclan», cada una con su
  sello, %, n, récord, intervalo y una barra de 0 a 100 con la marca del 50 %; **por rival** como tabla larga (una
  columna ordenable con su mini-gráfico: cuota, M o T; las otras, con intervalo y récord, al tocar la fila); la curva
  semanal de A, con el número escrito y el tamaño del punto por partidas; «¿Importa empezar?» con su oración y dos
  barras.
- **Mejorar:** como en B (¿juego la versión de torneo?, ¿qué le cambio?, ¿en qué turno está listo?, mano inicial), con
  las fichas «+1 / −1» y los botones que lanzan pruebas.
- **Notas:** notas enteras, «Editar las notas», revisiones y cambios.

## 4. Hoy

Orden, de arriba hacia abajo:

1. **Marcador** de cuatro celdas con su mini-gráfico: HOY 2–7 (barra V/D) · RACHA 5 D (puntos) · SEMANA 36,4 % n 33
   (intervalo) · RANGO 1.280, Master Ball. Tocar una celda abre su evidencia en una hoja (la semana anterior, el
   intervalo, la temporada, el récord). Reemplaza al bloque «Cómo venís» de B, que **no va**.
2. **Fichas de plazo** de B (promo, evento, y «Abrir · Paradox Drive») cuando hay algo vivo.
3. **La mesa** de B: los mazos de la sesión, cada uno con su lomo de energía, miniaturas, «Hoy 0 V · 5 D», los puntos
   de la racha y **V / D / E**. Un toque abre la hoja con el mazo y el resultado puestos y el rival a mano; **no guarda
   sola**. Filas algo más bajas que en B (objetivo: 88 px).
4. **«¿Cuál llevo hoy?»:** la línea de veredicto de A («Tres candidatos, sin un ganador», con su porqué corto) y la
   tabla de los **tres candidatos con las tres fuentes a la vista**: sello, %, n y el mini-gráfico de intervalo de C en
   cada celda. Se ordena tocando el encabezado de una fuente. Tocar una fila la abre en el lugar: intervalo y récord de
   cada fuente, «Abrir la ficha» y «Registrar con este».
5. **Sobre recomendado:** tarjeta con el ticket de B, el porqué y «Ver los números».
6. **Pendientes:** 4 a la vista, con plazo primero, y «Ver los 7».
7. **Novedades del meta:** sube / baja, con su curva.
8. **Últimas partidas:** 3 a la vista y «Ver las 5»; tocar una la abre para corregirla.
9. El aviso de datos de prueba.

Presupuesto de la primera pantalla a 360 × 780: el marcador, las fichas de plazo y la mesa entran enteros, y se ve por
lo menos el encabezado de «¿Cuál llevo hoy?» (lo ideal: sus tres filas). Si no entra, se achica la mesa, no la letra.

## 5. Registrar una partida

La hoja de B (mazos con arte, resultado grande, rival con sugeridos y su nota al elegirlo, quién empezó, cartas que vi
con miniatura y la sugerencia por cartas, modalidad y nota), con la ficha «HOY 2–7» de C en el encabezado.

Al guardar, en la misma hoja: la respuesta compacta de B, con la barra «vos contra lo esperable» de A en «¿Mala
racha?», «Ver el cálculo» plegado, «¿Cambiaste de rango?», «Otra con #1» (V / D / E), «Deshacer» y «Listo». Entra
entera a 360 × 780 si se puede.

**El historial tiene que andar bien** (en B y en C hubo un bug acá): guardar, cerrar con «Listo» o con «atrás» y volver
con «adelante» muestra la partida que se guardó, no suma nada, y «Deshacer» la saca. El enlace directo al estado
guardado deja el récord como lo traen los datos.

## 6. Mazos

Línea de veredicto de A («30 mazos armados; a 6 les falta una carta o dos»), filtro por nombre o número, fichas «Todos
30 · Con partidas 9 · Incompletos 6», encabezado ordenable de C (N.º · Última · n · %) y filas planas con la densidad de
B (unos 52 px, 8 por pantalla): lomo de energía, dos miniaturas, «#N nombre» en hasta dos renglones, la etiqueta «falta
1», y a la derecha `M 51,1 % n 47` con su mini-intervalo o «sin datos».

## 7. Cartas

Vistas Sobres · Colección en la fila fija; la acción es «Sincronizar». **Sin marcador.**

- **Sobres:** tarjeta de veredicto con el ticket de B, los porqués, el 97,9 % y «Ver los números» (hoja con las cuatro
  cifras y las barras contra las alternativas); **fichas de plazo solo si hay uno vivo** (promo, cupón ★★); los
  objetivos en una línea con «Editar»; alternativas como tabla (una columna, puntaje, con barra; tocar abre sus
  números); cartas que faltan con las fichas «comprar · 70 pts» / «abrir sobres» de B; por mazo, los días.
- **Colección:** tarjeta con la última sincronización y «Tracker al día» y «Más acciones» a la vista; el resumen con su
  barra (con 2 o más · con una · faltan); buscar, fichas Todas / Tengo / Me faltan, la expansión; filas con miniatura.

## 8. Pruebas

Vistas Pruebas · Practicar · Motor; la acción es «+» (nueva prueba: abre la hoja con las cuatro preguntas). **Sin
marcador.**

- **Pruebas:** primero el último resultado terminado, como veredicto (A); una **línea de estado del motor solo si hay
  algo corriendo o roto** («Jugando #24 · 64,3 % · 45 tandas en cola»); las cuatro preguntas como fichas de B; la lista
  de trabajos con sus filtros, estado, avance y lo que dio cada uno.
- **Practicar:** jugar contra el bot (lo que está en curso), situaciones y ejercicios.
- **Motor:** el estado del worker como tablero (C), la cola, calibración y análisis.
- **Un resultado (#14):** el titular de B («+16,3 puntos», con «Tu lista» y «La mejor» en barras de intervalo), la
  oración de veredicto, las fichas de cambios, «robusto» y la novedad; «Qué pesa cada carta» con barras; variantes como
  tabla ordenable; lo técnico, plegado. La acción fija es «Actualizar el mazo #1»; «Guardar como mazo nuevo» va en el
  contenido.

## 9. Meta

- **Marcador:** TORNEOS 13 · LISTAS 1.206 · MEDIA 49 % n 6.784.
- **Veredicto** de A («Mega Charizard Y ex Entei ex es lo más jugado: 14,3 %», con su porqué corto) y el evento en curso
  de B si hay uno.
- **«Qué se juega»**, la tabla de C: fichas Todos · Suben · Bajan · Sin armar; **una columna ordenable a la vez**
  (Cuota con barra · 7 días con curva · % de victorias con intervalo y n) elegida tocando el encabezado; ficha de
  energía y la etiqueta «armado #24 / armable / faltan N». Tocar una fila la abre en el lugar: las otras dos cifras,
  «Abrir el arquetipo» y «Probar contra este».
- **Un arquetipo:** marcador TORNEOS 47,9 % n 942 · CUOTA 14,3 % (curva) · VOS 20 % n 15; veredicto; «Jugar contra
  el bot» y «Mi mazo #24» en el contenido; «Mi nota»; matchups como tabla ordenable (peor primero · n · cuota) con su
  mini-intervalo; las listas. La acción fija es «+ Registrar contra este».

## 10. El lanzador

El de C, completo, abierto desde la lupa de la barra (y con «/» en la PC):

- Hoja que sube desde abajo, con el campo **abajo**, cerca del pulgar.
- Encuentra **y ejecuta**: Pantallas, Acciones («Registrar partida con #1…», «Probar #1 contra el meta», «Sincronizar
  la colección», «Nueva prueba»), Mazos, Cartas (**una fila por carta**, con copias jugables y ediciones) y Rivales.
- **Pestañas por tipo con su cantidad** (Todo · Pantallas · Acciones · Mazos · Cartas), que acotan sin escribir más.
- Sin texto: las acciones frecuentes y lo último.
- Una acción navega o abre una hoja ya cargada; las que en la app escribirían muestran el aviso de la maqueta.
- Escape y «atrás» lo cierran; el foco queda atrapado adentro; Enter ejecuta lo resaltado.

## 11. Menú

Como en B: Aspecto (tema oscuro / claro / sistema, movimiento en tres niveles, dónde van las vistas, miniaturas) y los
accesos a Ajustes, Copia de seguridad, Catálogo, Tokens de API, Sesión y Acerca de.

---

## 12. De dónde sale cada pieza

- **Base de código y piel: B** (`b/`): tokens, tipografía (Barlow Semi Condensed e Inter, en `fuentes/`), tarjetas con
  arte, la mesa, la hoja de partida, las fichas de plazo, el ticket del sobre, la barra con la lupa, el menú.
- **De C** (`c/`): el marcador, las tablas ordenables de filas planas con mini-gráfico, los sellos M · T · B, las filas
  densas de cartas, el lanzador, el tablero del motor.
- **De A** (`a/`): la línea de veredicto y su porqué corto, la barra «vos contra lo esperable», la curva semanal, la
  idea de la acción principal en un lugar fijo.

Los tableros de C entran con la tipografía y los tokens de B: no hay rótulos monoespaciados ni aspecto de consola fuera
de las tablas y el marcador.

## 13. Criterios de aceptación (se miden, no se miran a ojo)

1. Los 18 fragmentos abren su estado; `tema`, `movimiento` y `vistas` andan desde la URL y desde el Menú.
2. Las 34 capturas (los 18 estados y sus variantes de tema, ancho y vistas): sin desborde lateral, sin errores de
   consola, sin tocables de menos de 44 px, sin texto de menos de 13 px y sin textos cortados. Datos a 14 px o más.
3. Cabecera fija del mazo: 72 px con un renglón de nombre y 92 px con dos; es lo único fijo arriba además del
   encabezado; en las otras pantallas el marcador se va al desplazar.
4. Fila fija: lo que dice la tabla del punto 2; el «+» mide 48 × 48; se esconde con una hoja abierta; nada queda tapado.
5. Hoy a 360 × 780: marcador, plazos y mesa enteros en la primera pantalla, y al menos el encabezado de «¿Cuál llevo
   hoy?».
6. Las tres fuentes a la vista en los tres candidatos de Hoy, en la cabecera del mazo y en Rinde; una columna ordenable
   en Mazos, Meta, matchups y por rival. Cada columna con su sello y cada % con su n.
7. Historial de la hoja de partida: guardar, cerrar («Listo» y «atrás»), «adelante» y «Deshacer» dejan el récord como
   al principio; nunca se suma una partida sin guardar.
8. Lanzador: «mega» muestra sus grupos; las pestañas filtran; tocar o Enter ejecuta; Escape y «atrás» cierran.
9. Contraste AA en oscuro y en claro; foco visible; pestañas y hojas con su patrón de teclado.
10. Todo texto y todo número sale de `datos.js`.

## 14. El acuerdo de trece puntos (12/11/2026, Coordinador y Nube-Interfaz)

Vale para la maqueta y para la implementación.

1. Cada pantalla: una línea de veredicto, tarjetas para lo que se toca y tablas para lo que se compara.
2. Fijo arriba, solo la cabecera del mazo en su ficha; en el resto, el marcador se va al desplazar.
3. La mesa son dos toques: V / D / E abre la hoja con el mazo y el resultado puestos y el rival a mano. Nunca guarda
   sola.
4. Un solo color de acento por pantalla; los colores de energía solo identifican mazos.
5. Tres fuentes, nunca mezcladas: se ordena por una a la vez y no existe un puntaje combinado.
6. En lo técnico, el inicio y Pruebas piden resúmenes, y nada pesado se consulta en bucle (R-014).
7. Primero la maqueta; después, la implementación por fases.
8. Las tres fuentes a la vista donde hay pocas filas (los tres candidatos de Hoy, la cabecera del mazo y Rinde), cada
   columna con su sello y el n junto al %. En las listas largas (Mazos, Meta, matchups y por rival), una columna
   ordenable con su mini-gráfico, y las otras al tocar la fila.
9. Marcador solo en Hoy, la ficha del mazo, Meta y el arquetipo. En Cartas, veredicto y fichas de plazo solo si hay un
   plazo vivo; en Pruebas, veredicto y una línea de estado del motor solo si algo corre o está roto.
10. Tocables de 44 × 44 px o más; el «+» mide 48 × 48.
11. La cabecera fija del mazo mide 72 px (nombre en un renglón) o 92 px (dos), y es lo único fijo arriba además del
    encabezado.
12. El lanzador va completo en la maqueta; en la app entra en dos pasos (fase 1b): primero la búsqueda con sus pestañas
    por tipo y las acciones que solo navegan o abren una hoja con los datos puestos; después, las acciones que
    escriben, con confirmación y sobre los endpoints que ya existen. El índice sale de la caché del cliente y de
    `GET /api/search`, sin bajar listas enteras.
13. La D es completa: los 18 estados, sobre el código de B, con el marcador, las tablas y el lanzador de C.

Fases de la implementación, después del visto bueno de Santi a la maqueta (antes de la fase 0 se avisa al
Coordinador): **0** base (tokens, tipografía, marco), **1** componentes (marcador, tablas, sellos, fila fija; **1b** el
lanzador), **2** Hoy y la hoja de partida, **3** la lista de mazos y la ficha, **4** Cartas, Meta y Pruebas.

## 15. Lo que se midió y las excepciones declaradas (16/11/2026)

Los diez criterios del punto 13 pasan, medidos en Chromium emulando 360 × 780 con toque (también 412 × 915, 1280 × 800,
tema claro y los tres niveles de movimiento). No se probó en un teléfono real.

| Criterio | Medido |
|---|---|
| 1 · Estados y parámetros | 130 de 130 comprobaciones; lo elegido en el Menú se conserva al volver. |
| 2 · Capturas | 34 de 34 sin nada que informar; ningún texto bajo 13 px a 360, 412 y 1280. |
| 3 · Cabecera fija del mazo | Los 30 mazos a 360 px: 72 px (18) o 92 px (12); a 412 px, 72 px los 30. |
| 4 · Fila fija | 60 px en todas las pantallas menos el Menú; «+» de 48 × 48; oculta con una hoja abierta. |
| 5 · Hoy a 360 × 780 | Marcador 58–144, plazos 154–198, mesa 232–508, encabezado de la tabla 593–638; fila fija en 654. |
| 6 · Tres fuentes | A la vista en Hoy, la cabecera y Rinde; una columna a la vez en Mazos, Meta, matchups y por rival. |
| 7 · Historial de la hoja | 89 de 89, con movimiento expresivo y sin movimiento; dobles toques, 729 comprobaciones. |
| 8 · Lanzador | «mega»: 2 pantallas, 2 acciones, 2 mazos, 3 cartas y 9 rivales; Enter, tocar, Escape y «atrás». |
| 9 · Contraste y teclado | 5.888 textos medidos en los dos temas, el más bajo 4,56 : 1; teclado 91 de 91. |
| 10 · Datos | Todo número en pantalla está en `datos.js` (salvo el 95 de «IC 95 %» y una suma de dos datos). |

Excepciones que la maqueta declara (la implementación las hereda o las resuelve):

- **Hoy:** las tres filas de «¿Cuál llevo hoy?» quedan debajo de la fila fija en la primera pantalla (empiezan en 638 px);
  se ve su encabezado. Mostrarlas pediría achicar la mesa.
- **Menos de 320 px de ancho** (el zoom de la página al 130 % deja 277 px): la cabecera fija del mazo mide 92 o 112 px,
  porque las tres fuentes necesitan 298 px a 14 px y pasan a dos renglones antes que achicar la letra. De 320 px para
  arriba mide 72 o 92 px.
- **Menos de 360 px de ancho:** un nombre de mazo puede empezar su segundo renglón con «/» o con «ex».
- **Movimiento «expresivo»:** mientras una hoja entra (260 ms; 150 ms con «sutil»), un toque sobre lo que la hoja trae
  no acciona. Evita que el segundo toque de un doble toque caiga en un botón que recién aparece.
- **Mazos:** el sello M va en el segundo renglón de la celda (90 px de ancho); el encabezado de la columna sí lo lleva.
- **Miniaturas que no cargan:** en los recuadros chicos (hasta 58 px de ancho: las filas de cartas, el lanzador, el
  abanico de la ficha y las filas de Mazos) va el símbolo del tipo, con el nombre escrito al lado. En la mesa, el
  recuadro lleva el primer nombre solo si entra entero (#1 y #14 sí, #86 no). En la grilla y en la ficha de carta, el
  recuadro lleva el nombre.
- **Solo el mazo #1 tiene la ficha completa:** `datos.js` trae las cuatro vistas enteras de ese mazo.
- **La visita:** las partidas guardadas viven en `sessionStorage` y se leen solo al recargar o al volver con «atrás».
- **«¿Mala racha?»:** «esperable 40,7 %» va con su sello T y sin n, porque `datos.js` trae ese número solo dentro de
  la oración del veredicto.
- **Textos que vienen así en `datos.js`:** «1 cruces fallaron», en el trabajo #6, copia el aviso que hoy escribe la
  app. La cuota de un arquetipo es distinta en Novedades (los últimos días) y en Meta (la era): Mega Mewtwo X ex Mew ex
  figura con 3,2 % y con 6,2 %.

Pendientes de decisión (Santi o el Coordinador), sin cambiar hasta entonces:

- Motor usa el marcador (worker · jugando · cola), aunque el punto 8 dice «sin marcador» en Pruebas: el mismo punto
  pide el estado del worker como tablero.
- El filtro de Mazos está en el encabezado y no después de la línea de veredicto: así entran ocho filas a 360 × 780.
- El degradado del ticket del sobre y las fichas de plazo en ámbar conviven con el acento de la pantalla en Hoy y en
  Sobres: son la piel de B.

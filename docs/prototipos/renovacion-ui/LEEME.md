# Maquetas de la renovación de la interfaz

Cuatro direcciones de diseño para la PWA, como prototipos navegables y aislados: HTML, CSS y JavaScript planos, sin
compilar y sin tocar `apps/web`. A, B y C son el material para elegir una dirección (paso 4 del pedido de Santi del
11/11/2026); D es la fusión que salió de esa comparación (paso 5). La implementación viene después del visto bueno de
Santi a D.

| Carpeta | Dirección | Idea |
|---|---|---|
| `a/` | A · La respuesta primero | Cada pantalla abre con un veredicto y su porqué; la evidencia va en vistas cortas y la acción principal queda abajo, sobre la barra. |
| `b/` | B · El mazo al centro | Todo parte de los mazos que se vienen jugando: una mesa con Victoria / Derrota / Empate y una ficha de mazo que funciona como taller. |
| `c/` | C · Consola de torneo | Tableros densos que se ordenan, con un mini-gráfico al lado de cada número, un marcador arriba y una tecla para buscar y lanzar. |
| `d/` | D · Fusión | La piel y la forma de usar de B, la respuesta primero de A y los tableros de C, con una regla fija por pantalla: veredicto, tarjetas para lo que se toca, tablas para lo que se compara y una sola fila fija abajo con las vistas y la acción. Receta y acuerdo en `DIRECCION-D.md`. |

## Cómo abrirlas

Con doble clic en `a/index.html`, `b/index.html`, `c/index.html` o `d/index.html` (andan desde el disco, sin
servidor). Están pensadas para el celular: en el navegador de la PC conviene la vista de dispositivo a 360 × 780.

Las cuatro responden a las mismas direcciones, que abren cada estado directo (`ESPECIFICACION.md` tiene la tabla
completa): `#/hoy`, `#/hoy?hoja=partida`, `#/mazos`, `#/mazo/1`, `#/mazo/1/rinde`, `#/cartas`, `#/cartas/coleccion`,
`#/pruebas`, `#/pruebas/resultado/14`, `#/meta`, `#/meta/arquetipo` y `#/menu`. Los parámetros `tema=oscuro|claro`,
`movimiento=expresivo|sutil|ninguno` y `vistas=arriba|abajo` fuerzan el aspecto; también se cambian desde el Menú.

## Qué muestran y qué no

- **Las mismas pantallas, los mismos datos y las mismas medidas** en las cuatro: inicio, registrar una partida
  (abierta, lista, guardada), buscador, lista de mazos, ficha del mazo #1 con sus cuatro vistas, Sobres, Colección,
  Pruebas y un resultado, Meta y un arquetipo, y el Menú.
- **Los datos están en `datos.js`**, uno solo para las cuatro. Salen de una réplica local de la app: los mazos y la
  colección son los de Santi; las partidas (y sus récords, rachas y semanas), el rango, las notas por rival, los
  torneos, las simulaciones y las pruebas son inventados para las maquetas, y cada maqueta lo dice en pantalla. No
  lleva partidas ni rangos reales, cuentas, ids de amigo ni nombres de jugadores.
- **Las miniaturas de cartas son enlaces** a las imágenes del tracker, como en la app; ninguna imagen está en el repo.
  Si no cargan, cada maqueta dibuja un reemplazo con el color del tipo.
- **No son la app**: no hablan con la API, no guardan nada (salvo el aspecto elegido, en el navegador; D recuerda
  además las partidas cargadas mientras dura la pestaña, para que recargar no las pierda) y varias acciones secundarias
  solo muestran un aviso. Quedaron sin maqueta el historial y las estadísticas de partidas, el resumen semanal,
  «Importar desde la hoja», la suerte de los sobres, el intercambio, pokemon-zone, las misiones, las notificaciones,
  armar desde un núcleo, el editor de mazos y la mesa de juego: van a tener su lugar en el diseño final.
- Las fuentes de B, C y D (`b/fuentes`, `c/fuentes`, `d/fuentes`) son OFL 1.1 y van con su licencia
  (`docs/LICENCIAS.md`).

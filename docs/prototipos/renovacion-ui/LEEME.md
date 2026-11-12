# Maquetas de la renovación de la interfaz

Tres direcciones de diseño para la PWA, como prototipos navegables y aislados: HTML, CSS y JavaScript planos, sin
compilar y sin tocar `apps/web`. Son material para elegir una dirección (paso 4 del pedido de Santi del 11/11/2026); la
implementación viene después de esa elección.

| Carpeta | Dirección | Idea |
|---|---|---|
| `a/` | A · La respuesta primero | Cada pantalla abre con un veredicto y su porqué; la evidencia va en vistas cortas y la acción principal queda abajo, sobre la barra. |
| `b/` | B · El mazo al centro | Todo parte de los mazos que se vienen jugando: una mesa con Victoria / Derrota / Empate y una ficha de mazo que funciona como taller. |
| `c/` | C · Consola de torneo | Tableros densos que se ordenan, con un mini-gráfico al lado de cada número, un marcador arriba y una tecla para buscar y lanzar. |

## Cómo abrirlas

Con doble clic en `a/index.html`, `b/index.html` o `c/index.html` (andan desde el disco, sin servidor). Están pensadas
para el celular: en el navegador de la PC conviene la vista de dispositivo a 360 × 780.

Las tres responden a las mismas direcciones, que abren cada estado directo (`ESPECIFICACION.md` tiene la tabla
completa): `#/hoy`, `#/hoy?hoja=partida`, `#/mazos`, `#/mazo/1`, `#/mazo/1/rinde`, `#/cartas`, `#/cartas/coleccion`,
`#/pruebas`, `#/pruebas/resultado/14`, `#/meta`, `#/meta/arquetipo` y `#/menu`. Los parámetros `tema=oscuro|claro`,
`movimiento=expresivo|sutil|ninguno` y `vistas=arriba|abajo` fuerzan el aspecto; también se cambian desde el Menú.

## Qué muestran y qué no

- **Las mismas pantallas, los mismos datos y las mismas medidas** en las tres: inicio, registrar una partida (abierta,
  lista, guardada), buscador, lista de mazos, ficha del mazo #1 con sus cuatro vistas, Sobres, Colección, Pruebas y un
  resultado, Meta y un arquetipo, y el Menú.
- **Los datos están en `datos.js`**, uno solo para las tres. Salen de una réplica local de la app (la copia de seguridad
  del 11/11/2026 más datos de prueba): los torneos, las simulaciones y parte de las partidas son de prueba. No lleva
  cuentas, ids de amigo ni nombres de jugadores.
- **Las miniaturas de cartas son enlaces** a las imágenes del tracker, como en la app; ninguna imagen está en el repo.
  Si no cargan, cada maqueta dibuja un reemplazo con el color del tipo.
- **No son la app**: no hablan con la API, no guardan nada (salvo el aspecto elegido, en el navegador) y varias acciones
  secundarias solo muestran un aviso. Quedaron sin maqueta el historial y las estadísticas de partidas, el resumen
  semanal, «Importar desde la hoja», la suerte de los sobres, el intercambio, pokemon-zone, las misiones, las
  notificaciones, armar desde un núcleo, el editor de mazos y la mesa de juego: van a tener su lugar en el diseño final.
- Las fuentes de B y C (`b/fuentes`, `c/fuentes`) son OFL 1.1 y van con su licencia (`docs/LICENCIAS.md`).

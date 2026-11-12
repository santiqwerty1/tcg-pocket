# Maquetas de la renovación de la interfaz (11–12/11/2026)

Tres maquetas navegables de la **misma app con los mismos datos**, para que Santi elija una dirección. Son prototipos
aislados: HTML, CSS y JavaScript sin compilar, sin dependencias, fuera del build de la app (`docs/` no entra en el lint
ni en Vite). No reemplazan nada: la app real sigue en `apps/web`.

- `a/` · **La respuesta primero** — cada pantalla abre con un veredicto y su porqué; evidencia en vistas cortas.
- `b/` · **El mazo al centro** — el inicio es la mesa con los mazos de la sesión; cada mazo es un taller.
- `c/` · **Consola de torneo** — tableros densos y ordenables con mini-gráficos; lanzador al alcance del pulgar.
- `datos.js` — los datos compartidos (`window.DATOS`). **Las tres maquetas muestran estos datos y ningún otro.**

## Lo que vale para las tres (decidido por Santi)

1. Celular primero: **360×780 px** (Galaxy S25). Tiene que verse bien también a 412×915 y, «prolija», a 1280×800
   (columna centrada de hasta 480 px con la barra abajo; sin maqueta propia de escritorio).
2. **Tema oscuro por defecto**, claro disponible (selector Oscuro / Claro / Sistema en el menú → Aspecto). Contraste AA
   en los dos: texto ≥ 4,5:1, texto grande e íconos ≥ 3:1, bordes de controles ≥ 3:1.
3. Barra inferior: **Hoy · Mazos · Cartas · Meta · Pruebas**. Ajustes y sistema en un menú del encabezado. Cada pestaña
   recuerda dónde estaba; un segundo toque vuelve al inicio de la sección.
4. Buscador/lanzador **cerca del pulgar**, que encuentra pantallas, acciones, mazos y cartas (una fila por carta).
5. Inicio = **resumen del día**: los **3 mejores mazos sin ganador**, cada uno con sus tres números (torneo, mis
   partidas, laboratorio) igual de visibles y ordenables por fuente; el sobre recomendado con su porqué; pendientes;
   novedades del meta; cómo vengo. **Registrar partida a un toque.**
6. Hoja de partida: mazo (cambio en un toque entre los 2–3 recientes), resultado, y a la vista **rival, quién empezó y
   cartas que vi**; modalidad y nota secundarias. Al guardar, **la respuesta ahí mismo**: deshacer, veredicto «¿mala
   racha?», cambio de rango; y lista para otra. Enter en un campo nunca guarda. Nada fijo tapa un campo.
7. Ficha del mazo con vistas **Lista · Rinde · Mejorar · Notas**. Arriba de Lista: «Tu lista: falta N · Versión de torneo:
   faltan N» con enlace al sobre. Notas resumidas en 2–3 líneas en la cabecera con «ver más». Acciones a mano: registrar
   partida con este mazo, probar contra el meta, buscar mejoras.
8. Cartas = Sobres + Colección. Sobres abre con **el veredicto y el porqué**, 2–3 alternativas, los números al tocar, los
   objetivos resumidos en una línea editable. Colección: **Sincronizar** como acción principal, «Tracker al día» a mano,
   el resto en «Más acciones».
9. Pruebas = Simulación + Laboratorio en una sección **por pregunta**: «¿Cómo rinde contra el meta?», «¿Qué le cambio?»,
   «Mazo contra mazo», «¿En qué turno está listo?»; la lista de trabajos dice **qué dio cada uno**; «Motor» aparte
   (workers, cola, calibración, análisis); «Practicar» (jugar contra el bot, situaciones, ejercicios).
10. Meta = torneos y eventos: qué se juega (cuotas con tendencia), qué tengo armado o puedo armar, y un arquetipo con
    sus matchups **ordenados del peor al mejor**.
11. Porcentajes: en listas, **% y n** (marca chica para «orientativo», n < 30, y leyenda una vez por tabla); IC 95 % y
    récord al tocar la fila; en fichas, todo a la vista. Mis partidas, torneo y simulación **nunca** se mezclan en un
    número, y cada uno dice su fuente. Sin datos: «sin datos», nunca «0 %».
12. Datos a **14 px o más**; todo lo tocable de **44×44 px o más**; filas enteras tocables. Nombres de mazo con su
    «#número», en hasta dos líneas: **nunca cortados con «…»**.
13. **Sabor a TCG sin el arte del juego**: fichas redondas de energía con **ícono propio** (símbolos genéricos dibujados
    para la app, en SVG), miniaturas de cartas donde ayudan (enlaces a las imágenes del tracker, con reemplazo cuando no
    cargan: recuadro con el nombre y el color del tipo), formas y movimiento. Sin logos, tipografías ni arte de Pokémon.
14. **Gráficos** chicos con el número escrito al lado (barras, tendencia, intervalo, distribución, curva).
15. **Movimiento** con tres niveles (Expresivo / Sutil / Ninguno) en el menú → Aspecto, y `prefers-reduced-motion`
    fuerza «Ninguno».
16. «Atrás» del sistema cierra la hoja abierta. No se desliza de costado entre vistas.

## Pantallas y estados (mismo contrato de direcciones en las tres)

Cada maqueta es `index.html` y navega con el fragmento de la URL. Todas aceptan además los parámetros
`tema=oscuro|claro`, `movimiento=expresivo|sutil|ninguno` y `vistas=arriba|abajo` (dónde va el cambio de vista de la
ficha del mazo: cada dirección tiene su opción natural y la otra se ve con el parámetro).

| Fragmento | Qué muestra |
|---|---|
| `#/hoy` | Inicio: resumen del día |
| `#/hoy?hoja=partida` | Hoja de partida recién abierta (mazo puesto, sin resultado) |
| `#/hoy?hoja=partida&estado=lista` | Hoja completa: Derrota, rival elegido, empezó el rival, 2 cartas vistas |
| `#/hoy?hoja=partida&estado=guardada` | Después de guardar: deshacer, veredicto de racha, cambio de rango, otra partida |
| `#/hoy?hoja=buscar` | Buscador/lanzador abierto con resultados de «mega» (pantallas, acciones, mazos, cartas) |
| `#/mazos` | Lista de mazos (30 armados; buscar, ordenar, filtros) |
| `#/mazo/1` | Ficha del mazo, vista Lista |
| `#/mazo/1/rinde` | Vista Rinde (tres fuentes, por rival, curva, empezar o ir segundo) |
| `#/mazo/1/mejorar` | Vista Mejorar (versión de torneo, última búsqueda, consistencia, mano inicial; lanzar pruebas) |
| `#/mazo/1/notas` | Vista Notas (notas enteras, revisiones y cambios) |
| `#/cartas` | Sobres: veredicto, alternativas, objetivos resumidos, cupón y promo con plazo, cartas que faltan |
| `#/cartas?detalle=sobre` | Los números del sobre recomendado, al tocarlo |
| `#/cartas/coleccion` | Colección: sincronizar, resumen, buscar, lista con miniaturas |
| `#/pruebas` | Pruebas: las cuatro preguntas y la lista de trabajos con lo que dio cada uno |
| `#/pruebas/resultado/14` | Un resultado: búsqueda de variantes del mazo 1 |
| `#/meta` | Meta: qué se juega, con tendencia y qué tengo |
| `#/meta/arquetipo` | Un arquetipo: récord, mis partidas contra él, mi nota, matchups del peor al mejor |
| `#/menu` | Menú: Aspecto (tema, movimiento), y accesos a Ajustes, Copia de seguridad, Catálogo, Tokens, Sesión, Acerca de |

Interacción mínima que tiene que andar de verdad: la barra inferior, abrir y cerrar la hoja de partida (también con
Escape y con «atrás»), elegir resultado / rival / quién empezó, guardar y deshacer, cambiar de vista en la ficha del
mazo, ordenar los 3 mazos del inicio por fuente, tocar una fila para ver IC y récord, abrir los números del sobre,
escribir en el buscador, cambiar tema y movimiento. Lo demás puede ser estático.

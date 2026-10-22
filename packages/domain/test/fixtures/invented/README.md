# Fixtures inventados

**No son datos reales.** Se arman a mano para probar algo antes de que existan los datos de verdad, y cada uno lo dice en
su primer campo (`_inventado`). Cuando lleguen los reales, se reemplazan por un fixture de la carpeta de al lado y se
borran.

| Archivo | Qué prueba | Qué es real | Reemplazarlo cuando |
|---|---|---|---|
| `c1-dual-type.json` | El tipo como lista (C1 «Dual Fusion», 29/10/2026): tres cartas del tracker y del motor, con los dos tipos escritos de tres maneras (lista, texto con «/», campo aparte) | Los nombres y los dos tipos de Mega Mewtwo X ex (Psíquico/Lucha) y Mega Greninja ex (Agua/Oscuridad), anunciados en ptcgpocket.gg/c1 | El tracker y deckgym carguen C1: hay que copiar las filas reales y quitar las formas que no usaron |

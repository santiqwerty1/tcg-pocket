---
seccion: C1 «Dual Fusion», catálogo (29/10/2026)
---
| **El catálogo lee `secondary_energy` del tracker como el segundo tipo** (tracker 9fafc07: Mega Greninja ex agua/siniestro y Mega Mewtwo X ex psíquico/lucha, 7 ediciones), junto con `energy` y con las mismas reglas que `parseTrackerEnergy` (un tipo repetido, uno desconocido, un tercero o un entrenador con segundo tipo fallan). | El tracker eligió un campo aparte en vez de la lista que ya leíamos; sin leerlo, las 7 ediciones entraban con un solo tipo. |

---
seccion: La mudanza del chat al hub (D-030, 18/10/2026)
---
| **Una exportación que pasa el tope total (30 millones de caracteres) llega hasta el tope:** la página que lo pasaría queda afuera, lo que llegó se aplica como está, y la vista previa dice desde qué id seguir con `--despues`. Si la primera página sola pasa el tope, se rechaza. | Antes se rechazaba entera, y `--despues` no alcanzaba para partirla porque no hay un id final: una sala grande no se podía traer de vuelta (Codex en #123). Las páginas van por id, así que lo que llegó es una parte entera. |
| **Los participantes de una exportación son los de su última página**, no la unión de todas; las salas siguen juntándose (gana la última). | Cada página trae la lista completa: con la unión, un participante borrado durante la exportación volvía con el import (Codex en #123). |

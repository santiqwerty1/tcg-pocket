---
seccion: Organización de las sesiones (D-021)
---
| **Autorrevisión antes de cada PR** con la lista de `docs/REVISION.md` (concurrencia y estados, compatibilidad, tests que fallan sin el arreglo, números con n e IC, textos a 375 px, producción de 512 MB, repo público), resumida en la descripción del PR. | Del 11 al 13/10, casi todos los PR necesitaron dos o tres rondas por los mismos tipos de hallazgo (Santi, 13/10). |
| **Decisiones sin conflictos:** un PR no toca `docs/DECISIONES.md`; deja sus filas sin número en `docs/decisiones/pendientes/<rama>.md` y el Coordinador las numera al integrar (`scripts/decisiones.mjs`). | El 13/10 hubo cuatro rebases solo por la numeración de DECISIONES. |
| **Revisión según el riesgo:** bajo (documentación o textos), el Coordinador lo integra con la CI verde; medio (código común), una revisión; alto (migraciones, cola o workers, concurrencia, seguridad, borrados, CI), revisión y verificación. | Gastar la revisión adversarial donde encuentra bugs, no en cambios de texto. |
| **Las sesiones rotan por tanda,** con un traspaso en la bitácora del día; a Santi se le escribe solo cuando tiene que decidir o hacer algo. | Las sesiones largas no ven las tools nuevas y su contexto comprimido pierde detalle (13/10). |

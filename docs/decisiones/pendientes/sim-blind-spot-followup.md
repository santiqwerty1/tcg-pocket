---
seccion: Fase 37, laboratorio: aceptar sin la suerte que eligió (H-010, 9/10/2026)
---
| **El arquetipo que eligió el mazo vale solo para su lista actual** (H-055, revisión de Codex de #119). En el laboratorio, una snapshot de una revisión anterior toma el arquetipo más cercano de la era. | Cambiar el arquetipo o la lista de un mazo no reescribe sus pruebas viejas, así que un puntaje viejo se compararía con un arquetipo elegido después. |
| **La regla general necesita un puntaje de todos los rivales con mazo jugado:** cobertura completa, además de la ronda entera. En «¿Cuál llevo hoy?», los pesos son los de esos mismos rivales, como en la vista del laboratorio. | Una lista que también es rival del banco no juega contra sí misma, y su puntaje se repesa sobre los demás. Un rival sin mazo jugado no está en el puntaje. |
| **Un evaluador por era y formato** (`TournamentsService.expectationsWith`): lee una sola vez el alcance, los alias y los matchups, y evalúa cualquier arquetipo con cualquier peso. | Con un `expectedWith` por mazo, «¿Cuál llevo hoy?» hacía unas 120 consultas más en cada carga. Eso deshacía lo de H-007. |

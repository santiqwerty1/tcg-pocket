---
seccion: Fase 15: ¿qué mazo llevo hoy? (8/10/2026)
---
| **Una confirmación que falló a medias deja el puntaje de la búsqueda** (revisión de #109): en un trabajo fallado, la lista de partida o la mejor toman el puntaje de la confirmación solo si la confirmación está completa (o si la búsqueda tampoco lo está); si no, el de la búsqueda, que estaba completa, y la lista no queda como «falló». `decks_pick_today` dice por qué no hay puntaje (`labFailed`) y «Reintentar lo que falló» refresca la fila. | Una búsqueda entera no tiene por qué perder su número porque se cortó la confirmación. |

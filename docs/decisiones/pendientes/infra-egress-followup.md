---
seccion: Egress de la base (12/11/2026)
nueva: true
---
| **Una transacción sobre un cliente crudo del pool cuyo `ROLLBACK` falla le pasa el error a `release`, y el pool destruye la conexión** (`rollback` en `prisma/sql.ts`): el reemplazo del catálogo y la importación de la colección (vista previa y aplicación). Un test unitario recorre cada cliente crudo del pool (esos tres y los locks de sesión de las sincronizaciones de ptcgpocket.gg y del tracker) con uno falso cuyo `ROLLBACK` o `unlock` falla. | Revisión de #180: con `min: 1` una conexión ya no se cierra sola, y si el `ROLLBACK` fallara con el socket vivo volvería al pool dentro de la transacción, con `LOCK TABLE … SHARE ROW EXCLUSIVE` y `pg_advisory_xact_lock(994202)` tomados. |

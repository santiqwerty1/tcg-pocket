---
seccion: Egress de la base (12/11/2026)
nueva: true
---
| **La revisión de cada minuto de si otro proceso aplicó un catálogo (#103), el estado de la memoria del catálogo (alertas y `/api/ops/status`) y el commit que repite «Sincronizar» leen solo `id`, `commit_sha` y `applied_at` de la última sincronización aplicada (`CatalogRepository.latestAppliedSyncHead`)**; la fila entera (misiones, informe y huellas de archivos) se lee solo al cargar el catálogo. `/api/catalog/status` tampoco trae las misiones ni las huellas. | Medido en producción el 12/11/2026 con `pg_stat_statements` y bytes por socket: la fila pesaba ~187 KB (las 443 misiones, 179 KB) y se leía ~1.500–2.000 veces por día, unos 270–380 MB por día, casi todo el egress de Supabase de ese momento (270–370 MB por día en el panel; tope de 5 GB por mes). Con la cabecera son ~225 bytes por lectura. |

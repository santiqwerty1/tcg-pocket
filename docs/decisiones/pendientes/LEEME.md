# Decisiones pendientes de numerar

Cada PR deja acá sus decisiones, en `<rama>.md`, con el formato de `docs/REVISION.md`. El Coordinador las numera, las pasa a `docs/DECISIONES.md` al integrar y borra el archivo, con `pnpm decisiones` (con `--check` solo muestra qué haría; la CI lo corre en cada PR). Una sección nueva lleva `nueva: true` en el frontmatter.

<!-- generado por posta: no editar; se regenera con `posta generar` -->

# Límites declarados del proyecto

Declarados en `.posta/config.json` (`reglas`) y aplicados como `permissions` en `.claude/settings.json`: Claude Code los
hace cumplir en sus herramientas de archivo y de shell aunque no leas esto, y el hook `PreToolUse` de Posta revisa además la forma
canónica de cada comando (`git -C . push` es `git push`) y las rutas que menciona (también dentro de un `node -e`). Para
cambiarlos, editá la config y corré `posta generar`; esta copia sólo los explica.

- **No editar** (lo escribe Posta o la persona): `Boveda/Sesiones/**`, `.posta/eventos/**`.
- **Ni leer ni editar** (secretos): `.env`, `.env.local`, `.env.fly`, `~/.posta/claves/**`.
- **Pedir confirmación antes de correr**: `git push *`.

Lo que requiere decisión de la persona se **propone** (`posta accion proponer`), no se ejecuta (DEC-016).

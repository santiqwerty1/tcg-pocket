<!-- generado por posta: no editar; se regenera con `posta generar` -->

# Límites declarados del proyecto

Declarados en `.posta/config.json` (`reglas`) y aplicados como `permissions` en `.claude/settings.json`: Claude Code los
hace cumplir en sus herramientas de archivo y de shell aunque no leas esto, y el hook `PreToolUse` de Posta revisa además la forma
canónica de cada comando (`git -C . push` es `git push`) y las rutas que menciona (también dentro de un `node -e`). Para
cambiarlos, editá la config y corré `posta generar`; esta copia sólo los explica.

- **No editar** (lo escribe Posta o la persona): `Boveda/Sesiones/**`, `.posta/eventos/**`.
- **Ni leer ni editar** (secretos): `.env`, `.env.local`, `.env.fly`, `~/.posta/claves/**`.
- **Pedir confirmación antes de correr**: `git push`, `git push origin`, `git push *HEAD`, `git push * @`, `git push *main*`, `git push -f*`, `git push * -f*`, `git push *-uf*`, `git push *-qf*`, `git push *-vf*`, `git push *--force*`, `git push * +*`, `git push -d*`, `git push * -d*`, `git push *--delete*`, `git push *--prune*`, `git push *--mirror*`, `git push *--all*`, `git push *--receive-pack*`, `git push *--exec*`, `git fetch *--upload-pack*`.

Lo que requiere decisión de la persona se **propone** (`posta accion proponer`), no se ejecuta. Si la persona pide explícitamente
que el agente lo ejecute, va a nombre de ella (`--quien <persona> --registra agente:<nombre>`), y Posta deja en la ficha y en el
evento que lo registró el agente (DEC-016).

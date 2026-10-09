# Mudanza al repo público

Santi eligió (D-022) publicar el código en un **repo nuevo con historial limpio**: un solo commit con el árbol de main, firmado con la dirección noreply de GitHub. El repo privado queda como archivo, con su historial y sus PR.

Este documento es el plan. **Nada de esto se hace sin el OK de Santi**, y lo ejecuta el Coordinador en un momento tranquilo.

## Ensayo (9/10/2026)

`node scripts/public-repo.mjs --verify` armó en una carpeta temporal el repo nuevo desde `origin/main` (9dc4c17):
- **860 archivos, un commit** de «Santiago Aguilar <72237439+santiqwerty1@users.noreply.github.com>».
- **Mismo árbol** que el main privado. El script copia el bit de ejecución, que Windows no guarda en el disco (`docker/migrate.sh`).
- **`posta check` sin errores**, aunque la bóveda y DECISIONES citan sha que no existen en el repo nuevo: Posta no los valida.
- Sin `.env`, sin imágenes de cartas, sin archivos de más de 5 MB y sin mails personales en el árbol.
- **Traslado de una rama:** `ops/phase-39`, 2 commits, pasó con `git rebase --onto main <base vieja> ops/phase-39` sin conflictos.
- **`node scripts/deploy.mjs --check`** sin remoto ahora dice «No se pudo leer origin/main» en vez de cortarse con una traza. Con el remoto nuevo anda igual que hoy: pide la CI verde del sha exacto.

## Qué no cambia

- **Fly:** despliega desde la carpeta local.
- **Supabase**, la base y las copias, incluida la del bucket.
- **El worker de la PC:** habla con la app, no con GitHub.
- **El conector de Claude y los tokens.**
- **UptimeRobot:** mira la URL de la app.

## El día de la mudanza

0. **Ventana tranquila.**
   - Aviso en el chat: nadie empuja ni mergea hasta el paso 7.
   - Anotar `OLD=$(git rev-parse origin/main)` y la lista de PR abiertos (`gh pr list --json number,title,headRefName`).
1. **Nombre.** Si el repo público se va a llamar `tcg-pocket`, primero se renombra el privado:
   - `gh repo rename tcg-pocket-privado --repo santiqwerty1/tcg-pocket`.
   - GitHub redirige las URL viejas al renombrado solo hasta que exista otro repo con el nombre viejo.
2. **El commit:** en la carpeta principal, con main al día, `node scripts/public-repo.mjs --ref origin/main --verify --out <carpeta>`.
3. **El repo público:**
   - `gh repo create santiqwerty1/tcg-pocket --public --description "App personal de Pokémon TCG Pocket (AGPL-3.0)"`;
   - en `<carpeta>`: `git remote add origin https://github.com/santiqwerty1/tcg-pocket.git` y `git push -u origin main`.
4. **La carpeta principal.** Los worktrees comparten los remotos y la config, así que esto vale para todos:
   ```bash
   git remote rename origin privado
   git remote add origin https://github.com/santiqwerty1/tcg-pocket.git
   git fetch origin
   gh repo set-default santiqwerty1/tcg-pocket
   git config user.email 72237439+santiqwerty1@users.noreply.github.com
   git checkout main
   git reset --hard origin/main
   ```
   - Hace falta `git config user.email` para que el mail personal no vuelva a aparecer en los commits.
   - El `reset --hard` es seguro porque la carpeta principal no tiene cambios: nadie edita ahí.
   - Mismo árbol, otro sha.
5. **Las ramas de cada sesión.** Cada una corre en su worktree, para cada rama suya:
   ```bash
   git rebase --onto origin/main $(git merge-base <rama> privado/main) <rama>
   git push -u origin <rama>
   ```
   Después reabre su PR en el repo nuevo con `gh pr create`, copiando la descripción del PR viejo.
   - Las sesiones en la nube no ven esta PC: el Coordinador trae sus ramas (`git fetch privado <rama>`), hace el mismo `rebase --onto` y abre el PR por ellas.
6. **La CI en el repo nuevo.**
   - Actions corre sola, porque el workflow viaja con el árbol. La primera corrida de main tiene que quedar verde antes del próximo deploy: `deploy.mjs` pide la CI del sha nuevo.
   - Settings → Actions → General: permisos de solo lectura, que ya pide el workflow.
   - Settings → Code security: Dependabot.
7. **Reabrir la ventana:** aviso en el chat.
8. **El privado:** queda privado y archivado (`gh repo archive santiqwerty1/tcg-pocket-privado`).

## Después: referencias viejas

- **La bóveda, DECISIONES y CLAUDE.md citan sha del privado.** Quedan como referencias históricas.
  - En CLAUDE.md va una línea: «Historial hasta el <fecha>: `santiqwerty1/tcg-pocket-privado` (privado); los sha citados antes de esa fecha son de ahí».
  - «repo privado en GitHub» pasa a «repo público».
- **Los «PR #N» viejos de la bóveda** hablan de PR del privado. En el repo nuevo los números arrancan de nuevo, así que un «#14» puede ser otro PR. Las fichas nuevas tienen que citar PR con la URL completa.
- **Posta:** si se usa `posta github`, va con `--repo santiqwerty1/tcg-pocket`.

## Qué se pierde

- **En el repo público:** los PR abiertos con sus comentarios de revisión. Se recrean, y los viejos siguen en el privado.
- **Los enlaces a commits del privado** desde afuera: solo los ve quien tiene acceso al privado.

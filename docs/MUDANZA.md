# Mudanza al repo público

Santi eligió (D-022) publicar el código en un **repo nuevo con historial limpio**. El repo arranca con la **versión 1.0.0**:
- un solo commit con el árbol de main y la versión 1.0.0 en los `package.json`;
- el tag `v1.0.0` y un release con las fases 0 a 44;
- firmado con la dirección noreply de GitHub.

El repo privado queda como archivo, con su historial y sus PR. La numeración de PR **sigue** la del privado.

Este documento es el plan. **Nada de esto se hace sin el OK de Santi**, y lo ejecuta el Coordinador.

## Ensayo (9/10/2026)

`node scripts/public-repo.mjs --version 1.0.0 --notes <archivo> --verify` armó en una carpeta temporal el repo nuevo desde `origin/main` (3643df4):
- **868 archivos, un commit** «TCG Pocket 1.0.0» de «Santiago Aguilar <72237439+santiqwerty1@users.noreply.github.com>», con el tag `v1.0.0`.
- **Mismo árbol** que el main privado, **salvo el campo `version`** de los 5 `package.json`.
  - El script copia el bit de ejecución que Windows no guarda en el disco (`docker/migrate.sh`).
- **Notas del release** armadas desde Avance: las 45 fases, de la 0 a la 44, con su título.
- **`posta check` sin errores**, aunque la bóveda y DECISIONES citan sha que no existen en el repo nuevo: Posta no los valida.
- Sin `.env`, sin imágenes de cartas, sin archivos de más de 5 MB y sin mails personales.
- **Traslado de una rama:** `ops/phase-39`, 2 commits, pasó con `git rebase --onto main <base vieja> ops/phase-39` sin conflictos.
- **`scripts/reserve-numbers.mjs`** en modo de prueba, contra el repo actual, calcula bien desde dónde reservar.
- **`node scripts/deploy.mjs --check`** sin remoto dice «No se pudo leer origin/main». Con el remoto nuevo anda igual que hoy: pide la CI verde del sha exacto.

## Qué no cambia

- **Fly:** despliega desde la carpeta local.
- **Supabase**, la base y las copias, incluida la del bucket.
- **El worker de la PC:** habla con la app, no con GitHub.
- **El conector de Claude y los tokens.**
- **UptimeRobot:** mira la URL de la app.

## El día de la mudanza

0. **Ventana tranquila: cero PR abiertos** (decisión de Santi).
   - `gh pr list --state open` tiene que dar vacío: todo lo pendiente, integrado.
   - Aviso en el chat: nadie empuja hasta el paso 8.
   - Anotar `OLD=$(git rev-parse origin/main)`.
1. **Los runners de la PC (D-023) quedan atados al repo privado:** no corren nada del público, así que no son un riesgo para él.
   - Igual se sacan al terminar (paso 9).
   - El repo público tiene minutos de Actions sin límite.
2. **Nombre.** Si el repo público se va a llamar `tcg-pocket`, primero se renombra el privado:
   - `gh repo rename tcg-pocket-privado --repo santiqwerty1/tcg-pocket`.
   - GitHub redirige las URL viejas al renombrado solo hasta que exista otro repo con el nombre viejo.
3. **El commit 1.0.0:** en la carpeta principal, con main al día:
   ```bash
   node scripts/public-repo.mjs --ref origin/main --version 1.0.0 --notes <notas.md> --verify --out <carpeta>
   ```
4. **El repo público, el tag y el release:**
   ```bash
   gh repo create santiqwerty1/tcg-pocket --public --description "App personal de Pokémon TCG Pocket (AGPL-3.0)"
   # en <carpeta>:
   git remote add origin https://github.com/santiqwerty1/tcg-pocket.git
   git push -u origin main
   git push origin v1.0.0
   gh release create v1.0.0 --repo santiqwerty1/tcg-pocket --title "TCG Pocket 1.0.0" --notes-file <notas.md>
   ```
5. **La numeración, antes de cualquier PR** (decisión de Santi):
   ```bash
   node scripts/reserve-numbers.mjs --repo santiqwerty1/tcg-pocket --from santiqwerty1/tcg-pocket-privado
   node scripts/reserve-numbers.mjs --repo santiqwerty1/tcg-pocket --from santiqwerty1/tcg-pocket-privado --apply
   ```
   - El primero es solo una prueba: dice del #N al #M.
   - El segundo crea los issues «Número reservado: PR #N del repo anterior», cerrados, sin asignar ni mencionar a nadie.
   - Si GitHub da un número que no se esperaba, para.
   - El próximo PR sigue la numeración del privado.
6. **La carpeta principal.** Los worktrees comparten los remotos y la config, así que esto vale para todos:
   ```bash
   git remote rename origin privado
   git remote add origin https://github.com/santiqwerty1/tcg-pocket.git
   git fetch origin --tags
   gh repo set-default santiqwerty1/tcg-pocket
   git config user.email 72237439+santiqwerty1@users.noreply.github.com
   git checkout main
   git reset --hard origin/main
   ```
   - `git config user.email` evita que el mail personal vuelva a aparecer en los commits.
   - El `reset --hard` es seguro porque la carpeta principal no tiene cambios: nadie edita ahí. Queda el commit 1.0.0.
7. **Las ramas de cada sesión que sigan vivas:**
   ```bash
   git rebase --onto origin/main $(git merge-base <rama> privado/main) <rama>
   git push -u origin <rama>
   ```
   - El PR va nuevo en el repo nuevo.
   - Con cero PR abiertos, solo quedan ramas a medio hacer.
   - Las sesiones en la nube no ven esta PC: el Coordinador trae sus ramas (`git fetch privado <rama>`) y hace lo mismo.
8. **GitHub del repo nuevo:**
   - Actions corre sola: el workflow viaja con el árbol. La primera corrida de main tiene que quedar verde antes del próximo deploy, porque `deploy.mjs` pide la CI del sha nuevo.
   - Settings → Actions → General: el token de los workflows **de solo lectura**. El workflow ya pide `contents: read`.
   - **Recordatorio para Santi:** Settings → Code security → activar **las alertas de seguridad de Dependabot** (lo pidió él). Y volver `open-pull-requests-limit` de `.github/dependabot.yml` a 2 y 1 (estaba en 0 por D-023).
   - Las variables `CI_RUNNER` y `CI_RUNNER_WINDOWS` **no** se cargan en el repo nuevo: la CI usa los runners de GitHub.
   - Reabrir la ventana: aviso en el chat.
9. **El privado:**
   - sacar los runners de la PC (`scripts/ci-runner/uninstall.ps1`);
   - borrar las variables del privado;
   - dejarlo privado y archivado (`gh repo archive santiqwerty1/tcg-pocket-privado`).

## Después: referencias viejas

- **La bóveda, DECISIONES y CLAUDE.md citan sha del privado.** Quedan como referencias históricas.
  - En CLAUDE.md va una línea: «Historial hasta la 1.0.0 (<fecha>): `santiqwerty1/tcg-pocket-privado` (privado); los sha citados antes son de ahí».
  - «repo privado en GitHub» pasa a «repo público».
- **Los «PR #N» de la bóveda:** gracias a los números reservados, en el repo nuevo apuntan a un issue marcador que dice que es un PR del repo anterior, no a otro PR.
- **Posta:** si se usa `posta github`, va con `--repo santiqwerty1/tcg-pocket`.

## Qué se pierde

- **En el repo público:** el historial, que sigue en el privado, y los comentarios de revisión de los PR viejos.
- **Los enlaces a commits del privado** desde afuera: solo los ve quien tiene acceso al privado.

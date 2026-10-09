#!/usr/bin/env bash
# CI (D-023): a short id of the runner for database names and ports («tcg-pc-1» → «tcg_pc_1»), so two runners on the
# same PC never share a database or a port. On GitHub's runners each job has its own machine, and the id is harmless.
set -euo pipefail
printf '%s' "${RUNNER_NAME:-ci}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '_' | cut -c1-30

/**
 * Tests de pantallas (Fase 34): the real app (API + built PWA) on a throwaway database, driven by Chromium. These are
 * test values for that database only: it is reset on every run and never holds real data.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const E2E_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(E2E_DIR, '..', '..', '..')
/** `SCREENS_PORT` moves it (the CI on the PC's runner, so it never meets a session running the screens). */
export const PORT = Number(process.env.SCREENS_PORT ?? 3210)
export const BASE_URL = `http://127.0.0.1:${PORT}`
/** Next to the API's e2e database (same Postgres: docker compose locally, the service in CI). */
export const DATABASE_URL = process.env.SCREENS_DATABASE_URL ?? 'postgresql://tcg:tcg@127.0.0.1:5433/tcg_screens'
/** The owner of the throwaway database (test values, as in the API's e2e helpers). */
export const OWNER = { email: 'santi@pantallas.test', password: 'pantallas-de-prueba-2026' }
/** apps/worker/test/fake-engine.mjs reports this engine: games are created for it so the worker takes them. */
export const FAKE_ENGINE_REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
export const SESSION_SECRET = 'pantallas-session-secret-0123456789abcdef'
export const STORAGE_STATE = join(E2E_DIR, '.auth', 'owner.json')

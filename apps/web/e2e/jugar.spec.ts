/**
 * Jugar contra un bot (Fase 8) con el modo entrenador, empujado por el servidor (Fase 33), y una situación para
 * resolver (Fase 24). The PC is the real worker with the engine stand-in of its tests (apps/worker/test/fake-engine.mjs:
 * two decisions of two options; attacking both times wins).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { type APIRequestContext, expect, test } from '@playwright/test'
import { BASE_URL, DATABASE_URL, FAKE_ENGINE_REV, REPO_ROOT } from './settings.ts'
import { removeWorkerDir, stopWorker } from './worker-process.ts'

let worker: ChildProcess | null = null
let workerDir = ''
let gameId: number | null = null

/**
 * The PC comes in once the game is queued (as in real life). Keep the server's fixture card status: the stand-in's
 * two-card list would invalidate the imported decks for subsequent attempts, retries and other screen flows.
 */
async function startWorker(request: APIRequestContext): Promise<void> {
  const created = await request.post('/api/tokens', {
    data: { name: 'pc de pantallas', kind: 'worker', scopes: ['worker:claim'] },
  })
  expect(created.status()).toBe(201)
  const { token } = (await created.json()) as { token: string }
  workerDir = mkdtempSync(join(tmpdir(), 'tcg-screens-worker-'))
  writeFileSync(join(workerDir, 'state.json'), JSON.stringify({ statusUploaded: FAKE_ENGINE_REV }))
  worker = spawn(process.execPath, [join(REPO_ROOT, 'apps', 'worker', 'dist', 'main.js')], {
    env: {
      ...process.env,
      TCG_WORKER_TOKEN: token,
      TCG_SERVER: BASE_URL,
      TCG_ENGINE_PATH: join(REPO_ROOT, 'apps', 'worker', 'test', 'fake-engine.mjs'),
      TCG_WORKER_DIR: workerDir,
      TCG_WORKER_CORES: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })
}

test.afterEach(async ({ request }, testInfo) => {
  try {
    if (gameId !== null) {
      const response = await request.post(`/api/play/${gameId}/abandon`)
      expect(response.ok(), await response.text()).toBe(true)
    }
  } finally {
    try {
      await stopWorker(worker)
      const path = join(workerDir, 'worker.log')
      if (workerDir && testInfo.status !== testInfo.expectedStatus && existsSync(path)) {
        await testInfo.attach('worker.log', { path })
      }
    } finally {
      await removeWorkerDir(workerDir)
      worker = null
      workerDir = ''
      gameId = null
    }
  }
})

/** Replaces a finished game's replay (the engine stand-in writes an empty one) with one where a choice cost a lot. */
async function costlyReplay(gameId: number): Promise<void> {
  const require = createRequire(join(REPO_ROOT, 'apps', 'api', 'package.json'))
  // pg comes from the API's dependencies (the web does not depend on it).
  const pg = require('pg') as {
    Client: new (options: {
      connectionString: string
    }) => {
      connect(): Promise<void>
      query(sql: string, values: unknown[]): Promise<unknown>
      end(): Promise<void>
    }
  }
  const state = { turn: 3, current_player: 0, points: [0, 0], players: [], stadium: null }
  const options = [
    { text: 'EndTurn', action: 'EndTurn' },
    { text: 'Attack(Vine Whip)', action: { Attack: { title: 'Vine Whip', fixed_damage: 40 } } },
  ]
  const replay = {
    version: 1,
    players: [],
    cards: {},
    steps: [{ ply: 0, turn: 3, actor: 0, state, options, chosen: 0, note: null, scores: [0, 6000] }],
    final_state: state,
    outcome: { Win: 1 },
  }
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    await client.query('UPDATE live_games SET replay_gz = $1 WHERE id = $2', [
      gzipSync(Buffer.from(JSON.stringify(replay))),
      gameId,
    ])
  } finally {
    await client.end()
  }
}

test('plays a game against the bot with the coach, then solves the costly moment', async ({ page, request }) => {
  // The PC's game: without the engine of the browser (T-015, navegador.spec.ts), whatever the build has.
  await page.route('**/engine/manifest.json', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('/jugar')
  await page.getByRole('combobox', { name: 'Tu mazo' }).click()
  await page.getByRole('option').first().click()
  await page.getByRole('tab', { name: 'Mis mazos' }).click()
  await page.getByRole('combobox', { name: 'El mazo del bot' }).click()
  await page.getByRole('option').nth(1).click()
  // D-029: the bot starts as g2. This PC's engine stand-in has no g (engine-cli 0.3.16 with «gBots»), so the game is
  // against e2, which every engine plays; the default reaching the server is tested in the API's e2e.
  const bot = page.getByRole('combobox', { name: 'Bot' })
  await expect(bot).toHaveText('Normal, sin trampa (g2: no ve tu mano ni tu mazo)')
  await bot.click()
  await page.getByRole('option', { name: 'Clásico (expectiminimax 2: ve tu mano y tu mazo)' }).click()
  await page.getByText('Modo entrenador').click()
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/play' && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Empezar' }).click(),
  ])
  expect(created.status(), await created.text()).toBe(201)
  const game = (await created.json()) as { id: number; status: string; bot: string }
  gameId = Number(game.id)
  expect(game).toMatchObject({ status: 'queued', bot: 'e2' })
  await expect(page).toHaveURL(`${BASE_URL}/jugar/${gameId}`)
  await startWorker(request)

  // Two decisions: attack both times (the coach agrees) and win.
  for (let decision = 1; decision <= 2; decision++) {
    await expect
      .poll(async () => {
        const response = await request.get(`/api/play/${gameId}`)
        expect(response.ok()).toBe(true)
        const state = (await response.json()) as { status: string; decision: { ply: number } | null }
        return { status: state.status, ply: state.decision?.ply }
      })
      .toEqual({ status: 'waiting', ply: decision })
    await page.getByRole('button', { name: /^Opciones \(2\)$/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Todas tus opciones' })
    await sheet.getByRole('button', { name: /Vine Whip/ }).click()
    await expect(sheet).toBeHidden()
  }
  await expect(page.getByText('¡Ganaste!')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Ver la repetición' }).first()).toBeVisible({ timeout: 20_000 })

  // The situation: the moment of that game where another move was much better.
  await costlyReplay(gameId)
  await page.goto('/jugar/situaciones')
  await page
    .getByRole('link', { name: /Error grave/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Opciones \(2\)$/ }).click()
  await page
    .getByRole('dialog', { name: 'Todas tus opciones' })
    .getByRole('button', { name: /Vine Whip/ })
    .click()
  await expect(page.getByText('Como el entrenador').first()).toBeVisible()
})

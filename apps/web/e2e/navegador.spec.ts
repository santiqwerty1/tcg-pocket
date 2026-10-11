/**
 * T-015: a game against the bot played in this browser, without the PC. The engine is a stand-in with the WebAssembly
 * module's exports (e2e/fake-wasm-engine.js), served as /engine/ from the built PWA for this test only; the Web Worker,
 * the page's runner, the API and the board are the real ones. The real engine is checked by engine/wasm/smoke.mjs.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { BASE_URL, E2E_DIR, FAKE_ENGINE_REV } from './settings.ts'

const ENGINE_DIR = join(E2E_DIR, '..', 'dist', 'engine')
const SET_ASIDE = `${ENGINE_DIR}.screens-${process.pid}`
let gameId: number | null = null

test.beforeAll(() => {
  // A real engine built into the PWA (pnpm engine:wasm) is put back afterwards.
  if (existsSync(ENGINE_DIR)) renameSync(ENGINE_DIR, SET_ASIDE)
  mkdirSync(ENGINE_DIR, { recursive: true })
  copyFileSync(join(E2E_DIR, 'fake-wasm-engine.js'), join(ENGINE_DIR, 'fake-wasm-engine.js'))
  writeFileSync(join(ENGINE_DIR, 'fake_bg.wasm'), '')
  writeFileSync(
    join(ENGINE_DIR, 'manifest.json'),
    JSON.stringify({ engineRev: FAKE_ENGINE_REV, version: 'fake', js: 'fake-wasm-engine.js', wasm: 'fake_bg.wasm' }),
  )
})

test.afterAll(() => {
  rmSync(ENGINE_DIR, { recursive: true, force: true })
  if (existsSync(SET_ASIDE)) renameSync(SET_ASIDE, ENGINE_DIR)
})

test.afterEach(async ({ request }) => {
  if (gameId !== null) await request.post(`/api/play/${gameId}/abandon`)
  gameId = null
})

test('plays a game against the bot in this device, with the coach, and keeps its replay', async ({ page, request }) => {
  await page.goto('/jugar')
  await page.getByRole('tab', { name: 'En este dispositivo' }).click()
  await expect(page.getByText('El bot juega acá mismo')).toBeVisible()
  await page.getByRole('combobox', { name: 'Tu mazo' }).click()
  await page.getByRole('option').first().click()
  await page.getByRole('tab', { name: 'Mis mazos' }).click()
  await page.getByRole('combobox', { name: 'El mazo del bot' }).click()
  await page.getByRole('option').nth(1).click()
  await page.getByText('Modo entrenador').click()
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/play' && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Empezar' }).click(),
  ])
  expect(created.status(), await created.text()).toBe(201)
  const game = (await created.json()) as { id: number; status: string; runner: string }
  gameId = Number(game.id)
  expect(game).toMatchObject({ runner: 'browser', status: 'running' })
  await expect(page).toHaveURL(`${BASE_URL}/jugar/${gameId}`)
  await expect(page.getByText('en el navegador')).toBeVisible()

  // The page itself plays the bot: no worker is running.
  for (let decision = 1; decision <= 2; decision++) {
    await expect
      .poll(async () => {
        const state = (await (await request.get(`/api/play/${gameId}`)).json()) as {
          status: string
          decision: { ply: number; hintAvailable: boolean } | null
        }
        return { status: state.status, ply: state.decision?.ply, hint: state.decision?.hintAvailable }
      })
      .toEqual({ status: 'waiting', ply: decision, hint: true })
    await page.getByRole('button', { name: /^Opciones \(2\)$/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Todas tus opciones' })
    await sheet.getByRole('button', { name: /Vine Whip/ }).click()
    await expect(sheet).toBeHidden()
  }
  await expect(page.getByText('¡Ganaste!')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Ver la repetición' }).first()).toBeVisible({ timeout: 20_000 })
  const replay = await request.get(`/api/play/${gameId}/replay/raw`)
  expect(await replay.json()).toMatchObject({ choices: [1, 1] })
  const done = (await (await request.get(`/api/play/${gameId}`)).json()) as { coachReviews: unknown[] }
  expect(done.coachReviews).toHaveLength(2)
  gameId = null
})

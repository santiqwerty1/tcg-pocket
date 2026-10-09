/** Logs in through the real login page and imports the first three decks of the 40 lists (docs/context). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { OWNER, REPO_ROOT, STORAGE_STATE } from './settings.ts'

interface Draft {
  title: string
  draft: { energies: string[]; cards: unknown[] } | null
}

setup('log in and import three decks', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(OWNER.email)
  await page.getByLabel('Contraseña').fill(OWNER.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL('**/partidas')

  const text = readFileSync(join(REPO_ROOT, 'docs', 'context', 'mazos_40_listas.md'), 'utf8')
  const preview = await page.request.post('/api/decks/import', { data: { text } })
  expect(preview.status()).toBe(200)
  const drafts = ((await preview.json()) as { drafts: Draft[] }).drafts
    .filter((item) => item.draft && item.draft.energies.length > 0)
    .slice(0, 3)
  const commit = await page.request.post('/api/decks/import/commit', {
    data: {
      decks: drafts.map((item) => ({ name: item.title, energies: item.draft?.energies, cards: item.draft?.cards })),
    },
  })
  expect(commit.status()).toBe(201)
  await page.context().storageState({ path: STORAGE_STATE })
})

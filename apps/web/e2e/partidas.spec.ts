/** Cargar una partida (Fase 2) desde Hoy y, sin señal, que quede en el celu y se envíe sola (Fase 28). */
import { expect, test } from '@playwright/test'

test('logs a match from Hoy in four taps', async ({ page }) => {
  await page.goto('/partidas')
  const form = page.getByRole('form', { name: 'Nueva partida' })
  await form.getByRole('button', { name: 'Victoria' }).click()
  await form.getByLabel('Rival (arquetipo)').fill('Pikachu ex')
  await form.getByRole('button', { name: 'Empecé yo' }).click()
  await form.getByRole('button', { name: /Guardar partida/ }).click()
  await expect(page.getByText(/^Victoria con .+ contra Pikachu ex$/).first()).toBeVisible()
  const recent = page
    .getByRole('region', { name: 'Últimas partidas' })
    .or(page.locator('section', { hasText: 'Últimas partidas' }))
  await expect(recent.getByText('Pikachu ex').first()).toBeVisible()
})

test('without signal the match waits on the phone and goes by itself when the signal is back', async ({
  page,
  context,
}) => {
  await page.goto('/partidas')
  const form = page.getByRole('form', { name: 'Nueva partida' })
  await expect(form.getByRole('button', { name: 'Derrota' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Sin señal: las partidas que guardes quedan en el celu y se envían solas.')).toBeVisible()
  await form.getByRole('button', { name: 'Derrota' }).click()
  await form.getByLabel('Rival (arquetipo)').fill('Gyarados ex')
  await form.getByRole('button', { name: /Guardar partida/ }).click()
  await expect(page.getByText('Sin enviar (1)')).toBeVisible()
  await expect(page.getByText('Sin señal: quedó en el celu y se envía sola cuando vuelva.')).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('Se envió la partida guardada sin señal')).toBeVisible()
  await expect(page.getByText('Sin enviar (1)')).toBeHidden()
  const matches = await page.request.get('/api/matches?opponent=Gyarados%20ex')
  expect(((await matches.json()) as { total: number }).total).toBe(1)
})

/**
 * T-022, «Importar desde la hoja» on a 375 px phone: the cells pasted from a (synthetic) sheet, the deck suggested for
 * its code, the import and the numbers for column K; the same sheet again imports nothing. Nothing of the page goes
 * wider than the screen, with a long note and a long rival.
 */
import { expect, type Page, test } from '@playwright/test'

const PHONE = 375
test.use({ viewport: { width: PHONE, height: 812 } })

const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth)

const WALL = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
/** «dd/mm/aaaa hh:mm» in the owner's time zone, hours ago (far from the matches other screens log now). */
const ago = (hours: number) => WALL.format(new Date(Date.now() - hours * 60 * 60 * 1000)).replace(', ', ' ')

/** The sheet as copied from Sheets: tab-separated, the title and instructions above the headers (row 4). */
function pastedSheet(): string {
  const rows = [
    ['Registro de partidas'],
    ['Elegí el código del mazo en la columna A'],
    [''],
    [
      'Código',
      'Salida',
      'Resultado',
      'Mazo (automático)',
      'Fecha',
      'Mazo rival',
      'Notas',
      'Rango',
      'Rango (efectivo)',
      'Temporada',
      'En la app (n.º)',
    ],
    [
      'M01',
      'Primero',
      'Victoria',
      'butterfree',
      ago(5),
      'Weezing ex del Team Rocket / Hoopa ex / Mega-Absol ex / Dedenne ex / Indeedee',
      'Una nota larga, con comas: el rival abrió con Dedenne ex, después Hoopa ex y Absol; perdí la carrera de premios hasta el último turno.',
      '',
      '',
      'sin temporada',
      '',
    ],
    ['M01', '', 'Derrota', 'butterfree', ago(4), 'Mega-Blaziken ex', '', '', '', 'sin temporada', ''],
  ]
  return rows.map((row) => row.join('\t')).join('\n')
}

test('the sheet pasted on the phone: preview, deck suggested, import and the numbers for column K', async ({
  page,
}) => {
  const text = pastedSheet()
  await page.goto('/partidas/importar')
  await page.getByRole('textbox', { name: 'Celdas pegadas de la hoja' }).fill(text)
  await page.getByRole('button', { name: 'Ver la vista previa' }).click()
  await expect(
    page.getByText(/2 filas con datos \(separadas por tabulaciones, encabezados en la fila 4\)/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Usar los sugeridos' }).click()
  await expect(page.getByRole('combobox', { name: 'Mazo de M01' })).toHaveValue(/\d+/)
  const importButton = page.getByRole('button', { name: 'Importar 2 partidas' })
  await expect(importButton).toBeEnabled()
  await expect(page.getByText('Sin «Salida»: el orden de turno queda sin anotar.')).toBeVisible()
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)

  await importButton.click()
  await expect(page.getByRole('heading', { name: 'Listo' })).toBeVisible()
  const numbers = await page.getByRole('textbox', { name: 'Números para la columna K' }).inputValue()
  expect(numbers).toMatch(/^\d+\n\d+$/)
  await expect(page.getByText(/^Fila 5 → n\.º \d+$/)).toBeVisible()
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)

  // The same sheet again: nothing new, and the same numbers for K.
  await page.reload()
  await page.getByRole('textbox', { name: 'Celdas pegadas de la hoja' }).fill(text)
  await page.getByRole('button', { name: 'Ver la vista previa' }).click()
  await expect(page.getByRole('button', { name: 'No hay partidas para importar' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Números para la columna K' })).toHaveValue(numbers)
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true
  })
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)
})

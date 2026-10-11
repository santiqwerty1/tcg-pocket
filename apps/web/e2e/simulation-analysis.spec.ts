import { expect, test } from '@playwright/test'
import { analysisFindings, analysisMatrix, analyzeGames, compareAnalysisBots, matchupPatterns } from '@tcg/domain'

test.use({ serviceWorkers: 'block' })
test('analysis charts and touch heatmap fit a phone with current synthetic evidence', async ({ page }, testInfo) => {
  const input = {
    id: 1,
    label: 'Calibración e2',
    bot: 'e2/e2',
    engineRev: 'a'.repeat(40),
    era: 'B4a',
    decks: [
      { id: 1, key: 'a', label: 'Charizard ex' },
      { id: 2, key: 'b', label: 'Blastoise ex' },
      { id: 3, key: 'c', label: 'Venusaur ex' },
    ],
    sideA: [1, 2, 3],
    sideB: [1, 2, 3],
    outcomes: [
      { a: 1, b: 2, winsA: 900, winsB: 100, ties: 0 },
      { a: 2, b: 3, winsA: 700, winsB: 300, ties: 0 },
      { a: 3, b: 1, winsA: 600, winsB: 400, ties: 0 },
    ],
  }
  const matrix = analysisMatrix(input),
    other = analysisMatrix({
      ...input,
      id: 2,
      bot: 'f2/f2',
      outcomes: input.outcomes.map((c) => ({ ...c, winsA: c.winsB, winsB: c.winsA })),
    })
  const games = analyzeGames(
    { wins: 2200, losses: 800, ties: 0 },
    {
      games: 30,
      firstWins: 20,
      secondWins: 10,
      ties: 0,
      turnSum: 240,
      turnSquares: 2040,
      histogram: [
        { turns: 6, games: 15 },
        { turns: 10, games: 15 },
      ],
    },
  )
  const patterns = matchupPatterns(matrix),
    agreement = compareAnalysisBots(matrix, other)
  const view = {
    source: 'simulation',
    options: { bots: ['e2', 'f2'], eras: ['B4a'], expansions: ['B4'] },
    summary: {
      simulations: 2,
      games: 6000,
      unknownEra: 0,
      failedChunks: 0,
      byBot: [
        { bot: 'e2/e2', botEs: 'e2', simulations: 1, games: 3000 },
        { bot: 'f2/f2', botEs: 'f2', simulations: 1, games: 3000 },
      ],
      byExpansion: [{ expansion: 'B4', simulations: 2, games: 6000 }],
    },
    matrix,
    rankings: [matrix, other],
    matrices: [matrix, other].map((m) => ({
      ...m,
      status: 'done',
      games: 3000,
      botEs: m.bot,
      symmetric: true,
      archived: false,
      calibration: false,
    })),
    comparison: { left: 1, right: 2 },
    agreement,
    games,
    patterns,
    findings: analysisFindings(patterns, games, agreement),
    calibrationJobId: null,
  }
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/simulations/analysis*', (route) => route.fulfill({ json: view }))
  await page.goto('/simulacion')
  await page.getByRole('link', { name: 'Análisis', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Análisis de simulaciones' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Ranking e2/e2 con intervalos' }).locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('analisis-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Charizard ex contra Blastoise ex' }).click()
  const detail = page.locator('[aria-live="polite"]', { hasText: 'Charizard ex contra Blastoise ex' })
  await expect(detail).toContainText('n = 1.000')
  await expect(detail).toContainText('IC')
  await detail.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('analisis-matchup-mobile.png') })
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 1280, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('81-list heatmap stays compact and scrolls within a phone', async ({ page }, testInfo) => {
  const ids = Array.from({ length: 81 }, (_, i) => i + 1)
  const outcomes = ids.flatMap((a) => ids.filter((b) => b > a).map((b) => ({ a, b, winsA: 700, winsB: 300, ties: 0 })))
  const matrix = analysisMatrix({
    id: 81,
    label: '81 listas',
    bot: 'e2/e2',
    engineRev: 'a'.repeat(40),
    era: null,
    decks: ids.map((id) => ({ id, key: `list-${id}`, label: `Mazo ${id}` })),
    sideA: ids,
    sideB: ids,
    outcomes,
  })
  const games = analyzeGames(
    { wins: 700 * outcomes.length, losses: 300 * outcomes.length, ties: 0 },
    {
      games: 0,
      firstWins: 0,
      secondWins: 0,
      ties: 0,
      turnSum: 0,
      turnSquares: 0,
      histogram: [],
    },
  )
  const patterns = matchupPatterns(matrix)
  await page.route('**/api/simulations/analysis*', (route) =>
    route.fulfill({
      json: {
        source: 'simulation',
        options: { bots: ['e2'], eras: [], expansions: [] },
        summary: {
          simulations: 1,
          activeJobs: 0,
          games: outcomes.length * 1000,
          unknownEra: 1,
          failedChunks: 0,
          byBot: [],
          byExpansion: [],
        },
        matrices: [
          {
            ...matrix,
            status: 'done',
            botEs: 'e2',
            symmetric: true,
            games: outcomes.length * 1000,
            archived: false,
            calibration: false,
          },
        ],
        matrix,
        rankings: [],
        agreement: null,
        comparison: { left: null, right: null },
        games,
        patterns,
        findings: analysisFindings(patterns, games, null),
        calibrationJobId: null,
      },
    }),
  )
  await page.goto('/simulacion/analisis')
  const table = page.getByRole('table')
  await table.scrollIntoViewIfNeeded()
  await expect(table.getByRole('rowheader').first()).toContainText('%')
  const target = page.getByRole('button', { name: 'Mazo 1 contra Mazo 81', exact: true })
  expect((await target.boundingBox())?.height).toBeLessThanOrEqual(28)
  await target.click()
  await expect(page.locator('[aria-live="polite"]', { hasText: 'Mazo 1 contra Mazo 81' })).toContainText('n = 1.000')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('analisis-81-mobile.png') })
})

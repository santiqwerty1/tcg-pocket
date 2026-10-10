import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AndroidWorkerSection, androidInstallCommand } from './AndroidWorkerSection'

afterEach(() => vi.unstubAllGlobals())
it('copies an HTTPS installer command without credentials', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('location', new URL('https://tcg.example'))
  render(<AndroidWorkerSection />)
  await user.click(screen.getByRole('button', { name: 'Copiar comando para Termux' }))
  const command = await navigator.clipboard.readText()
  expect(command).toContain('https://tcg.example/api/worker/install/android.sh')
  expect(command).not.toMatch(/tcg_wk_|Authorization|token=/)
  expect(androidInstallCommand('http://localhost')).toBe('')
})

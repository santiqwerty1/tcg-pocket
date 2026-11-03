import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Providers } from './app/Providers'
import { router } from './app/router'
import './index.css'
import { stashIncoming } from './lib/pokemonZone'
import { setupPwa } from './pwa'

// 2/11: what the pokemon-zone bookmarklet brought in the fragment leaves the address bar before anything can navigate.
stashIncoming()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)

if (import.meta.env.PROD) setupPwa()

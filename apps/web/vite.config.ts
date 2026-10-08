/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const API_ORIGIN = process.env.VITE_API_ORIGIN ?? 'http://localhost:3000'

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // The service worker is not needed under vitest and the virtual module would be unused there.
    mode === 'test'
      ? undefined
      : VitePWA({
          registerType: 'autoUpdate',
          // src/pwa.ts registers the worker through `virtual:pwa-register`.
          injectRegister: false,
          includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
          manifest: {
            name: 'TCG Pocket',
            short_name: 'TCG Pocket',
            description: 'Colección, mazos, sobres y partidas de Pokémon TCG Pocket',
            lang: 'es',
            start_url: '/',
            scope: '/',
            display: 'standalone',
            theme_color: '#2563eb',
            background_color: '#ffffff',
            icons: [
              { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            // Fase 18: the push and notificationclick handlers (public/push-sw.js).
            importScripts: ['/push-sw.js'],
            // Only the built shell is precached: nothing under /api is ever listed because the glob runs over dist/.
            globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
            // deckgym's replay viewer (D-014) is opened now and then: not worth 1,6 MB of precache.
            globIgnores: ['viewer/**'],
            navigateFallback: '/index.html',
            // The login page is served by the API and must never be answered with the SPA shell.
            navigateFallbackDenylist: [/^\/api/, /^\/login/, /^\/healthz/, /^\/viewer\//],
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            // No runtime caching: API responses always hit the network (the session cookie decides).
            runtimeCaching: [],
          },
          devOptions: { enabled: false },
        }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_ORIGIN, changeOrigin: false },
      '/login': { target: API_ORIGIN, changeOrigin: false },
      '/healthz': { target: API_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}))

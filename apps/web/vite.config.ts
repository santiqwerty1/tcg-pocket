/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const API_ORIGIN = process.env.VITE_API_ORIGIN ?? 'http://localhost:3000'
const SHORTCUT_ICON = { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }

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
            // Fase 41: long-press on the icon. Logging a match is the most frequent action.
            shortcuts: [
              { name: 'Cargar partida', short_name: 'Partida', url: '/partidas', icons: [SHORTCUT_ICON] },
              { name: 'Mazos', url: '/mazos', icons: [SHORTCUT_ICON] },
              { name: 'Sobres', url: '/sobres', icons: [SHORTCUT_ICON] },
              {
                name: 'Importar el CSV',
                short_name: 'Importar CSV',
                url: '/coleccion/importar',
                icons: [SHORTCUT_ICON],
              },
            ],
            // Fase 41: «Compartir» from Files or a chat sends the tracker's CSV or a deck's text straight here
            // (public/push-sw.js answers the POST and opens the import screen).
            share_target: {
              action: '/compartir',
              method: 'POST',
              enctype: 'multipart/form-data',
              params: {
                title: 'title',
                text: 'text',
                url: 'url',
                files: [
                  { name: 'file', accept: ['text/csv', '.csv', 'text/comma-separated-values', 'text/plain', '.txt'] },
                ],
              },
            },
          },
          workbox: {
            // Fase 18: the push and notificationclick handlers (public/push-sw.js).
            importScripts: ['/push-sw.js'],
            // Only the built shell is precached: nothing under /api is ever listed because the glob runs over dist/.
            globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
            // deckgym's replay viewer (D-014) is opened now and then: not worth 1,6 MB of precache. The engine of the
            // browser (T-015, 5 MB) is fetched by its Web Worker when a game needs it, and kept (runtimeCaching).
            globIgnores: ['viewer/**', 'engine/**'],
            navigateFallback: '/index.html',
            // The login page is served by the API and must never be answered with the SPA shell.
            navigateFallbackDenylist: [/^\/api/, /^\/login/, /^\/healthz/, /^\/viewer\//],
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            // API responses always hit the network (the session cookie decides). Card images (Fase 22): the
            // tracker's raw GitHub files, fetched with CORS, kept after the first view so the board loads fast and
            // works with a bad signal.
            runtimeCaching: [
              // T-015: the browser's engine, kept after its first load so a game opens with a bad signal or none. Its
              // files are named by their hash (never change); its manifest is asked first and the kept one is used
              // when the network does not answer. Two versions fit: the one in use and the next one.
              {
                urlPattern: ({ url }) => /^\/engine\/engine-[0-9a-f]{12}(?:\.js|_bg\.wasm)$/.test(url.pathname),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'engine',
                  expiration: { maxEntries: 4, maxAgeSeconds: 180 * 24 * 60 * 60 },
                  cacheableResponse: { statuses: [200] },
                },
              },
              {
                urlPattern: ({ url }) => url.pathname === '/engine/manifest.json',
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'engine-manifest',
                  networkTimeoutSeconds: 4,
                  expiration: { maxEntries: 1 },
                  cacheableResponse: { statuses: [200] },
                },
              },
              {
                urlPattern:
                  /^https:\/\/raw\.githubusercontent\.com\/marcelpanse\/tcg-pocket-collection-tracker\/.*\.webp$/,
                handler: 'CacheFirst',
                options: {
                  cacheName: 'card-images',
                  expiration: { maxEntries: 800, maxAgeSeconds: 180 * 24 * 60 * 60 },
                  cacheableResponse: { statuses: [200] },
                },
              },
            ],
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
  // T-015: the engine's Web Worker is an ES module (it imports the WebAssembly glue from /engine/ at run time).
  worker: { format: 'es' },
  test: {
    // D-023: two CI runners share the PC with Postgres and the simulation worker.
    ...(process.env.CI ? { maxWorkers: 4 } : {}),
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Screen tests walk whole flows through lazy routes: room for a slow or busy machine (CI, Windows).
    testTimeout: 20_000,
  },
}))

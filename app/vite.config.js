import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Offline-first (NFR1): precache the app shell; symbol images, audio and the model artefact are
// cached at runtime with a cache-first strategy so the board works with no connection.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'design/icons/*.svg', 'photos/**/*.webp', 'symbols/**/*', 'audio/**/*', 'models/**/*.json'],
      manifest: {
        name: 'Vuga — Amagambo yanjye',
        short_name: 'Vuga',
        description: 'Hitamo amashusho uvuge ubutumwa bwawe mu Kinyarwanda.',
        lang: 'rw',
        display: 'standalone',
        start_url: '/',
        background_color: '#F7F5EC',
        theme_color: '#176B62',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,wav,mp3,json}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(photos|symbols|audio|models)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'vuga-licensed-media-v1', expiration: { maxEntries: 2000 } }
          }
        ]
      }
    })
  ],
  server: { port: 5173 }
})

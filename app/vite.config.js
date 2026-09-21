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
      includeAssets: ['symbols/**/*', 'audio/**/*', 'models/**/*'],
      manifest: {
        name: 'Vuga AAC',
        short_name: 'Vuga',
        description: 'Kinyarwanda-first predictive picture-to-speech board',
        lang: 'rw',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#ffffff',
        theme_color: '#1f4e79',
        icons: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wav,mp3,json}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(symbols|audio|models)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'vuga-media', expiration: { maxEntries: 2000 } }
          }
        ]
      }
    })
  ],
  server: { port: 5173 }
})

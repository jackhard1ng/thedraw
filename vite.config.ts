import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// The Draw is a mobile-web / PWA-first product (spec §3). No app-store dependency for v1.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'The Draw',
        short_name: 'The Draw',
        description:
          'Competition and playing partners for golfers without a regular group.',
        theme_color: '#0A46C2',
        background_color: '#F4F6FA',
        display: 'standalone',
        start_url: '/',
        // PNG sizes real installs use (iOS home screen ignores SVG); the SVG
        // stays as the scalable any-size entry.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const buildIdentifier = process.env.GITHUB_RUN_NUMBER
  ? `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT || '1'}`
  : `${Date.now()}`;
const appVersion = `${packageVersion}+build.${buildIdentifier}`;

// Adds the AdSense loader to <head> (needed for site verification) only when a client ID is configured.
function adsenseHead(client?: string): Plugin {
  return {
    name: 'adsense-head',
    transformIndexHtml: () => client
      ? [{ tag: 'script', injectTo: 'head', attrs: { async: true, crossorigin: 'anonymous', src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}` } }]
      : [],
  };
}

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    adsenseHead(loadEnv(mode, process.cwd(), 'VITE_').VITE_ADSENSE_CLIENT),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: { navigateFallbackDenylist: [/^\/api\//], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
      manifest: {
        name: 'Scandem Receipt Scanner',
        short_name: 'Scandem',
        description: 'Scan POS receipts and export to CSV, Excel, Quicken or QuickBooks.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['test/**/*.test.{js,ts}'] },
}));

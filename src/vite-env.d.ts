/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare const __APP_VERSION__: string;
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' { const url: string; export default url; }

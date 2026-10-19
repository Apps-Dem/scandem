import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, listen } from './app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({
  dbPath: process.env.DB_PATH || path.join(root, '..', 'scandem.db'),
  staticDir: path.join(root, '..', 'dist'),
});
const port = Number(process.env.PORT || 8787);
listen(app, port);
console.log(`scandem local API on :${port}`);

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const { app } = createApp({
  dbPath: process.env.DB_PATH || path.join(root, '..', 'scandem.db'),
  staticDir: path.join(root, '..', 'dist'),
});
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`scandem API on :${port}`));

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHandler } from './core.js';

export { priceInfo } from './core.js';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()
  .map((file) => ({ name: file, sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8') }));

function sqliteAdapter(dbPath) {
  const sql = new DatabaseSync(dbPath);
  sql.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const migration of migrations) {
    if (sql.prepare('SELECT name FROM local_migrations WHERE name = ?').get(migration.name)) continue;
    sql.exec('BEGIN');
    try {
      sql.exec(migration.sql);
      sql.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(migration.name);
      sql.exec('COMMIT');
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    first: async (q, ...p) => sql.prepare(q).get(...p) ?? null,
    run: async (q, ...p) => {
      const r = sql.prepare(q).run(...p);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
  };
}

/** Local/Node server for development and tests; production runs on Cloudflare (worker/index.js). */
export function createApp({ dbPath = ':memory:', env = process.env, now = () => Date.now(), staticDir } = {}) {
  const handle = createHandler({ db: sqliteAdapter(dbPath), env, now });

  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (!staticDir) { res.writeHead(404); return res.end(); }
      let file = path.join(staticDir, path.normalize(url.pathname));
      if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
  };
}

export function listen(app, port) {
  return http.createServer(app).listen(port);
}

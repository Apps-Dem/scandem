// Ensures the shared staging D1 database exists, then writes two generated
// configs: one for applying migrations and one for `wrangler preview`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const NAME = process.env.PREVIEW_DB_NAME || 'scandem-staging';
const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const find = () => JSON.parse(wrangler('d1', 'list', '--json')).find((d) => d.name === NAME);

let db = find();
if (!db) {
  console.log(`Creating D1 database ${NAME}`);
  try {
    wrangler('d1', 'create', NAME);
  } catch (err) {
    // A concurrent run may have created it first.
    if (!find()) throw err;
  }
  db = find();
}
if (!db?.uuid) throw new Error(`Could not resolve D1 database ${NAME}`);

const binding = { database_name: NAME, database_id: db.uuid, migrations_dir: 'server/migrations' };

const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
base.previews = { ...base.previews, d1_databases: [{ binding: 'DB', ...binding }] };
writeFileSync('wrangler.preview.jsonc', JSON.stringify(base, null, 2));

writeFileSync(
  'wrangler.preview-migrations.jsonc',
  JSON.stringify({ name: base.name, d1_databases: [{ binding: 'PREVIEW_DB', ...binding }] }, null, 2),
);
console.log(`Staging D1 ${NAME} (${db.uuid}) ready`);

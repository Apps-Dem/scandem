# Scandem

PWA that scans POS receipts (photos/PDF) with Cloudflare Workers AI (Moondream 3) and exports CSV (ZIP of receipts + line items), Excel, Quicken (QIF) or QuickBooks (IIF).

- First receipt per device is free; after that a $5 USD (EC$14, rounded up from the 2.70 peg) 24h pass is required. Devices are identified by a client fingerprint hash + cookie (either match counts).
- Payments are a stub (`POST /api/pay/mock-complete`); replace with a real provider.
- Photos and rendered PDF pages are sent to Cloudflare Workers AI for OCR and are not stored by Scandem. Tally and results live in `localStorage`; cleared on download or after 30 min idle.
- Ads: `AdSlot` placeholders (top / inline / bottom); set `VITE_ADSENSE_*` (see `.env.example`) to go live.

## Run
Requires Node >= 22 (the local server uses `node:sqlite`). Production runs on Cloudflare Workers + D1 (`worker/index.js`, `wrangler.jsonc`); both share `server/core.js`.

    npm run dev                  # Vite :5173 + local Node API :8787 (local Node API has no cloud OCR binding)
    npm run build && npm start   # production on :8787
    npm run cf:dev               # local Worker with Cloudflare bindings, including Workers AI
    npm test

Run `npm run db:migrate:local` before the first `npm run cf:dev` to initialize local D1.

## Toggle payment requirement
    curl -X PUT localhost:8787/api/admin/settings -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'content-type: application/json' -d '{"paymentsRequired": false}'

## Deploy (Cloudflare, scandem.alldem.app)
    npx wrangler login
    npx wrangler d1 create scandem          # once; paste database_id into wrangler.jsonc if not auto-provisioned
    npm run db:migrate:remote
    npx wrangler secret put ADMIN_TOKEN
    npm run deploy

`PAYMENTS_REQUIRED` is `"false"` at launch (free for everyone; toggle via the admin API). `MOCK_PAYMENTS` is `"false"`: until a real payment provider is wired up, nobody can buy a pass in production.

## CI/CD
`.github/workflows/deploy.yml` runs tests + build on every push/PR, and on pushes to `main` applies D1 migrations and deploys to Cloudflare. Repo secrets required: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Workers Routes: Edit, Zone: Read) and `CLOUDFLARE_ACCOUNT_ID`. `ADMIN_TOKEN` stays a Worker secret (not touched by CI).

### PR previews
`.github/workflows/preview.yml` deploys every same-repo PR as a Worker Preview (`pr-<number>`) at `https://pr-<number>.preview.alldem.app`, comments the URL on the PR, and deletes the preview when the PR closes. Previews use mock payments, Workers AI, and one shared staging D1 database (`scandem-staging`) that `scripts/provision-preview-db.mjs` creates on first run, then migrates before each deploy. The same `CLOUDFLARE_API_TOKEN` is used (D1: Edit is enough). `*.preview.alldem.app` must be protected by a Cloudflare Access application. Preview Worker settings live in the `previews` block of `wrangler.jsonc`.

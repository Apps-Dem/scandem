# Scandem

PWA that scans POS receipts (photos/PDF) with in-browser OCR (Tesseract.js) and exports CSV (ZIP of receipts + line items), Excel, Quicken (QIF) or QuickBooks (IIF).

- First receipt per device is free; after that a $5 USD (EC$14, rounded up from the 2.70 peg) 24h pass is required. Devices are identified by a client fingerprint hash + cookie (either match counts).
- Payments are a stub (`POST /api/pay/mock-complete`); replace with a real provider.
- Tally and results live in `localStorage`; cleared on download or after 30 min idle.
- Ads: `AdSlot` placeholders (top / inline / bottom); set `VITE_ADSENSE_*` (see `.env.example`) to go live.

## Run
Requires Node >= 22 (the local server uses `node:sqlite`). Production runs on Cloudflare Workers + D1 (`worker/index.js`, `wrangler.jsonc`); both share `server/core.js`.

    npm run dev                  # Vite :5173 + API :8787
    npm run build && npm start   # production on :8787
    npm test

## Toggle payment requirement
    curl -X PUT localhost:8787/api/admin/settings -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'content-type: application/json' -d '{"paymentsRequired": false}'

## Anonymized debug log
After each download attempt the client posts an anonymized log to `POST /api/debug-log`, and the Worker emails it to support@boundless-tallawah.com via Cloudflare Email Service (`send_email` binding `EMAIL`). It contains build version, paywall status (enabled/disabled), counts (accepted/processed/successful/failed), per-attempt source (photo/upload + file type), size, OCR time, OCR and parser confidence, error class + redacted message, and download stage (`prepare` / `download`) and outcome. It never contains uploaded images, OCR text, receipt data or file names. Disable with `DEBUG_LOG_ENABLED="false"` (default `"true"`). The sender domain must be onboarded: `npx wrangler email sending enable boundless-tallawah.com`.

## Deploy (Cloudflare, scandem.alldem.app)
    npx wrangler login
    npx wrangler d1 create scandem          # once; paste database_id into wrangler.jsonc if not auto-provisioned
    npm run db:migrate:remote
    npx wrangler secret put ADMIN_TOKEN
    npm run deploy

`PAYMENTS_REQUIRED` is `"false"` at launch (free for everyone; toggle via the admin API). `MOCK_PAYMENTS` is `"false"`: until a real payment provider is wired up, nobody can buy a pass in production.

## CI/CD
`.github/workflows/deploy.yml` runs tests + build on every push/PR, and on pushes to `main` applies D1 migrations and deploys to Cloudflare. Repo secrets required: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Workers Routes: Edit, Zone: Read) and `CLOUDFLARE_ACCOUNT_ID`. `ADMIN_TOKEN` stays a Worker secret (not touched by CI).

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

## Deploy (Cloudflare, scandem.alldem.app)
    npx wrangler login
    npx wrangler d1 create scandem          # once; paste database_id into wrangler.jsonc if not auto-provisioned
    npm run db:migrate:remote
    npx wrangler secret put ADMIN_TOKEN
    npm run deploy

`MOCK_PAYMENTS` is `"false"` in `wrangler.jsonc`: until a real payment provider is wired up, nobody can buy a pass in production.

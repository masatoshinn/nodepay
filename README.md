# NodePay

**Non-custodial crypto payment gateway.** Merchants bring their own wallet addresses, customers pay *directly* to
those wallets, and NodePay only **detects and confirms** payments. The platform never holds, moves, or has access to
funds — there are no custodial balances, no withdrawals, and no private keys anywhere in the system.

Like a simplified BTCPay Server with the convenience of hosted checkout (à la NOWPayments).

- **Merchants:** email + password sign-up, optional TOTP 2FA, no KYC
- **Networks:** BTC · LTC · ETH · BSC (BNB/USDT/USDC) · TRON (TRX/USDT)
- **Stack:** React + Vite + TS + Tailwind + React Router + TanStack Query · Node/Express (TS) · PostgreSQL + Prisma · Redis + BullMQ

---

## How it works

```
 Customer                     NodePay API                      Merchant wallet
    │  opens /pay/:invoiceId      │                                │
    │────────────────────────────►│  rate locked (CoinGecko)       │
    │                             │  unique address / amount       │
    │◄──── QR + address + amount ─┤                                │
    │                             │                                │
    │  pays on-chain ─────────────┼───────────────────────────────►│ funds go straight
    │                             │                                │ to the merchant
    │                             │  watcher (BullMQ) polls        │
    │                             │  TronGrid / Etherscan /        │
    │                             │  mempool.space                 │
    │                             │  WAITING → DETECTED →          │
    │◄──── live status polling ───┤  CONFIRMING (x/y) → PAID       │
    │                             │─── webhook (HMAC) ────────────►│ merchant backend
```

### Payment matching (no private keys, ever)

| Mode | Used for | How it works |
|---|---|---|
| `HD` | any network, merchant supplies an **xpub** | A unique address is derived per invoice (`xpub → m/84'/0'/0'/0/i`). xpub only — private keys are rejected at input validation. |
| `AMOUNT_OFFSET` | TRON + stablecoins with a single address | Each invoice gets a unique tiny decimal offset (e.g. `10.000137` USDT), matched **exactly** within a time window. |
| `STATIC` | single BTC/EVM address | Match on destination address (+ amount sanity check). |

Exchange rates come from CoinGecko and are **locked into the invoice** (`lockedRate`) for its whole lifetime.

### Confirmation targets

| Network | Confirmations | Explorer provider |
|---|---|---|
| BTC | 2 | mempool.space (esplora-compatible) |
| LTC | 6 | litecoinspace (esplora-compatible) |
| ETH | 12 | Etherscan V2 |
| BSC | 15 | Etherscan V2 (chainid 56) |
| TRON | 19 | TronGrid |

All providers sit behind a `ChainProvider` interface (`server/src/watchers/providers/`) so RPC vendors can be swapped
via env vars alone.

### Idempotency

`Payment` rows are unique on `(network, txHash)` — the same transaction can never be credited twice, even if workers
overlap or a provider returns duplicates. `invoice.confirmed` fires exactly once (guarded by a credited flag).

---

## Repository layout

```
├── docker-compose.yml        # postgres + redis + api + worker + nginx web
├── .env.example
├── server/                   # Express API + BullMQ workers
│   ├── prisma/schema.prisma  # full data model
│   └── src/
│       ├── app.ts, index.ts  # HTTP app
│       ├── config.ts         # zod-validated env
│       ├── lib/              # prisma, redis, jwt, crypto(AES-GCM), rates, hd, address, uri, webhooks…
│       ├── middleware/       # JWT auth, API-key auth, rate limits
│       ├── routes/           # auth, wallets, api-keys, webhooks, invoices, payments, stats, admin, v1, public
│       ├── services/         # invoiceService, paymentService (matching/state machine)
│       ├── watchers/         # ChainProviders + scanner
│       └── workers/main.ts   # webhook deliveries, chain scanning, expiry
└── client/                   # React dashboard + hosted checkout
    └── src/
        ├── pages/            # Dashboard, Invoices, InvoiceDetail, Payments, Wallets, ApiKeys,
        │                     # Webhooks, Settings, Docs, Admin, Checkout (/pay/:id), Login, Register
        ├── components/       # Layout, StatusBadge, CopyButton, Modal…
        └── lib/              # api client (auto token refresh), auth context, format helpers
```

---

## Quick start

The app needs a Postgres (Supabase works out of the box) and a Redis. The API applies the schema
automatically on boot (`prisma db push`), so there is no manual migration step.

### Option A — Docker + Supabase (hosted Postgres, recommended)

1. Create a free project at [supabase.com](https://supabase.com), then copy the connection string:
   **Dashboard → Project → Settings → Database → Connection string → URI** (mode: *Transaction pooler*,
   port `6543`) — keep the trailing `?sslmode=require`.
2. Paste it into `server/.env` → `DATABASE_URL=...` (this file is gitignored; never commit it).
   *Alternative:* run the DDL directly — paste [`server/prisma/supabase.sql`](server/prisma/supabase.sql)
   into **Supabase → SQL Editor → New query → Run** (creates all 10 tables).
3. Boot:

```bash
docker compose up -d --build        # postgres service is NOT started (Supabase is used)
# API    → http://localhost:4000/api/health
# Web    → http://localhost:8080  (dashboard + checkout, /api proxied to the API)

# seed the admin user (email/password from server/.env: ADMIN_EMAIL / ADMIN_PASSWORD)
docker compose exec api npx tsx prisma/seed.ts
```

No local Postgres container is needed; Redis still runs in Docker.

### Option B — Docker + local Postgres

```bash
cp .env.example server/.env         # keep DATABASE_URL=postgresql://nodepay:nodepay@localhost:5432/nodepay
docker compose --profile localdb up -d --build
# API    → http://localhost:4000/api/health
# Web    → http://localhost:8080
docker compose exec api npx tsx prisma/seed.ts
```

### Option C — local development (no Docker for the DB)

Prereqs: Node 20+, Redis 6+, and a Postgres — either Supabase (paste the URI into `server/.env`)
or local: `docker compose --profile localdb up -d postgres redis`.

```bash
# 1. env — server/.env (local dev) must contain DATABASE_URL + secrets:
#    cp .env.example server/.env   then edit DATABASE_URL (Supabase URI or local)

npm install --prefix server
npm install --prefix client

npm run db:push --prefix server            # create schema
ADMIN_PASSWORD=change-me npm run db:seed --prefix server   # (or ADMIN_PASSWORD already in server/.env)

# terminal 1 — API on :4000
npm run dev:server
# terminal 2 — workers (chain scanner, webhooks, expiry)
npm run dev:worker
# terminal 3 — dashboard on :5173 (proxies /api → :4000)
npm run dev:client
```

Open http://localhost:5173 → sign up → **Wallets → Add wallet** (address or xpub) → **Invoices → New invoice** →
open the checkout link.

> Tip: to test detection without waiting for real funds, run BTC/ETH/TRON testnet providers by overriding
> `MEMPOOL_SPACE_URL` / `ETHERSCAN_API_BASE` / `TRONGRID_API_BASE` and using testnet addresses/paths.

---

## Environment variables

See `.env.example` for the full annotated list. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Postgres / Redis connections |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | access + refresh token signing |
| `ENCRYPTION_KEY` | 64 hex chars — AES-256-GCM for webhook secrets & TOTP seeds at rest |
| `ETHERSCAN_API_KEY` | ETH + BSC explorer access (V2 multi-chain) |
| `TRONGRID_API_KEY`, `MEMPOOL_SPACE_URL`, `LITECOIN_API_BASE` | other providers |
| `INVOICE_TTL_MINUTES`, `SCAN_INTERVAL_MS`, `BTC_SCAN_INTERVAL_MS` | invoice lifetime + watcher cadence |
| `ALLOW_PRIVATE_WEBHOOKS` | only `true` in local dev (SSRF guard blocks localhost targets) |

---

## Merchant API (`/api/v1`)

Auth: `X-API-Key: npk_…` + `X-API-Secret: nps_…` (secret shown once, stored as SHA-256 hash).

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/invoices` | create invoice `{amount, currency, coin, network, order_id?, ttl_minutes?…}` |
| GET | `/api/v1/invoices` | list (filters: `status`, `order_id`, `limit`, `offset`) |
| GET | `/api/v1/invoices/:id` | fetch by invoice id |
| POST | `/api/v1/invoices/:id/cancel` | cancel a waiting invoice |
| GET | `/api/v1/balance` | non-custodial notice + accrued platform fees |

Dashboard endpoints use `Authorization: Bearer <access token>` under `/api/{wallets,api-keys,invoices,payments,stats,webhooks,admin}`.
Full docs live in the dashboard at **API Docs** (`/docs` page, served by the app).

### Webhooks

Events: `invoice.detected` · `invoice.confirmed` · `invoice.expired` · `invoice.underpaid`

```
X-BazilPay-Event: invoice.confirmed
X-BazilPay-Delivery: <delivery id>
X-BazilPay-Signature: t=<unix>,v1=<hex>       # HMAC-SHA256 over `${t}.${rawBody}`
```

- Retries: 6 attempts, exponential backoff (5s → 10s → 20s …), manual **Retry** button in the dashboard
- Replay protection: unique `(endpoint, event id)` + timestamped signature (reject `t` older than 5 min)
- Delivery logs store HTTP status, response body and error for every attempt

---

## Platform fees (non-custodial)

Implemented as **Option B**: NodePay accrues `feeBps` per confirmed invoice (`FeeAccrual` rows, 1% on the FREE plan,
0% on PRO). Nothing is ever deducted from a payment — merchants settle outstanding fees periodically by paying a fee
invoice themselves, and the admin panel marks accruals `ACCRUED → BILLED → PAID`. Plans are switched per merchant in
the admin panel (`/admin`).

Admin panel: merchant list (volume, invoice counts, fees), suspend/reactivate merchants, fee ledger, platform stats
and a recent audit log.

---

## Security

- **Non-custodial by architecture** — no private keys, no withdrawals, no hot wallets
- Passwords: bcrypt (cost 12) · JWT access (15m) + rotating refresh tokens (hashed at rest)
- Optional TOTP 2FA (otplib), secrets encrypted at rest (AES-256-GCM)
- zod validation on every input, address format validation per network (incl. bech32/base58check/EIP-55/TRON checks)
- API keys: public + secret pair, SHA-256-hashed, regenerate/revoke, last-used tracking
- Rate limiting globally, stricter on auth + checkout polling
- CORS allow-list, helmet security headers, SSRF guard on webhook URLs
- Webhook HMAC signatures + replay protection; secrets encrypted, shown once
- Audit log for sensitive actions (auth, wallet/key/webhook changes, exports, admin actions)
- Admin role with suspend-merchant capability

---

## Verification

```bash
npm run typecheck          # tsc for both server and client
npm run build              # production build for both
```

## Known limitations / roadmap

- Amount-offset matching is inherently ambiguous if two open invoices share the same amount — NodePay refuses to guess
  and logs the ambiguity (HD xpub mode avoids this entirely; prefer it for BTC/EVM).
- Watcher pages are capped to each provider's "recent transactions" window (fine for an invoice's short lifetime).
- `USDC@TRON` contract constant is set in `server/src/lib/chains.ts` — verify it against Circle's current deployment.
- Suggested next steps: testnet presets, SSE/WebSocket checkout updates, BIP21 amount rounding options, multi-employee
  accounts, invoice webhooks for the `overpaid` event.

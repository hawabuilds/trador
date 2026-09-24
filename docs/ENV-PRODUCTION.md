# Production environment variables

Copy-paste blocks for **Railway** (`trador-indexer`) and **Vercel** (`trador`). Use
placeholder values below — never commit real secrets. Local dev uses a single
`.env.local`; see `.env.local.example` for the full variable list.

Operational detail for the worker (pooler URL, restarts, logs): [RAILWAY.md](../RAILWAY.md).

---

## Railway — `trador-indexer`

Discovery sweeps and tape maintenance. **Do not** set `SOLANA_RPC_URL` or
`SERVER_RPC_URL` here unless you intend to bill Alchemy for indexer traffic.

```env
# Postgres (session pooler — see RAILWAY.md; not the direct db.* host)
DATABASE_URL=<paste Supabase pooler URL: postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432>

# Helius key A — getProgramAccounts V2 sweeps only
INDEXER_RPC_URL=<paste Helius indexer key URL, e.g. https://mainnet.helius-rpc.com/?api-key=...>

# Free mainnet for signature lists + raw getTransaction (spares Helius quota)
RAW_TX_RPC_URL=https://api.mainnet-beta.solana.com

# Optional: parsed tx fallback when tapes are not in Postgres (key can match URL api-key=)
HELIUS_API_KEY=<paste Helius API key if separate from INDEXER_RPC_URL>
# HELIUS_RPC_URL=<same as indexer URL only if you rely on embedded api-key= and omit HELIUS_API_KEY>

# Decoration (prices, metadata)
COINGECKO_API_KEY=<paste CoinGecko key>
COINGECKO_API_PLAN=analyst

# Optional tuning
# INDEX_INTERVAL_MS=90000
# GRADUATING_EVERY=20
# HELIUS_PARSE_MAX_PER_ROUND=50
```

**Do not set on Railway:** `SERVER_RPC_URL`, `SOLANA_RPC_URL` (app wallet reads), `NEXT_PUBLIC_*`,
`PRIVY_*`, `DATABASE_URL` on Vercel (see below).

---

## Vercel — `trador` (Next.js app)

Wallet balances, `/api/rpc`, launch confirm, PostgREST reads. **Do not** set
`INDEXER_RPC_URL` — discovery runs on Railway only.

```env
# App origin (metadata, OG, share links)
NEXT_PUBLIC_APP_URL=https://trador.fun

# Privy (allowed origins must include your Vercel domains)
NEXT_PUBLIC_PRIVY_APP_ID=<paste Privy app id>
PRIVY_APP_SECRET=<paste Privy app secret>

# Chain RPC — Alchemy (or a dedicated non-indexer Helius key)
SOLANA_RPC_URL=<paste Alchemy mainnet URL>
# Optional: same URL; overrides SOLANA on server-only paths (/api/rpc, launch)
SERVER_RPC_URL=<paste same Alchemy URL or leave unset to use SOLANA_RPC_URL>

# Parsed txs on server (optional if worker owns Helius parse; omit to avoid sharing indexer credits)
# HELIUS_RPC_URL=
# HELIUS_API_KEY=

# Supabase — PostgREST only (no direct DATABASE_URL on Vercel)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key>
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key>

# Cron routes (/api/cron/*)
CRON_SECRET=<paste long random secret>

# Market data
COINGECKO_API_KEY=<paste CoinGecko key>
COINGECKO_API_PLAN=analyst

# Fees (optional until collector wSOL ATA exists)
NEXT_PUBLIC_FEE_BPS=50
# NEXT_PUBLIC_FEE_WALLET=<collector wallet OR initialized wSOL token account>

# Push notifications (optional)
# NEXT_PUBLIC_VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:you@example.com

# MoonPay (optional)
# NEXT_PUBLIC_MOONPAY_API_KEY=
# MOONPAY_SECRET_KEY=

# Shared cache (optional — cold start feed from Redis)
# KV_REST_API_URL=
# KV_REST_API_TOKEN=
```

**Do not set on Vercel:** `INDEXER_RPC_URL`, `DATABASE_URL` / `POSTGRES_URL` (opens per-invocation
`pg` pools and exhausts Supabase). Worker heartbeats make `/api/cron/index` a no-op when Railway
is healthy.

---

## Local vs production split (RPC)

| Variable | Local `.env.local` | Railway indexer | Vercel app |
| --- | --- | --- | --- |
| `SOLANA_RPC_URL` | Alchemy | omit | Alchemy |
| `SERVER_RPC_URL` | same as Alchemy | omit | optional, same as Alchemy |
| `INDEXER_RPC_URL` | Helius key A (worker) | Helius key A | **unset** |
| `HELIUS_RPC_URL` | Helius (parse / scripts) | optional alias | optional, not indexer key |
| `RAW_TX_RPC_URL` | public mainnet | public mainnet | omit unless needed |

If you only maintain one Helius URL locally, set `INDEXER_RPC_URL` and leave
`HELIUS_RPC_URL` equal to it for `npm run worker`; the worker accepts either name.

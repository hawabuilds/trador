# The indexer on Railway

The worker is the only thing that runs here. Vercel serves the app; this
process is what keeps the universe growing.

## Why a worker at all

Discovery is the one path with no graceful degradation. If a price provider
fails, the feed renders from the store with a stale mark and says so. If
discovery stops, new coins simply never appear — and nothing errors, because
there is no request to fail. So discovery runs as an always-on loop rather
than as a cron, and writes a heartbeat that `/api/cron/index` reads to decide
whether Vercel needs to index at all.

## Shape

One project, `trador-indexer`, one service, `trador-indexer`, one replica.

**One service, not two.** An earlier plan had a second cron service refreshing
prices. The worker's own pass already does discovery *and* decoration, so a
second service would re-price the same coins on a different schedule and
double the RPC bill for nothing.

**One replica, deliberately.** The sweep is idempotent, so a second replica
would not corrupt anything — it would pay twice for the same work and leave
the write ordering between them undefined. One replica plus a heartbeat is
the whole concurrency design.

**Restart ALWAYS.** A worker that has exited is a feed that has stopped
growing, silently. It has to come back on its own.

## Build

Railway builds this with **Railpack**, not Nixpacks. That is worth writing
down because it is not what `railway.toml` asks for: the file says
`builder = "NIXPACKS"` and Railway ignores it. The first deploy ran a full
`next build` — several minutes spent producing a Next.js app this service
never serves — because `nixpacks.toml` was never read.

`railpack.json` is the file that actually takes effect:

- `packages.node = "24"` — the worker runs TypeScript directly through Node's
  own type stripping, unflagged since 22.18. A builder that picked 22.12
  would start the service, fail on the first import, and restart forever.
- `steps.build` is a no-op echo. There is no build: the worker is not the app.
- `deploy.startCommand` is `npm run worker`.

`railway.toml` is kept only for `restartPolicyType` and `numReplicas`, which
it does honour. Note that config-as-code sunsets **2026-12-01** in favour of
`.railway/railway.ts`; the migration is a one-liner but today's SDK and CLI
disagree on a version check, so it waits.

## Environment

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | The worker writes in batches, so it takes the direct Postgres path, not PostgREST. **Must be the pooler host — see below.** |
| `INDEXER_RPC_URL` or `HELIUS_RPC_URL` | Discovery sweeps (`getProgramAccountsV2` on Helius; falls back to classic GPA elsewhere). A public RPC rate-limits the pump.fun sweep — 9 of 29 calls failed. Helius took a full pass from minutes to 36 seconds. **Do not set `SOLANA_RPC_URL` here** unless you intend to keep paying Alchemy for indexer traffic. |
| `RAW_TX_RPC_URL` | Signature lists and raw transaction reads for trade tapes. Set to `https://api.mainnet-beta.solana.com` so Helius quota stays on sweeps and wallet-shaped reads, not one `getSignaturesForAddress` per coin per round. Defaults to that public URL when unset. |
| `HELIUS_API_KEY` | Parsed transaction batches (when tapes are not served from `coin_tapes` in Postgres). Optional if `HELIUS_RPC_URL` embeds `api-key=`. |
| `HELIUS_PARSE_MAX_PER_ROUND` | Optional. Caps Enhanced parse signatures per `keepTapes` round (default `50`). Tapes prefer `RAW_TX_RPC_URL` + `getTransaction`; Helius parse is fallback only. |
| `COINGECKO_API_KEY`, `COINGECKO_API_PLAN` | Decoration only. Absent, prices fall down the ladder. |
| `INDEX_INTERVAL_MS` | Optional. Defaults to 90s. A reconciler is idempotent, so this is a cost dial. |
| `GRADUATING_EVERY` | Optional. Defaults to `20`. How often the expensive graduating pump sweep runs (every N worker passes). |

**Two Helius keys (required for ~60k credits/day on V2 sweeps):**

| Host | Set | Do **not** set |
| --- | --- | --- |
| **Railway** `trador-indexer` | `INDEXER_RPC_URL` (Helius key A), `RAW_TX_RPC_URL=https://api.mainnet-beta.solana.com`, `DATABASE_URL`, CoinGecko | `SERVER_RPC_URL`, `SOLANA_RPC_URL` (unless you intend Alchemy for sweeps) |
| **Vercel** app | `SERVER_RPC_URL` or `SOLANA_RPC_URL` (Helius key B or Alchemy) for `/api/rpc`, launch, **wallet balances** | `INDEXER_RPC_URL` — discovery sweeps belong on Railway only |

Wallet balances (`walletBalanceRpcUrls`) never use `INDEXER_RPC_URL` and avoid `HELIUS_RPC_URL` unless nothing else is configured (one-time warning). On Vercel, set **`SOLANA_RPC_URL`** (or `SERVER_RPC_URL`) so Stonkfolio reads do not share the indexer key.

The worker logs `discovery=gpa-v2` when every sweep used Helius V2, or `discovery=gpa-v1` if any pass fell back to classic `getProgramAccounts`. Startup logs `indexer rpc=…` and reminds you to keep **`numReplicas = 1`** in `railway.toml`.

`/api/cron/index` on Vercel defers to a fresh worker heartbeat and warns if it would index using `HELIUS_RPC_URL` without `INDEXER_RPC_URL`.

**Not on Railway:** `SERVER_RPC_URL` is for the Next app. The worker does not serve pages.

**`DATABASE_URL` is deliberately NOT set on Vercel.** Setting it there would
make every serverless function take the `pg` path and open a connection per
invocation, which exhausts the pool under any real traffic. Vercel reads
through PostgREST; only batch workloads get a direct connection.

### The pooler, and why the direct host cannot work here

Railway's `DATABASE_URL` points at

```
aws-0-eu-west-2.pooler.supabase.com:5432   user: postgres.<project-ref>
```

not at `db.<project-ref>.supabase.co:5432`, which is what Supabase's dashboard
hands you and what `.env.local` still uses.

The direct host resolves to **AAAA only** — no A record at all — and Railway's
container has no IPv6 route. So the worker started cleanly, failed its first
connection with `connect ENETUNREACH 2a05:d01c:…:5432`, exited, and restarted
forever. It presents as a crash loop with a network error, which reads like a
credentials or firewall problem and is neither: the address family is simply
unreachable. Any host-based debugging is wasted, because no password would
have helped.

The pooler is dual-stack, which fixes it. Two details are easy to get wrong:

- The **username changes** to `postgres.<project-ref>`. The pooler routes by
  it — that is how one hostname serves every project in a region.
- The **region is part of the hostname** and nothing in the REST API reports
  it. `CF-RAY` shows your own Cloudflare edge, not the project's region. It
  was found by probing: a wrong region answers "Tenant or user not found"
  immediately, so exactly one candidate authenticates.

Port **5432 is session mode**, which is the right choice here. Transaction
mode (6543) exists for serverless, and trades away prepared statements and
session state for connection density this worker does not need — it holds a
pool of 4 for the process lifetime.

`.env.local` keeps the direct host because a developer machine has working
IPv6 and it is one less thing to rotate. If a local run ever fails the same
way, swap in the pooler URL above.

## Operating it

```bash
railway logs --service trador-indexer            # runtime
railway logs --service trador-indexer --build    # build
railway up --service trador-indexer --detach     # deploy from this directory
railway variables --service trador-indexer       # what is set
```

A healthy pass looks like:

```
[worker ...] stonkfun: scanned 1023, stock-paired 276, wrote 276, 3 rpc
[worker ...] pumpfun: scanned 50, stock-paired 50, wrote 50, 30 rpc
[worker ...] decorated 325 named / 326 priced in 36000ms
```

If `heartbeat_at` in `indexer_state` stops advancing, the worker is down and
the feed is frozen at whatever it last knew. That is the alert worth having.

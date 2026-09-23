/**
 * Which RPC URL each path uses.
 *
 * One URL for everything is how a single Alchemy key ends up billed for both
 * wallet traffic and ninety `getProgramAccounts` sweeps per minute. Splitting
 * them lets the indexer run on a Helius plan while the app uses the same host
 * for light reads — or a cheaper host for signature lists via `RAW_TX_RPC_URL`.
 */

/** Wallet proxy, launch confirm, registration, portfolio reads. */
export function serverRpcUrl(): string {
  return (
    process.env.SERVER_RPC_URL ||
    process.env.HELIUS_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

/**
 * Discovery sweeps only. Set on the Railway worker (`INDEXER_RPC_URL` or
 * `HELIUS_RPC_URL`). Leave unset on Vercel so a serverless cold start never
 * pays for a full reconcile pass unless cron is deliberately filling in.
 */
export function indexerRpcUrl(): string {
  return (
    process.env.INDEXER_RPC_URL ||
    process.env.HELIUS_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com"
  );
}

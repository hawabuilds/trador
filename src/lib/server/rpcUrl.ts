/**
 * Which RPC URL each path uses.
 *
 * One URL for everything is how a single Helius key ends up billed for both
 * wallet traffic and ninety `getProgramAccounts` sweeps per minute. Splitting
 * them lets the indexer run on a dedicated Helius plan while the app uses a
 * separate host for light reads — and `RAW_TX_RPC_URL` for signature lists.
 */

let warnedWalletHelius = false;
let warnedServerSharedHelius = false;

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t || undefined;
}

/** Host for logs — api-key query param redacted. */
export function rpcUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("api-key")) {
      parsed.searchParams.set("api-key", "…");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function indexerUrl(): string | undefined {
  return trimmed(process.env.INDEXER_RPC_URL);
}

function heliusUrl(): string | undefined {
  return trimmed(process.env.HELIUS_RPC_URL);
}

/** True when the same URL string is used for indexer sweeps and Helius app alias. */
export function indexerHeliusUrlsMatch(): boolean {
  const indexer = indexerUrl();
  const helius = heliusUrl();
  return Boolean(indexer && helius && indexer === helius);
}

function isIndexerRpc(url: string): boolean {
  const indexer = indexerUrl();
  return Boolean(indexer && url === indexer);
}

/**
 * Wallet proxy, launch confirm, registration, portfolio reads.
 *
 * Order: `SERVER_RPC_URL`, then `SOLANA_RPC_URL`, then `HELIUS_RPC_URL`.
 * Skips URLs that match `INDEXER_RPC_URL` so a mis-set Vercel env does not
 * spend indexer credits on `/api/rpc`.
 */
export function serverRpcUrl(): string {
  const server = trimmed(process.env.SERVER_RPC_URL);
  if (server) return server;

  const solana = trimmed(process.env.SOLANA_RPC_URL);
  if (solana && !isIndexerRpc(solana)) return solana;

  const helius = heliusUrl();
  const sharedWithIndexer = helius && isIndexerRpc(helius);
  if (helius && !sharedWithIndexer) return helius;

  if (sharedWithIndexer && !warnedServerSharedHelius) {
    warnedServerSharedHelius = true;
    console.warn(
      "HELIUS_RPC_URL matches INDEXER_RPC_URL; server RPC will not use it. Set SERVER_RPC_URL or SOLANA_RPC_URL on Vercel.",
    );
  }

  if (solana) return solana;

  return "https://api.mainnet-beta.solana.com";
}

/**
 * Plain JSON-RPC for wallet balances (`getBalance`, `getTokenAccountsByOwner`).
 *
 * Never uses `INDEXER_RPC_URL`. Does not use `HELIUS_RPC_URL` in the normal
 * chain — Helius is reserved for parsed transactions — only as a last resort
 * with a one-time warning.
 */
export function walletBalanceRpcUrls(): string[] {
  const urls: string[] = [];
  const add = (value: string | undefined, allowIndexerMatch = false) => {
    const url = trimmed(value);
    if (!url || urls.includes(url)) return;
    if (!allowIndexerMatch && isIndexerRpc(url)) return;
    urls.push(url);
  };

  add(process.env.SOLANA_RPC_URL);
  add(process.env.SERVER_RPC_URL);

  const publicMainnet = "https://api.mainnet-beta.solana.com";
  if (!urls.includes(publicMainnet)) urls.push(publicMainnet);

  const helius = heliusUrl();
  if (helius && !isIndexerRpc(helius) && !urls.includes(helius)) {
    if (!warnedWalletHelius) {
      warnedWalletHelius = true;
      console.warn(
        "Wallet balances using HELIUS_RPC_URL as last resort; set SOLANA_RPC_URL to spare indexer credits.",
      );
    }
    urls.push(helius);
  }

  return urls;
}

/** Test hook: reset one-shot wallet / server Helius warnings. */
export function resetRpcUrlWarningsForTests(): void {
  warnedWalletHelius = false;
  warnedServerSharedHelius = false;
}

export function walletBalanceRpcUrl(): string {
  return walletBalanceRpcUrls()[0];
}

/**
 * Discovery sweeps only. Set on the Railway worker (`INDEXER_RPC_URL` or
 * `HELIUS_RPC_URL`). Leave unset on Vercel so a serverless cold start never
 * pays for a full reconcile pass unless cron is deliberately filling in.
 */
export function indexerRpcUrl(): string {
  return (
    indexerUrl() ||
    heliusUrl() ||
    trimmed(process.env.SOLANA_RPC_URL) ||
    "https://api.mainnet-beta.solana.com"
  );
}

/** Whether cron / worker index path has a dedicated indexer URL vs app Helius only. */
export function cronIndexerUsesSharedHelius(): boolean {
  if (indexerUrl()) return false;
  return Boolean(heliusUrl() && process.env.VERCEL === "1");
}

/**
 * Helius `getProgramAccountsV2`: same filters as classic GPA, cursor pagination.
 * Indexer discovery uses this to cut sweep cost (roughly 1 vs 10 credits per call).
 */

const DEFAULT_PAGE_LIMIT = 5000;

export type ProgramAccountGpaConfig = {
  encoding?: string;
  commitment?: string;
  filters?: unknown[];
  dataSlice?: {offset: number; length: number};
  limit?: number;
  paginationKey?: string;
  changedSinceSlot?: number;
  withContext?: boolean;
};

export type ProgramAccountEntry = {
  pubkey: string;
  account: {data: [string, string]};
};

type V2Page = {
  accounts: ProgramAccountEntry[];
  paginationKey: string | null;
};

export type RpcInvoke = <T>(method: string, params: unknown[]) => Promise<T>;

let roundUsedClassicGpa = false;

function indexerRpcHost(): string | null {
  const raw =
    process.env.INDEXER_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim() ||
    "";
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function warnClassicGpaFallback(programId: string, error: unknown): void {
  roundUsedClassicGpa = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `getProgramAccountsV2 failed for ${programId}; falling back to getProgramAccounts. ${message}`,
  );
  const host = indexerRpcHost();
  if (host && !/helius/i.test(host)) {
    console.warn(
      "Indexer RPC is not Helius — use a Helius URL in INDEXER_RPC_URL for V2 sweeps (~1 credit/page vs ~10 for classic GPA).",
    );
  }
}

function isGpaV2Unsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /method not found/i.test(message) ||
    /-32601/.test(message) ||
    (/getProgramAccountsV2/i.test(message) &&
      /not found|unknown method|unsupported|invalid method/i.test(message))
  );
}

function classicConfig(config: ProgramAccountGpaConfig): ProgramAccountGpaConfig {
  const {
    limit: _limit,
    paginationKey: _paginationKey,
    changedSinceSlot: _changedSinceSlot,
    withContext: _withContext,
    ...rest
  } = config;
  return rest;
}

function pageLimit(config: ProgramAccountGpaConfig): number {
  const limit = config.limit;
  if (typeof limit === "number" && limit >= 1 && limit <= 10_000) return limit;
  return DEFAULT_PAGE_LIMIT;
}

/** Reset per `indexAll` pass — worker logs `discovery=gpa-v2|gpa-v1` from this. */
export function resetGpaDiscoveryMetrics(): void {
  roundUsedClassicGpa = false;
}

/** Label for worker / cron logs after a discovery pass. */
export function gpaDiscoveryLabel(): "gpa-v2" | "gpa-v1" {
  return roundUsedClassicGpa ? "gpa-v1" : "gpa-v2";
}

/**
 * Fetch every program account matching `config`, paginating with `paginationKey`
 * until the RPC returns a null cursor. Each page is one JSON-RPC call via `invoke`
 * (typically `rpcWithRetry` from the indexer).
 */
export async function getProgramAccountsV2All(
  invoke: RpcInvoke,
  programId: string,
  config: ProgramAccountGpaConfig,
): Promise<ProgramAccountEntry[]> {
  const limit = pageLimit(config);
  const {limit: _dropLimit, paginationKey: _dropKey, ...baseConfig} = config;

  try {
    const all: ProgramAccountEntry[] = [];
    let paginationKey: string | null = null;

    for (;;) {
      const pageConfig: ProgramAccountGpaConfig = {
        ...baseConfig,
        limit,
        ...(paginationKey ? {paginationKey} : {}),
      };

      const page = await invoke<V2Page>("getProgramAccountsV2", [programId, pageConfig]);
      all.push(...(page.accounts ?? []));
      paginationKey = page.paginationKey;
      if (!paginationKey) break;
    }

    return all;
  } catch (error) {
    if (!isGpaV2Unsupported(error)) throw error;

    warnClassicGpaFallback(programId, error);

    return invoke<ProgramAccountEntry[]>("getProgramAccounts", [
      programId,
      classicConfig(config),
    ]);
  }
}

/** @deprecated use resetGpaDiscoveryMetrics */
export function resetGpaV2FallbackLogForTests(): void {
  resetGpaDiscoveryMetrics();
}

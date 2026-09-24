/**
 * The always-on indexer.
 *
 * Runs on Railway as a single replica, because two of these racing each other
 * is worse than one stalling: both sweep the same programs, both pay the RPC
 * cost, and the write ordering between them is undefined. One replica and a
 * heartbeat is the whole concurrency design.
 *
 * The heartbeat is what makes a stall visible. A worker that has died leaves
 * `heartbeat_at` frozen, so `/api/cron/index` can tell the difference between
 * "the worker has this covered" and "nothing has indexed for an hour" — which
 * is the failure that otherwise presents as a feed that simply stops growing.
 *
 *   npm run worker
 */

import {gpaDiscoveryLabel} from "@/lib/server/getProgramAccountsV2";
import {indexAll} from "@/lib/server/live/launchIndexer";
import {keepTapes} from "@/lib/server/live/tapeKeeper";
import {readIndexerState, storeReady} from "@/lib/server/live/universeStore";
import {indexerRpcUrl, rpcUrlForLog} from "@/lib/server/rpcUrl";

/** How often to sweep. A reconciler is idempotent, so this is a cost dial. */
const INTERVAL_MS = Number(process.env.INDEX_INTERVAL_MS ?? 90_000);

/**
 * How often to refresh the kept tapes. A round of the busiest coins takes a few
 * seconds itself, so this is the gap between rounds rather than their period.
 * `KEEP_TAPES=0` turns it off.
 */
const TAPE_INTERVAL_MS = Number(process.env.TAPE_INTERVAL_MS ?? 3_000);

/** Backoff ceiling, so a provider outage does not become a retry storm. */
const MAX_BACKOFF_MS = 15 * 60_000;

let running = true;
let consecutiveFailures = 0;

function log(message: string): void {
  console.log(`[worker ${new Date().toISOString()}] ${message}`);
}

async function pass(): Promise<void> {
  const started = Date.now();
  const {passes, decorated, discoveryOk} = await indexAll();

  for (const entry of passes) {
    log(
      `${entry.launchpad}: scanned ${entry.scanned}, stock-paired ${entry.stockPaired}, ` +
        `wrote ${entry.written}, ${entry.rpcCalls} rpc` +
        (entry.error ? ` — FAILED: ${entry.error}` : ""),
    );
  }

  log(
    `decorated ${decorated.named} named / ${decorated.priced} priced` +
      (decorated.error ? ` — ${decorated.error}` : "") +
      ` in ${Date.now() - started}ms; discovery=${gpaDiscoveryLabel()}`,
  );

  if (!discoveryOk) {
    const errors = passes
      .filter((entry) => entry.error)
      .map((entry) => entry.error)
      .join("; ");
    throw new Error(errors || "Every discovery pass failed.");
  }

  consecutiveFailures = 0;
}

async function main(): Promise<void> {
  /*
   * Either driver will do. The worker writes in batches, so it prefers direct
   * Postgres via DATABASE_URL — checking only for the Supabase service key
   * would make it exit on a deployment that is perfectly able to index.
   */
  if (!storeReady) {
    /*
     * Exit rather than idle. A worker with nowhere to write is a process that
     * looks healthy on a dashboard and does nothing, which is worse than a
     * crash loop nobody can miss.
     */
    console.error(
      "[worker] No store configured. Set DATABASE_URL, or " +
        "NEXT_PUBLIC_SUPABASE_URL together with SUPABASE_SERVICE_ROLE_KEY. " +
        "Exiting rather than idling.",
    );
    process.exit(1);
  }

  const commit =
    process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    null;
  log(
    `indexer rpc=${rpcUrlForLog(indexerRpcUrl())}, getProgramAccountsV2 enabled` +
      (commit ? `, commit=${commit}` : "") +
      `, sweeping every ${INTERVAL_MS}ms`,
  );
  if (process.env.RAILWAY_ENVIRONMENT) {
    log(
      "Railway: keep numReplicas=1 for this service (see RAILWAY.md). A second replica doubles sweep cost.",
    );
  }

  // Its own loop: a sweep takes a minute or more, and the tapes cannot wait on it.
  if (process.env.KEEP_TAPES !== "0") void tapeLoop();

  const existing = await readIndexerState("live-tip");
  if (existing?.heartbeat_at) {
    const age = Date.now() - Date.parse(existing.heartbeat_at);
    if (age < INTERVAL_MS * 2) {
      log(
        `another worker heartbeat is ${Math.round(age / 1000)}s old — it is ` +
          `probably still alive. Continuing anyway; the sweep is idempotent.`,
      );
    }
  }

  while (running) {
    try {
      await pass();
      // Heartbeat is written inside indexAll when a discovery pass succeeds.
    } catch (error) {
      consecutiveFailures += 1;
      const backoff = Math.min(
        INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 6),
        MAX_BACKOFF_MS,
      );
      log(
        `pass failed (${consecutiveFailures} in a row): ${(error as Error).message}. ` +
          `Backing off ${Math.round(backoff / 1000)}s.`,
      );
      await sleep(backoff);
      continue;
    }

    await sleep(INTERVAL_MS);
  }

  log("stopped");
}

/**
 * Keep the feed's tapes current, alongside the sweep. Logs a summary about
 * once a minute rather than every round, which would be every few seconds.
 */
async function tapeLoop(): Promise<void> {
  log(`keeping tapes, ${TAPE_INTERVAL_MS}ms between rounds`);
  let failures = 0;
  let rounds = 0;
  let lastLog = 0;

  while (running) {
    const started = Date.now();
    try {
      const result = await keepTapes();
      failures = 0;
      rounds += 1;
      if (Date.now() - lastLog > 60_000) {
        log(
          `tapes: ${rounds} rounds, last wrote ${result.written}/${result.coins} in ` +
            `${Date.now() - started}ms` +
            (result.failed ? `, ${result.failed} failed — ${result.firstError}` : ""),
        );
        lastLog = Date.now();
        rounds = 0;
      }
      await sleep(TAPE_INTERVAL_MS);
    } catch (error) {
      failures += 1;
      const backoff = Math.min(TAPE_INTERVAL_MS * 2 ** Math.min(failures, 6), MAX_BACKOFF_MS);
      log(`tapes failed (${failures} in a row): ${(error as Error).message}. Backing off ${Math.round(backoff / 1000)}s.`);
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Railway sends SIGTERM on redeploy. Finish the current sleep and exit cleanly
// rather than being killed mid-write.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} received, finishing up`);
    running = false;
    // A hard ceiling, so a hung fetch cannot hold the deploy open.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

void main().catch((error) => {
  console.error(`[worker] fatal: ${(error as Error).message}`);
  process.exit(1);
});

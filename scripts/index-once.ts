/**
 * Run one indexer pass by hand.
 *
 * The same function the worker loops over, so what it writes is exactly what
 * production writes. Useful right after a migration, and for checking an RPC
 * actually allows getProgramAccounts before deploying a worker that needs it.
 *
 *   npm run index:once
 */

import {hasDatabase} from "@/lib/server/db";
import {indexAll} from "@/lib/server/live/launchIndexer";
import {universeCount} from "@/lib/server/live/universeStore";

async function main(): Promise<void> {
  if (!hasDatabase) {
    throw new Error(
      "No database configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  console.log("Indexing…\n");
  const {passes, decorated} = await indexAll();

  for (const pass of passes) {
    console.log(
      `  ${pass.launchpad.padEnd(9)} scanned ${String(pass.scanned).padStart(6)}  ` +
        `stock-paired ${String(pass.stockPaired).padStart(5)}  ` +
        `wrote ${String(pass.written).padStart(5)}  ${pass.rpcCalls} rpc` +
        (pass.error ? `  FAILED: ${pass.error}` : ""),
    );
  }

  console.log(
    `\n  decorated: ${decorated.named} named, ${decorated.priced} priced` +
      (decorated.error ? ` (${decorated.error})` : ""),
  );
  console.log(`  universe now holds ${await universeCount()} listed coin(s).\n`);
}

void main().catch((error) => {
  console.error(`\nindex failed: ${(error as Error).message}\n`);
  process.exit(1);
});

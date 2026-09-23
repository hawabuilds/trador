import {NextResponse} from "next/server";

import {serverRpcUrl} from "@/lib/server/rpcUrl";

export const dynamic = "force-dynamic";

/**
 * A same-origin Solana RPC, for the browser.
 *
 * Privy's Solana wallet hooks need an RPC endpoint to broadcast through, and
 * they run in the browser — so the endpoint has to be reachable from there.
 * Handing the browser the RPC URL would ship the API key to every visitor,
 * where it can be lifted from the bundle and spent against our quota. This
 * forwards instead: the page talks to its own origin, and the key stays here.
 *
 * **Not an open relay.** A bare passthrough is a free RPC for anyone who finds
 * it, and the expensive calls are exactly the ones an indexer would abuse. Only
 * the methods a wallet needs to sign, send and confirm are allowed; everything
 * else is refused by name so a missing method is obvious in the console rather
 * than looking like a network fault.
 *
 * `getProgramAccounts` is deliberately absent. It is the one call that can scan
 * an entire program's state, it is what this app's own indexer uses against a
 * paid plan, and no wallet flow needs it.
 */
const ALLOWED = new Set([
  // Sending and confirming.
  "sendTransaction",
  "simulateTransaction",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  // Reading what a wallet shows and what a transaction needs.
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption",
  "getEpochInfo",
  "getSlot",
  "getBlockHeight",
  "getGenesisHash",
  "getVersion",
  "isBlockhashValid",
]);

/** Refuse the proxy until a paid or dedicated app RPC is configured. */
const UPSTREAM =
  process.env.SERVER_RPC_URL ||
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL
    ? serverRpcUrl()
    : "";

export async function POST(request: Request) {
  if (!UPSTREAM) {
    return NextResponse.json(
      {error: "No Solana RPC is configured on this deployment."},
      {status: 503},
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: "Expected a JSON-RPC body."}, {status: 400});
  }

  /*
   * A batch is a list, and every call in it has to pass. Checking only the
   * first would let one allowed method carry a dozen disallowed ones.
   */
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) {
    return NextResponse.json({error: "Unsupported batch size."}, {status: 400});
  }

  for (const call of calls) {
    const method = (call as {method?: unknown})?.method;
    if (typeof method !== "string" || !ALLOWED.has(method)) {
      return NextResponse.json(
        {error: `Method not allowed here: ${String(method)}`},
        {status: 403},
      );
    }
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    // Passed through verbatim, including the status. A JSON-RPC error is a
    // result the caller has to see, not something to translate into our own.
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {"content-type": "application/json", "cache-control": "no-store"},
    });
  } catch (error) {
    return NextResponse.json(
      {error: `Upstream RPC failed: ${(error as Error).message}`},
      {status: 502},
    );
  }
}

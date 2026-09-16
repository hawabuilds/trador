/**
 * Wait for a signature to land, over HTTP.
 *
 * The wallet broadcasts and hands back a signature; this is what turns that
 * into "it happened". It polls `getSignatureStatuses` through the app's own
 * `/api/rpc` proxy rather than watching a websocket, because the proxy is the
 * one path from the browser that is known to work — a route handler cannot hold
 * a socket, and the public websocket endpoint refuses browser origins.
 *
 * That combination is what produced the worst bug in this flow: the transaction
 * landed, the confirmation watch failed, and the wallet reported "Something
 * went wrong" over a trade that had already settled.
 *
 * ## What each outcome means
 *
 * - `confirmed` — the network has it and it succeeded.
 * - `failed` — the network has it and it reverted. The signature is real and
 *   worth linking to, because the explorer will say why.
 * - `unknown` — polling ran out of time. **Not** a failure: a transaction that
 *   is slow to confirm is still very likely to land, and telling someone it
 *   failed is how they come to send it twice. The caller says so plainly and
 *   links the signature.
 */

export type ConfirmOutcome = "confirmed" | "failed" | "unknown";

interface StatusValue {
  confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
  err?: unknown;
}

/**
 * Poll until the signature resolves, or until `timeoutMs` elapses.
 *
 * Every second: fast enough that confirmation feels immediate, slow enough that
 * a thirty-second wait is thirty requests rather than a flood.
 */
export async function confirmSignature(
  signature: string,
  {timeoutMs = 45_000, intervalMs = 1_000}: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<ConfirmOutcome> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/rpc", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          // The signature may not be in the recent-status cache yet if the
          // node is a little behind, so ask it to search history too.
          params: [[signature], {searchTransactionHistory: true}],
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as {
          result?: {value?: (StatusValue | null)[]};
        };
        const status = body.result?.value?.[0] ?? null;

        if (status) {
          if (status.err) return "failed";
          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            return "confirmed";
          }
          // `processed` only: seen by one node, not yet voted on. Keep waiting.
        }
      }
    } catch {
      // A failed poll is not a failed transaction. Try again until the deadline.
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return "unknown";
}

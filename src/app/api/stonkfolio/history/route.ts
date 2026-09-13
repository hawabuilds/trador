import {asPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {readSnapshots, snapshotsReady} from "@/lib/server/live/portfolioSnapshots";

export const dynamic = "force-dynamic";

/**
 * How far back each range chip reads.
 *
 * `all` is a year rather than unbounded: the table is keyed `(wallet, at desc)`
 * and an open-ended scan would walk every row a wallet ever wrote. Nobody has a
 * year of history yet, so this costs nothing today and stays bounded when they
 * do.
 */
const RANGE_MS: Record<string, number> = {
  "1d": 24 * 3_600_000,
  "1w": 7 * 24 * 3_600_000,
  "1m": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

/**
 * A wallet's value over time.
 *
 * `ready` is reported rather than inferred from an empty list, because "no
 * database configured" and "no history yet" need different words on screen —
 * and an empty array for both would have the chart tell a fresh install to
 * keep waiting for points that are never coming.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const wallet = asPubkey(params.get("wallet"));
  if (!wallet) return badRequest("A base58 wallet address is required.");

  const range = params.get("range") ?? "1w";
  const since = RANGE_MS[range] ?? RANGE_MS["1w"];

  const snapshots = await readSnapshots(wallet, since);
  return json({snapshots, ready: snapshotsReady});
}

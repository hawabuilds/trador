/**
 * Pin the LaunchpadPool layout to real accounts.
 *
 * Every offset in `LAUNCHPAD_POOL` was originally *computed* from Raydium's
 * alpha SDK layout rather than observed, and it rests on `VestingSchedule`
 * being exactly five u64s. If that is wrong, every offset past byte 101 shifts.
 *
 * The reason this needs a test rather than a careful read is the shape of the
 * failure. A wrong offset does not throw: 32 bytes at the wrong place still
 * decode to a perfectly well-formed base58 address. The platform-config
 * comparison then matches nothing, the universe test excludes everything, and
 * the symptom is an empty feed — which reads as a broken query and sends you
 * looking in entirely the wrong place.
 *
 * Fixtures are finalized mainnet accounts captured by the probe scripts: one
 * still on its bonding curve and one graduated, both StonkFun reward launches
 * quoted in NVDAx.
 */
import assert from "node:assert/strict";
import {test} from "node:test";

import {LAUNCHPAD_POOL, STONKFUN_PLATFORMS} from "@/lib/programs";
import {isPubkey} from "@/lib/pubkey";
import {
  POOL_STATUS,
  decodeLaunchpadPool,
  decodeStonkfunLaunch,
  isOnCurve,
  liquidityUsdFromPool,
} from "@/lib/launchpad/launchpadPool";
import {stockForTicker} from "@/lib/stocks/registry";

import FIXTURES from "./fixtures/launchpad-pools.json" with {type: "json"};

const REWARDS_PLATFORM = STONKFUN_PLATFORMS.find((p) => p.kind === "rewards")!;
const NVDAX = stockForTicker("NVDAx")!;

interface Fixture {
  status: number;
  pubkey: string;
  data: string;
}

const pools = FIXTURES.pools as Fixture[];

function bytesOf(fixture: Fixture): Uint8Array {
  return Uint8Array.from(Buffer.from(fixture.data, "base64"));
}

test("fixtures exist and cover both curve and graduated states", () => {
  assert.ok(pools.length >= 2, "need at least an on-curve and a graduated pool");
  const statuses = new Set(pools.map((pool) => pool.status));
  assert.ok(statuses.has(POOL_STATUS.FUND), "no on-curve fixture");
  assert.ok(statuses.has(POOL_STATUS.TRADE), "no graduated fixture");
});

test("the account size is exactly the span the offsets assume", () => {
  for (const fixture of pools) {
    assert.equal(
      bytesOf(fixture).length,
      LAUNCHPAD_POOL.SPAN,
      `${fixture.pubkey}: span changed — every offset past 101 is suspect`,
    );
  }
});

test("every offset decodes to the value it is supposed to hold", () => {
  for (const fixture of pools) {
    const pool = decodeLaunchpadPool(bytesOf(fixture));
    assert.ok(pool, `${fixture.pubkey} did not decode`);

    // The two the RPC itself already agreed with: the fixtures were fetched
    // with memcmp filters at these exact offsets, so a mismatch here means the
    // decoder and the filter disagree — which would make the reconciler and
    // the indexer see different universes.
    assert.equal(
      pool.platformId,
      REWARDS_PLATFORM.platformId,
      "platformId offset disagrees with the memcmp filter that found this account",
    );
    assert.equal(
      pool.quoteMint,
      NVDAX.mint,
      "quoteMint offset disagrees with the memcmp filter that found this account",
    );

    // The rest have no filter to check them, so assert they are at least
    // well-formed and distinct — a shifted offset usually lands in padding
    // (all zeroes, which encodes as the all-ones sentinel) or overlaps a
    // neighbour.
    for (const [label, value] of [
      ["baseMint", pool.baseMint],
      ["configId", pool.configId],
      ["creator", pool.creator],
    ] as const) {
      assert.equal(isPubkey(value), true, `${label} is not an address`);
      assert.notEqual(value, "11111111111111111111111111111111", `${label} read padding`);
    }

    assert.notEqual(pool.baseMint, pool.quoteMint, "base and quote read the same bytes");
    assert.notEqual(pool.creator, pool.platformId, "creator and platformId overlap");
    assert.notEqual(pool.configId, pool.platformId, "configId and platformId overlap");

    assert.equal(pool.status, fixture.status);
  }
});

test("status maps to graduation the way mainnet actually uses it", () => {
  for (const fixture of pools) {
    const pool = decodeLaunchpadPool(bytesOf(fixture))!;

    if (fixture.status === POOL_STATUS.FUND) {
      assert.equal(pool.graduated, false);
      assert.equal(isOnCurve(pool), true);
    }
    if (fixture.status === POOL_STATUS.TRADE) {
      assert.equal(pool.graduated, true);
      assert.equal(isOnCurve(pool), false);
    }
  }
});

/**
 * The reserves are in the struct and they are not liquidity.
 *
 * This is the assertion standing between Trador and the failure the previous
 * app shipped: fourteen of its twenty newest rows showing near-identical
 * "liquidity" because the figure was a seeded curve constant. One read half a
 * billion dollars.
 */
test("curve reserves are never reported as liquidity", () => {
  for (const fixture of pools) {
    const pool = decodeLaunchpadPool(bytesOf(fixture))!;

    if (fixture.status === POOL_STATUS.FUND) {
      // The tempting number really is sitting there, non-zero.
      assert.ok(
        pool.virtualBase > 0n || pool.virtualQuote > 0n,
        "expected a seeded reserve on an on-curve pool",
      );
    }

    assert.equal(
      liquidityUsdFromPool(pool),
      null,
      "liquidity must be unknown from this account, never a curve reserve",
    );
  }
});

test("a StonkFun launch is recognised, with its config kind and stock", () => {
  for (const fixture of pools) {
    const launch = decodeStonkfunLaunch(bytesOf(fixture));
    assert.ok(launch, `${fixture.pubkey}: not recognised as a StonkFun launch`);

    assert.equal(launch.configKind, "rewards");
    assert.equal(launch.paysHolders, true);
    assert.equal(launch.stock?.ticker, "NVDAx");
  }
});

test("a pool of the wrong size is rejected rather than half-decoded", () => {
  const real = bytesOf(pools[0]);

  assert.equal(decodeLaunchpadPool(real.subarray(0, 428)), null);
  assert.equal(decodeLaunchpadPool(new Uint8Array(429)), null); // all padding
  assert.equal(decodeLaunchpadPool(new Uint8Array(0)), null);

  const padded = new Uint8Array(430);
  padded.set(real);
  assert.equal(decodeLaunchpadPool(padded), null);
});

test("a LaunchLab pool from another platform is not a StonkFun launch", () => {
  const real = bytesOf(pools[0]);
  const foreign = Uint8Array.from(real);

  // Overwrite the platform config with something else and the launch must stop
  // being attributed — this is the whole mechanism, so it gets an explicit test
  // rather than being assumed from the positive case.
  foreign.fill(7, LAUNCHPAD_POOL.PLATFORM_ID, LAUNCHPAD_POOL.PLATFORM_ID + 32);

  const pool = decodeLaunchpadPool(foreign);
  assert.ok(pool, "should still decode as a pool");
  assert.notEqual(pool.platformId, REWARDS_PLATFORM.platformId);
  assert.equal(decodeStonkfunLaunch(foreign), null);
});

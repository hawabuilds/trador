/**
 * The number behind the Graduating tab.
 *
 * Worth its own test because it is the one figure on that surface a user reads
 * as a promise — "this coin is 80% of the way there" — and every failure mode
 * is silent. A ratio computed in floats would be subtly wrong on large u64s, a
 * missing target rendered as 0 would libel a coin nobody has abandoned, and an
 * unclamped value would overflow the bar on precisely the coins that matter
 * most: the ones about to graduate.
 */

import {strict as assert} from "node:assert";
import {test} from "node:test";

import {curveProgress} from "@/lib/launchpad/launchpadPool";

test("progress is the raise over the target", () => {
  assert.equal(curveProgress({realQuote: 0n, fundRaisingTarget: 100n}), 0);
  assert.equal(curveProgress({realQuote: 50n, fundRaisingTarget: 100n}), 0.5);
  assert.equal(curveProgress({realQuote: 100n, fundRaisingTarget: 100n}), 1);
});

test("a real SOL-quoted pool reads as expected", () => {
  // 85 SOL is LaunchLab's classic target; these are real values off chain.
  const target = 85_000_000_000n;
  assert.equal(curveProgress({realQuote: 85_000_000_000n, fundRaisingTarget: target}), 1);
  assert.equal(curveProgress({realQuote: 42_500_000_000n, fundRaisingTarget: target}), 0.5);

  // An early launch: 0.08 SOL against 85.
  const early = curveProgress({realQuote: 80_247_755n, fundRaisingTarget: target});
  assert.ok(early !== null && early > 0.0009 && early < 0.001, `got ${String(early)}`);
});

/**
 * Graduated pools overshoot their target by a few base units, because the
 * trade that fills the curve does not land exactly on it. Real values, read
 * off three graduated pools.
 */
test("a graduated pool clamps to exactly 1, never above", () => {
  const overshoots: [bigint, bigint][] = [
    [40_737_364_319n, 40_737_363_578n],
    [49_080_732_746_810n, 49_080_732_746_685n],
    [85_000_000_188n, 85_000_000_000n],
  ];

  for (const [realQuote, fundRaisingTarget] of overshoots) {
    assert.equal(
      curveProgress({realQuote, fundRaisingTarget}),
      1,
      "a bar rendered past 100% overflows its track",
    );
  }
});

/**
 * Unmeasured is not zero.
 *
 * Zero says "nobody has bought this", which is a claim about the coin. Null
 * says "we have not read this", which is a claim about us — and only one of
 * those is true when a target is missing.
 */
test("a missing or zero target is null, not zero", () => {
  assert.equal(curveProgress({realQuote: 10n, fundRaisingTarget: 0n}), null);
  assert.equal(curveProgress({realQuote: -1n, fundRaisingTarget: 100n}), null);
});

/**
 * The precision case that motivates the bigint arithmetic.
 *
 * Stock-quoted targets run past 5e13 base units. Both operands still fit a
 * double exactly, but scaling them in float order loses the low digits — so
 * the ratio has to be formed in bigint and only the bounded result converted.
 */
test("large u64 targets keep their precision", () => {
  const target = 55_910_558_061_845n;
  const raised = 89_640_970_433n;

  const progress = curveProgress({realQuote: raised, fundRaisingTarget: target});
  assert.ok(progress !== null);
  // 0.16034…% — six significant figures survive the scale.
  assert.ok(progress > 0.0016 && progress < 0.0017, `got ${progress}`);
});

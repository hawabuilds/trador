import assert from "node:assert/strict";
import {test} from "node:test";

import {DAILY_VOTE_CAP, RANKS, SEASONS} from "@/config/ranks";
import {
  currentSeason,
  earnsRep,
  goatCount,
  nextRank,
  rankFor,
  repForVote,
  seasonAt,
} from "@/lib/ranks";

test("a vote is worth ten times the voter's weight", () => {
  assert.equal(repForVote({voterRank: "intern", proof: false, early: false}), 10);
  assert.equal(repForVote({voterRank: "analyst", proof: false, early: false}), 12.5);
  assert.equal(repForVote({voterRank: "quant", proof: false, early: false}), 15);
  assert.equal(repForVote({voterRank: "wolf", proof: false, early: false}), 17.5);
  assert.equal(repForVote({voterRank: "goat", proof: false, early: false}), 20);
});

test("proof and early multiply, and halves survive", () => {
  // The two worked examples: an Intern's vote on a comment with proof, and a
  // GOAT's on an early call with proof.
  assert.equal(repForVote({voterRank: "intern", proof: true, early: false}), 12.5);
  assert.equal(repForVote({voterRank: "goat", proof: true, early: true}), 37.5);

  assert.equal(repForVote({voterRank: "quant", proof: false, early: true}), 22.5);
  assert.equal(repForVote({voterRank: "wolf", proof: true, early: true}), 32.81);
});

test("the daily cap stops rep, counted in votes that earned", () => {
  assert.equal(earnsRep(0), true);
  assert.equal(earnsRep(DAILY_VOTE_CAP - 1), true);
  assert.equal(earnsRep(DAILY_VOTE_CAP), false);
  assert.equal(earnsRep(DAILY_VOTE_CAP + 40), false);
});

test("rep alone decides every rank below GOAT", () => {
  const at = (rep: number) => rankFor({rep, percentile: null}).id;
  assert.equal(at(0), "intern");
  assert.equal(at(249), "intern");
  assert.equal(at(250), "analyst");
  assert.equal(at(999.99), "analyst");
  assert.equal(at(1_000), "quant");
  assert.equal(at(4_999), "quant");
  assert.equal(at(5_000), "wolf");
  assert.equal(at(50_000), "wolf");
});

test("GOAT needs the top slice and the rep, never one of them", () => {
  // Top of the table but short of Wolf's rep: still a Quant.
  assert.equal(rankFor({rep: 4_999, percentile: 0}).id, "quant");
  // Rep enough, but not in the top 1%: a Wolf.
  assert.equal(rankFor({rep: 40_000, percentile: 0.05}).id, "wolf");
  // Both.
  assert.equal(rankFor({rep: 5_000, percentile: 0.01}).id, "goat");
  // Nobody is ranked yet, so there is no slice to be in.
  assert.equal(rankFor({rep: 90_000, percentile: null}).id, "wolf");
});

test("the top slice is at least one person, and one percent after that", () => {
  assert.equal(goatCount(0), 0);
  assert.equal(goatCount(1), 1);
  assert.equal(goatCount(50), 1);
  assert.equal(goatCount(100), 1);
  assert.equal(goatCount(250), 2);
  assert.equal(goatCount(1_000), 10);
});

test("the next rank is the next rung up, and GOAT is never promised", () => {
  assert.deepEqual(nextRank({rep: 0, percentile: null}), {rank: RANKS[1], repToGo: 250});
  assert.equal(nextRank({rep: 680, percentile: null})?.repToGo, 320);
  assert.equal(nextRank({rep: 680, percentile: null})?.rank.name, "Quant");

  // A Wolf has nothing left to climb towards, because GOAT is a position.
  assert.equal(nextRank({rep: 9_000, percentile: 0.4}), null);
  assert.equal(nextRank({rep: 9_000, percentile: 0}), null);
});

test("season 1 runs through October and nothing after it", () => {
  assert.equal(seasonAt("2026-10-01T00:00:00Z")?.id, 1);
  assert.equal(seasonAt("2026-10-31T23:59:59Z")?.id, 1);
  assert.equal(seasonAt("2026-11-01T00:00:00Z"), null);
  assert.equal(seasonAt("2026-09-30T23:59:59Z"), null);

  // Past the end, standings still read as the season that ran.
  assert.equal(currentSeason("2026-11-02T00:00:00Z").id, SEASONS[SEASONS.length - 1].id);
});

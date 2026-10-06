import assert from "node:assert/strict";
import {test} from "node:test";

import {rankByVotes} from "@/lib/server/socialFeed";

/**
 * Fixtures, never the database. These are the orderings the SQL path asks
 * Postgres for — `order by likes desc, id desc` with the keyset in the where
 * clause — so the rule can be checked without a store behind it.
 */
const calls = [
  {id: "10", likes: 2, body: "two votes, oldest"},
  {id: "11", likes: 9, body: "most useful"},
  {id: "12", likes: 2, body: "two votes, newer"},
  {id: "13", likes: 0, body: "no votes"},
  {id: "14", likes: 5, body: "middling"},
];

test("the most useful call comes first", () => {
  const ranked = rankByVotes(calls, {limit: 10});
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["11", "14", "12", "10", "13"],
  );
});

test("a tie on votes puts the newer call first", () => {
  const ranked = rankByVotes(calls, {limit: 10});
  const twos = ranked.filter((row) => row.likes === 2).map((row) => row.id);
  assert.deepEqual(twos, ["12", "10"]);
});

test("a page carries on from the cursor without repeating", () => {
  const first = rankByVotes(calls, {limit: 2});
  assert.deepEqual(first.map((row) => row.id), ["11", "14"]);

  const last = first[first.length - 1];
  const second = rankByVotes(calls, {
    cursor: {likes: Number(last.likes), id: last.id},
    limit: 2,
  });

  assert.deepEqual(second.map((row) => row.id), ["12", "10"]);
  // Nothing from the first page appears again.
  assert.equal(second.some((row) => first.some((seen) => seen.id === row.id)), false);
});

test("the cursor splits a tie rather than showing it twice", () => {
  const page = rankByVotes(calls, {cursor: {likes: 2, id: "12"}, limit: 10});
  assert.deepEqual(page.map((row) => row.id), ["10", "13"]);
});

test("votes arriving as strings rank as numbers", () => {
  const ranked = rankByVotes(
    [
      {id: "1", likes: "9"},
      {id: "2", likes: "10"},
    ],
    {limit: 10},
  );
  // "10" beats "9" numerically, where a string sort would put it second.
  assert.deepEqual(ranked.map((row) => row.id), ["2", "1"]);
});

test("a limit never returns more than asked for", () => {
  assert.equal(rankByVotes(calls, {limit: 3}).length, 3);
  assert.equal(rankByVotes([], {limit: 5}).length, 0);
});

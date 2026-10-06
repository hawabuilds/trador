import assert from "node:assert/strict";
import {test} from "node:test";

import {groupByAge, unreadCount} from "@/lib/notifications/inboxList";

/** Midday, so "yesterday evening" is unambiguous in local time. */
const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const HOUR = 3_600_000;
const DAY = 86_400_000;

test("today is since this morning, not the last twenty-four hours", () => {
  const items = [
    {id: "an hour ago", at: ago(HOUR)},
    // 11pm yesterday is thirteen hours back, and it is still yesterday.
    {id: "last night", at: new Date(2026, 9, 5, 23, 0, 0).toISOString()},
  ];

  const groups = groupByAge(items, NOW);
  assert.deepEqual(groups.map((group) => group.label), ["Today", "This week"]);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["an hour ago"]);
  assert.deepEqual(groups[1].items.map((item) => item.id), ["last night"]);
});

test("the week ends at seven calendar days, then it is earlier", () => {
  const groups = groupByAge(
    [
      {id: "this morning", at: ago(2 * HOUR)},
      {id: "four days", at: ago(4 * DAY)},
      {id: "nine days", at: ago(9 * DAY)},
    ],
    NOW,
  );

  assert.deepEqual(groups.map((group) => group.label), ["Today", "This week", "Earlier"]);
  assert.deepEqual(groups[2].items.map((item) => item.id), ["nine days"]);
});

test("an empty stretch gets no heading", () => {
  const groups = groupByAge([{id: "old", at: ago(30 * DAY)}], NOW);
  assert.deepEqual(groups.map((group) => group.label), ["Earlier"]);
});

test("a date nobody can parse is left out rather than grouped wrongly", () => {
  const groups = groupByAge([{id: "bad", at: "not a date"}, {id: "fine", at: ago(HOUR)}], NOW);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["fine"]);
});

test("a device that has never looked has seen nothing", () => {
  const items = [{at: ago(HOUR)}, {at: ago(2 * DAY)}];
  assert.equal(unreadCount(items, null), 2);
});

test("only what arrived after the last look is new", () => {
  const items = [{at: ago(HOUR)}, {at: ago(3 * HOUR)}, {at: ago(2 * DAY)}];
  assert.equal(unreadCount(items, ago(2 * HOUR)), 1);
  assert.equal(unreadCount(items, ago(4 * HOUR)), 2);
  assert.equal(unreadCount(items, ago(0)), 0);
});

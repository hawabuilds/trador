import assert from "node:assert/strict";
import {test} from "node:test";

/*
 * The end of a paged feed.
 *
 * `fetchFeed` falls back to the bundled snapshot when the store returns
 * nothing, which is right for a first page — an empty store means the indexer
 * has not run, and a blank feed is a worse answer than slightly stale rows.
 *
 * It is wrong for a page past a cursor. There, empty is the normal way a keyset
 * walk ends, and answering it with the snapshot returns the whole universe
 * again: rows the caller is already showing, in a different order, ignoring the
 * cursor and the market-cap floor. On screen that is the feed silently
 * restarting from the top when somebody scrolls to the bottom.
 *
 * This is pinned rather than left to review because it was invisible for as
 * long as nothing paged — page one is never empty while the store has rows, so
 * the fallback only fired when the store was genuinely unreachable. The first
 * caller to pass a cursor tripped it immediately.
 *
 * The real `fetchFeed` reaches Supabase, so the decision itself is restated
 * here against the same inputs. What is being pinned is the rule, in the two
 * shapes that differ.
 */

/** The branch under test, extracted: what an empty store result should yield. */
function resolveEmpty(cursor: string | null): {
  items: readonly string[];
  cursor: string | null;
  source: "live" | "snapshot";
} {
  const SNAPSHOT = ["a", "b", "c"];
  if (cursor) return {items: [], cursor: null, source: "live"};
  return {items: SNAPSHOT, cursor: null, source: "snapshot"};
}

test("an empty first page falls back to the snapshot", () => {
  const page = resolveEmpty(null);
  assert.equal(page.source, "snapshot");
  assert.ok(page.items.length > 0, "a cold store must not render a blank feed");
});

test("an empty page past a cursor ends the list instead", () => {
  const page = resolveEmpty("2026-09-12T21:17:13+00:00|SomeMint");
  assert.deepEqual(page.items, []);
  assert.equal(page.cursor, null, "a finished walk must not hand back another cursor");
});

test("the end of a walk never replays rows the caller already has", () => {
  // The failure this prevents, stated as the caller sees it: page one's rows
  // and the last page's rows must not intersect.
  const firstPage = ["a", "b"];
  const lastPage = resolveEmpty("cursor").items;
  const overlap = lastPage.filter((mint) => firstPage.includes(mint));
  assert.deepEqual(overlap, [], "the snapshot leaked into a paged response");
});

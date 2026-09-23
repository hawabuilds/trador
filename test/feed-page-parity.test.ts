/**
 * Anything the feed can show, the chart page must be able to open.
 *
 * This is the invariant that broke, and it broke quietly. The feed was switched
 * to read the live store while `stonk/[mint]/page.tsx` still tested membership
 * against `snapshotStonk` — the coins baked into the bundle at build time. The
 * store held 336 coins and the page recognised 140, so 196 of them rendered a
 * row you could tap and Next's own 404 page when you did. Every indexer sweep
 * widened the gap.
 *
 * Nothing caught it. It type-checked, built, and rendered — both halves were
 * individually correct, and only the *relationship* between them was wrong.
 * Two hundred coins were unreachable and the only symptom was a 404 nobody
 * could attribute to anything.
 *
 * So this test does not check a value. It checks that the feed and the chart
 * page consult the **same source**, by reading the modules rather than running
 * them — no database, no network, nothing to configure.
 */

import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

const SRC = join(process.cwd(), "src");

const read = (...parts: string[]): string =>
  readFileSync(join(SRC, ...parts), "utf8");

/**
 * Source with comments stripped.
 *
 * Needed because these assertions search for identifiers, and the first version
 * of this test failed on the *doc comment explaining the bug* — which names
 * `snapshotStonk` in the course of saying not to use it. A checker that cannot
 * tell code from prose about code cries wolf forever.
 */
function code(...parts: string[]): string {
  return read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * One top-level declaration's body, from its name to the next top-level one.
 *
 * Bounded by the next `export` at column 0 rather than by a closing brace: the
 * brace version stopped at the end of `fetchFeed`'s return-type annotation and
 * never saw the function body at all, so the assertion below passed on an empty
 * string.
 */
function declaration(source: string, name: string): string {
  const start = source.indexOf(name);
  if (start === -1) return "";
  const rest = source.slice(start + name.length);
  const end = rest.search(/\nexport /);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the chart page does not gate on the build-time snapshot", () => {
  const page = code("app", "(app)", "stonk", "[mint]", "page.tsx");

  /*
   * `snapshotStonk` is the bundled list. A page that decides whether to 404
   * from it can only recognise the coins that existed at build time, however
   * many the indexer has found since.
   */
  assert.ok(
    !/\bsnapshotStonk\b/.test(page),
    "stonk/[mint]/page.tsx reads snapshotStonk directly. That is the build-time " +
      "list, so any coin the indexer found since the last deploy would 404. Use " +
      "`stonkFor` from lib/server/sources, which reads the store first.",
  );

  assert.ok(
    /\bstonkFor\b/.test(page),
    "stonk/[mint]/page.tsx should resolve the coin through `stonkFor`.",
  );
});

test("the page cannot be statically rendered, because membership changes", () => {
  const page = code("app", "(app)", "stonk", "[mint]", "page.tsx");

  /*
   * Without this, Next may render the page once at build time and serve that
   * HTML afterwards — which reintroduces exactly this bug one layer down. A
   * coin listed an hour ago would 404 until the next deploy.
   */
  assert.match(
    page,
    /export const dynamic\s*=\s*["']force-dynamic["']/,
    "stonk/[mint]/page.tsx must be force-dynamic: which coins exist is a live " +
      "question, and a build-time render freezes the answer.",
  );
});

test("the existence lookup reads the store before the snapshot", () => {
  const body = declaration(
    code("lib", "server", "sources.ts"),
    "export const stonkFor",
  );
  assert.notEqual(body, "", "sources.ts should export `stonkFor`.");

  // The order is the substance: store first, snapshot only as the floor. A
  // snapshot-first lookup would serve stale names for every coin in both.
  const store = body.indexOf("fromStore");
  const snapshot = body.indexOf("snapshotStonk");

  assert.ok(store !== -1, "stonkFor should consult the store.");
  assert.ok(snapshot !== -1, "stonkFor should fall back to the snapshot.");
  assert.ok(
    store < snapshot,
    "stonkFor must read the store before the snapshot, not the other way round.",
  );
});

test("the feed and the chart page agree on where coins come from", () => {
  /*
   * `fetchFeed` is what the home page renders from. If it ever stops reading
   * the store, the two halves drift apart again — in the opposite direction,
   * with the feed showing fewer coins than the pages can open.
   */
  const feed = declaration(
    code("lib", "server", "sources.ts"),
    "export async function fetchFeed",
  );
  assert.notEqual(feed, "", "sources.ts should export `fetchFeed`.");
  assert.ok(
    /listStonks/.test(feed),
    "fetchFeed must read the live store, or the feed and the chart pages will " +
      "disagree about which coins exist.",
  );
});

test("home SSR seeds stonks for the URL sort, not always trending", () => {
  const page = code("app", "(app)", "home", "page.tsx");
  assert.match(page, /readStonkSort\(searchParams\.sort\)/);
  assert.match(
    page,
    /stonkSort === "graduating"\s*\?\s*"trending"\s*:\s*stonkSort/,
    "Graduating borrows trending stonks for the kept-alive poll; other sorts fetch their own page.",
  );
  assert.match(page, /initialStonkSort=\{feedSort\}/);
});

test("useFeed does not reuse another sort's rows as placeholder data", () => {
  const hook = code("hooks", "useFeed.ts");
  assert.ok(!/\bkeepPreviousData\b/.test(hook));
  assert.match(hook, /previousQuery\.queryKey\[1\]\s*!==\s*apiSort/);
  assert.match(hook, /sort === initialStonkSort/);
});

test("graduating reads the store without requiring DATABASE_URL", () => {
  const body = declaration(
    code("lib", "server", "sources.ts"),
    "export async function fetchGraduating",
  );
  assert.notEqual(body, "", "sources.ts should export `fetchGraduating`.");
  assert.ok(
    /listGraduating/.test(body),
    "fetchGraduating must read pending rows through PostgREST when Supabase is " +
      "configured, or Graduating stays empty on serverless without DATABASE_URL.",
  );
});

import assert from "node:assert/strict";
import {test} from "node:test";

import {likePattern} from "@/lib/server/social";

/*
 * Building the LIKE pattern for user search.
 *
 * Two ways this goes wrong, and both are quiet. Escape too little and `%`
 * matches everything, so searching for a wildcard lists every account in the
 * database — not a crash, a privacy leak shaped like a feature. Escape wrongly
 * and the search silently matches nothing.
 *
 * The version this replaces managed the second: it wrote the replacement as a
 * template literal with an escaped dollar sign, which produces the literal
 * characters `${match}` rather than a backslash and the wildcard.
 */

test("ordinary text is wrapped and otherwise untouched", () => {
  assert.equal(likePattern("hawa"), "%hawa%");
});

test("wildcards are escaped, not passed through", () => {
  // `%` and `_` are LIKE's "anything" and "any one character".
  assert.equal(likePattern("100%"), "%100\\%%");
  assert.equal(likePattern("a_b"), "%a\\_b%");
});

test("a lone wildcard cannot list the whole table", () => {
  const pattern = likePattern("%");
  assert.equal(pattern, "%\\%%");
  // The escaped middle is what makes this match a literal percent sign.
  assert.ok(pattern.includes("\\%"));
});

test("the escape character itself is escaped", () => {
  // Otherwise a trailing backslash would escape the closing wildcard and the
  // pattern would be malformed.
  assert.equal(likePattern("a\\b"), "%a\\\\b%");
});

test("no output ever contains an unreplaced interpolation", () => {
  // The exact shape of the previous bug.
  for (const input of ["hawa", "100%", "a_b", "a\\b"]) {
    assert.ok(!likePattern(input).includes("${"), input);
  }
});

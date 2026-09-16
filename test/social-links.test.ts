import assert from "node:assert/strict";
import {test} from "node:test";

import {classifyUrl, collectLinks, httpUrl} from "@/lib/server/live/socialLinks";

/*
 * The rule under test: a link is filed by where it points, not by the label a
 * creator picked from a dropdown.
 *
 * This is worth pinning because every way it breaks is silent. A misfiled link
 * still works when clicked; it just appears under the wrong icon, or under no
 * icon at all on surfaces that only look for X. Nothing throws and nothing
 * shows up in a log.
 */

test("an X link filed as a website is still an X link", () => {
  const links = collectLinks([{url: "https://x.com/tradorapp", type: "website"}]);
  assert.equal(links.x, "https://x.com/tradorapp");
  assert.equal(links.website, undefined);
});

test("twitter.com, www, and subdomains all read as X", () => {
  for (const url of [
    "https://twitter.com/a",
    "https://www.x.com/a",
    "https://mobile.twitter.com/a",
  ]) {
    assert.equal(classifyUrl(url), "x", url);
  }
});

test("telegram and discord hosts are recognised whatever the label says", () => {
  const links = collectLinks([
    {url: "https://t.me/tradorchat", type: "website"},
    {url: "https://discord.gg/abc", type: "twitter"},
  ]);
  assert.equal(links.telegram, "https://t.me/tradorchat");
  assert.equal(links.discord, "https://discord.gg/abc");
});

test("an unrecognised host falls through to website", () => {
  const links = collectLinks([{url: "https://trador.fun", type: "website"}]);
  assert.equal(links.website, "https://trador.fun");
  assert.equal(links.x, undefined);
});

test("the label decides only when the host does not", () => {
  // A link shortener, so the host carries no signal at all.
  const links = collectLinks([{url: "https://bit.ly/xyz", type: "telegram"}]);
  assert.equal(links.telegram, "https://bit.ly/xyz");
});

test("a lookalike host is not X", () => {
  // `x.com.evil.tld` ends with neither `x.com` nor `.twitter.com`, and an
  // endsWith check written the obvious way would say otherwise.
  assert.equal(classifyUrl("https://x.com.evil.tld/a"), null);
  assert.equal(classifyUrl("https://notx.com/a"), null);
});

test("first write wins per slot", () => {
  const links = collectLinks([
    {url: "https://x.com/first"},
    {url: "https://x.com/second"},
  ]);
  assert.equal(links.x, "https://x.com/first");
});

test("non-http schemes are dropped rather than cleaned up", () => {
  // The one field a creator fully controls, rendered into an href.
  assert.equal(httpUrl("javascript:alert(1)"), null);
  assert.equal(httpUrl("data:text/html,x"), null);
  assert.equal(httpUrl(""), null);
  assert.equal(httpUrl(null), null);
  assert.equal(collectLinks([{url: "javascript:alert(1)", type: "website"}]).website, undefined);
});

test("a malformed URL is not a crash", () => {
  assert.equal(classifyUrl("not a url"), null);
  assert.deepEqual(collectLinks([{url: "not a url"}]), {});
});

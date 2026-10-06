import assert from "node:assert/strict";
import {test} from "node:test";

import {
  classifyLink,
  domainOf,
  linksIn,
  txIsProof,
  walletIsProof,
} from "@/lib/linkPreview";
import {cleanTweet, meta, textFromHtml} from "@/lib/server/live/linkParse";
import {UnsafeUrl, assertPublicUrl} from "@/lib/server/live/safeFetch";

/** Wrapped SOL, which is what most of these trades are paid in. */
const SOL = "So11111111111111111111111111111111111111112";

test("an X post is recognised on either domain", () => {
  for (const url of [
    "https://x.com/unusual_whales/status/1234567890",
    "https://twitter.com/unusual_whales/status/1234567890",
    "https://mobile.x.com/a/status/1234567890",
  ]) {
    assert.deepEqual(classifyLink(url), {url, kind: "x", ref: "1234567890"});
  }
});

test("an X profile is not a post", () => {
  assert.equal(classifyLink("https://x.com/unusual_whales"), null);
});

test("solscan transactions and accounts are told apart", () => {
  const tx = classifyLink("https://solscan.io/tx/5fXSWBWuAbcdefghijkmnopqrstuvwx");
  assert.equal(tx?.kind, "solscan-tx");
  for (const section of ["account", "address", "token"]) {
    const link = classifyLink(`https://solscan.io/${section}/6GmAFSYs4gk3FDao5FzzySQpPZaWsa4r`);
    assert.equal(link?.kind, "solscan-account");
  }
});

test("a solscan link with nothing base58 after it is not a card", () => {
  assert.equal(classifyLink("https://solscan.io/tx/not-base58-0OIl"), null);
  assert.equal(classifyLink("https://solscan.io/blocks"), null);
});

test("anything else is treated as news", () => {
  const link = classifyLink("https://www.reuters.com/markets/some-story");
  assert.equal(link?.kind, "news");
});

test("links that are not http are refused outright", () => {
  assert.equal(classifyLink("javascript:alert(1)"), null);
  assert.equal(classifyLink("file:///etc/passwd"), null);
  assert.equal(classifyLink("ftp://example.com/x"), null);
});

test("trailing punctuation is not part of the link", () => {
  const [link] = linksIn("proof here https://x.com/a/status/42.");
  assert.equal(link.url, "https://x.com/a/status/42");
});

test("the same link twice is one card", () => {
  const found = linksIn("https://x.com/a/status/42 and again https://x.com/a/status/42");
  assert.equal(found.length, 1);
});

test("the domain is what a fallback card shows", () => {
  assert.equal(domainOf("https://www.reuters.com/markets/x"), "reuters.com");
  assert.equal(domainOf("not a url"), "not a url");
});

test("internal addresses are refused before any request goes out", async () => {
  for (const url of [
    "http://localhost:3000/api",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://thing.internal/",
  ]) {
    await assert.rejects(() => assertPublicUrl(url), UnsafeUrl, `allowed ${url}`);
  }
});

test("only http and https are fetched", async () => {
  await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), UnsafeUrl);
  await assert.rejects(() => assertPublicUrl("gopher://example.com"), UnsafeUrl);
});

test("a transaction is proof only when it touched the coin's mint", () => {
  const mint = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4r";
  const other = "5fXSWBWuAbcdefghijkmnopqrstuvwx";

  assert.equal(txIsProof([{mint, paidMint: SOL}], mint), true);
  // Paid with the coin counts too: a sell is still a trade in it.
  assert.equal(txIsProof([{mint: SOL, paidMint: mint}], mint), true);
  assert.equal(txIsProof([{mint: other, paidMint: SOL}], mint), false);
  // The feed shows comments away from their coin, so nothing can be proof.
  assert.equal(txIsProof([{mint, paidMint: SOL}], null), false);
});

test("a wallet is proof only when it holds or has traded the coin", () => {
  assert.equal(walletIsProof({holds: 120_000, trades: 0}), true);
  assert.equal(walletIsProof({holds: 0, trades: 4}), true);
  assert.equal(walletIsProof({holds: 0, trades: 0}), false);
});

test("a page's own title, description and image are read from either order", () => {
  const html = `
    <head>
      <meta property="og:title" content="Apple beats on earnings">
      <meta content="Revenue up 11% &amp; margins held" property="og:description">
      <meta name="twitter:image" content="https://img.example.com/a.jpg">
    </head>`;

  assert.equal(meta(html, "og:title"), "Apple beats on earnings");
  assert.equal(meta(html, "og:description"), "Revenue up 11% & margins held");
  assert.equal(meta(html, "twitter:image"), "https://img.example.com/a.jpg");
  assert.equal(meta(html, "og:video"), null);
});

test("an embedded post becomes the words that were posted", () => {
  const html =
    '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Bought more.' +
    '<br>Still early &amp; it&#39;s cheap</p>&mdash; Someone (@someone) ' +
    '<a href="https://twitter.com/someone/status/42">October 1, 2026</a></blockquote>';

  assert.equal(textFromHtml(html), "Bought more.\nStill early & it's cheap");
});

test("the t.co link X appends is not part of the post", () => {
  assert.equal(cleanTweet("Chart says it all https://t.co/abc123"), "Chart says it all");
  assert.equal(cleanTweet("See https://t.co/abc123 and more"), "See https://t.co/abc123 and more");
});

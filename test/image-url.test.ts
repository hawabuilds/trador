import assert from "node:assert/strict";
import {test} from "node:test";

import {cidFrom} from "@/lib/ipfsCid";
import {displayImageUrl} from "@/lib/imageUrl";

/*
 * Coin artwork, and the proxy that serves the throttled part of it.
 *
 * `cidFrom` is the security boundary. The route fetches a URL built from its
 * output, so anything it lets through that is not a content id is a
 * server-side request the caller chose — which is how an image proxy becomes a
 * way to read cloud metadata endpoints.
 */

test("a throttled gateway is routed through the proxy", () => {
  const url = "https://ipfs.io/ipfs/QmSkPmBRSqtVmPcg9KzYabcdef";
  assert.equal(displayImageUrl(url), `/api/img?u=${encodeURIComponent(url)}`);
});

test("a gateway that works is left alone", () => {
  // Proxying these would add a hop and risk a CID only they have pinned.
  for (const url of [
    "https://gateway.irys.xyz/D6tTQyYEFcVx9nQgaaZiP3N5R3d1DbJ7P3FSkDndGXdo",
    "https://axiomtrading-v2.axiom-cdn.io/abc.webp",
    "https://desperate-moccasin-minnow.myfilebase.com/ipfs/Qmabc123456789012345",
  ]) {
    assert.equal(displayImageUrl(url), url, url);
  }
});

test("a bare ipfs:// URL becomes loadable", () => {
  const out = displayImageUrl("ipfs://Qmabc123456789012345678/art.png");
  assert.ok(out?.startsWith("/api/img?u="), out ?? "null");
});

test("nothing in, nothing out", () => {
  assert.equal(displayImageUrl(null), null);
  assert.equal(displayImageUrl(""), null);
});

test("a CID is read from either URL form", () => {
  assert.equal(cidFrom("ipfs://QmSkPmBRSqtVmPcg9KzYabc"), "QmSkPmBRSqtVmPcg9KzYabc");
  assert.equal(
    cidFrom("https://ipfs.io/ipfs/QmSkPmBRSqtVmPcg9KzYabc"),
    "QmSkPmBRSqtVmPcg9KzYabc",
  );
  assert.equal(
    cidFrom("https://w3s.link/ipfs/bafkreibs7s5iykixzywabc/icon.png"),
    "bafkreibs7s5iykixzywabc/icon.png",
  );
});

test("the proxy cannot be pointed at anything that is not a CID", () => {
  for (const hostile of [
    // The reason this function exists: cloud instance metadata.
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "https://evil.example.com/steal.png",
    "http://localhost:5432/",
    "file:///etc/passwd",
    // A path that climbs out of the CID once it is appended to a gateway.
    "https://ipfs.io/ipfs/Qmabc123456789012345/../../admin",
    "https://ipfs.io/ipfs/../secrets",
    // Not a plausible CID.
    "https://ipfs.io/ipfs/short",
    "https://ipfs.io/ipfs/",
    "",
  ]) {
    assert.equal(cidFrom(hostile), null, hostile);
  }
});

test("an absurdly long input is refused before any parsing", () => {
  assert.equal(cidFrom("https://ipfs.io/ipfs/" + "Q".repeat(5000)), null);
});

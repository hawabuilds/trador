import assert from "node:assert/strict";
import {test} from "node:test";

import {visibleWallet} from "@/lib/server/social";

/*
 * What a profile is allowed to reveal about someone's wallet.
 *
 * The address *is* the Stonkfolio to anyone with an explorer, so hiding
 * holdings has to hide the wallet too. Opt-out is the only hide: an
 * unevaluated flag still shows, matching the three-state rule. The owner
 * always sees their own.
 */

const WALLET = "5Cu5H6TeKHpEMKVmgp8VTCv7nJiBRjmrFNhwJeh8egAR";

test("a public portfolio shows the wallet to a visitor", () => {
  assert.equal(
    visibleWallet({id: "them", wallet: WALLET, portfolioPublic: true}, null),
    WALLET,
  );
});

test("an unevaluated portfolio flag still shows — null is not a hide", () => {
  assert.equal(
    visibleWallet({id: "them", wallet: WALLET, portfolioPublic: null}, "me"),
    WALLET,
  );
});

test("a private portfolio hides the wallet from everyone else", () => {
  assert.equal(
    visibleWallet({id: "them", wallet: WALLET, portfolioPublic: false}, "me"),
    null,
  );
  assert.equal(
    visibleWallet({id: "them", wallet: WALLET, portfolioPublic: false}, null),
    null,
  );
});

test("the owner still sees their own wallet after opting out", () => {
  assert.equal(
    visibleWallet({id: "me", wallet: WALLET, portfolioPublic: false}, "me"),
    WALLET,
  );
});

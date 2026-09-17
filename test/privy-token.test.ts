import assert from "node:assert/strict";
import {test} from "node:test";

import {SignJWT, exportJWK, generateKeyPair, importJWK, type JWK} from "jose";

import {privyJwksUrl, privyUserId} from "@/lib/server/privyToken";

/*
 * Verifying a Privy access token.
 *
 * These checks are the whole security of every authenticated route: a token
 * that passes here can write to the profile of whoever it names. They are
 * tested against a locally generated key rather than Privy's live endpoint, so
 * the failure cases can actually be constructed — a wrong audience or a
 * swapped algorithm is not something the real issuer will mint on request.
 */

const APP_ID = "cmtyt6testappid0000000000";

async function keys() {
  const {privateKey, publicKey} = await generateKeyPair("ES256");
  const pub = await exportJWK(publicKey);
  // A resolver in the shape `jwtVerify` wants, closing over our own key.
  const resolve = async () => importJWK({...pub, alg: "ES256"} as JWK, "ES256");
  return {privateKey, resolve};
}

function token(claims: {iss?: string; aud?: string; sub?: string | null}) {
  const jwt = new SignJWT(
    claims.sub === null ? {} : {sub: claims.sub ?? "did:privy:abc123"},
  )
    .setProtectedHeader({alg: "ES256"})
    .setIssuedAt()
    .setExpirationTime("10m");
  if (claims.iss !== undefined) jwt.setIssuer(claims.iss);
  if (claims.aud !== undefined) jwt.setAudience(claims.aud);
  return jwt;
}

test("a well-formed token yields the Privy DID", async () => {
  const {privateKey, resolve} = await keys();
  const jwt = await token({iss: "privy.io", aud: APP_ID}).sign(privateKey);

  assert.equal(await privyUserId(jwt, APP_ID, resolve), "did:privy:abc123");
});

test("a token minted for another Privy app is refused", async () => {
  /*
   * The check that matters most. Every Privy app's tokens are signed by the
   * same infrastructure, so without an audience check anyone with any Privy
   * app could mint tokens this app would accept as its own users.
   */
  const {privateKey, resolve} = await keys();
  const jwt = await token({iss: "privy.io", aud: "some-other-app"}).sign(privateKey);

  await assert.rejects(() => privyUserId(jwt, APP_ID, resolve));
});

test("a token from another issuer is refused", async () => {
  const {privateKey, resolve} = await keys();
  const jwt = await token({iss: "evil.example.com", aud: APP_ID}).sign(privateKey);

  await assert.rejects(() => privyUserId(jwt, APP_ID, resolve));
});

test("a token signed by the wrong key is refused", async () => {
  const {privateKey} = await keys();
  // Verified against a different keypair than the one that signed it.
  const {resolve} = await keys();
  const jwt = await token({iss: "privy.io", aud: APP_ID}).sign(privateKey);

  await assert.rejects(() => privyUserId(jwt, APP_ID, resolve));
});

test("an expired token is refused", async () => {
  const {privateKey, resolve} = await keys();
  const jwt = await new SignJWT({sub: "did:privy:abc123"})
    .setProtectedHeader({alg: "ES256"})
    .setIssuer("privy.io")
    .setAudience(APP_ID)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(privateKey);

  await assert.rejects(() => privyUserId(jwt, APP_ID, resolve));
});

test("a token with no subject is refused", async () => {
  // There would be no user to attribute the write to.
  const {privateKey, resolve} = await keys();
  const jwt = await token({iss: "privy.io", aud: APP_ID, sub: null}).sign(privateKey);

  await assert.rejects(() => privyUserId(jwt, APP_ID, resolve));
});

test("garbage is refused rather than crashing the route", async () => {
  const {resolve} = await keys();
  for (const bad of ["", "not-a-jwt", "a.b.c"]) {
    await assert.rejects(() => privyUserId(bad, APP_ID, resolve), `for ${bad}`);
  }
});

test("the key set is fetched from Privy over https, keyed by app id", () => {
  const url = new URL(privyJwksUrl(APP_ID));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "auth.privy.io");
  assert.ok(url.pathname.includes(APP_ID));
});

import {createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey} from "jose";

/**
 * Verifying a Privy access token against Privy's published public key.
 *
 * This replaces `PrivyClient.verifyAuthToken`, which needs the app *secret*.
 * That requirement was the whole reason accounts did not work: without the
 * secret every authenticated route answered 401, so `/api/me` never ran, the
 * `users` table stayed empty, and nobody was searchable — profiles, follows and
 * most notifications were dead for the same reason.
 *
 * A Privy access token is an ES256 JWT, and the key that signed it is published
 * at a JWKS endpoint keyed by app id. Public, by design: verification needs the
 * public half, and only Privy can hold the private half. So no secret is needed
 * to check a token, and the app is not waiting on one to have accounts.
 *
 * ## What is checked, and why each one matters
 *
 * - **Signature**, against Privy's key. Without it a token is a string the
 *   caller typed, and every write endpoint is open.
 * - **`alg: ES256` only.** Accepting whatever the token's header names is the
 *   classic JWT break — `alg: none`, or an HMAC verified with the public key as
 *   its shared secret.
 * - **`iss: privy.io`.** Ties the token to Privy rather than to any issuer whose
 *   key happens to be fetchable.
 * - **`aud: <app id>`.** A token minted for another Privy app is signed by the
 *   same infrastructure; without this check anyone with any Privy app could
 *   issue tokens this app would accept.
 *
 * The subject is the Privy DID, which is the primary key of `users`.
 */

/** Privy's issuer, fixed. */
const ISSUER = "privy.io";

/** The one algorithm Privy signs with, and so the only one accepted. */
const ALGORITHMS = ["ES256"] as const;

export function privyJwksUrl(appId: string): string {
  return `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`;
}

/**
 * The key set, fetched once and cached.
 *
 * `createRemoteJWKSet` caches the response and refetches only when it sees a
 * key id it does not know, which is what makes this safe to call per request:
 * a key rotation is picked up without a deploy, and a steady state costs no
 * network at all.
 */
let cached: {appId: string; jwks: JWTVerifyGetKey} | null = null;

function keysFor(appId: string): JWTVerifyGetKey {
  if (cached?.appId !== appId) {
    cached = {appId, jwks: createRemoteJWKSet(new URL(privyJwksUrl(appId)))};
  }
  return cached.jwks;
}

/**
 * The Privy user id inside a verified token.
 *
 * Throws when the token is not valid for this app. The `jwks` parameter exists
 * so the checks below can be tested against a locally generated key rather than
 * against Privy's live endpoint.
 */
export async function privyUserId(
  token: string,
  appId: string,
  jwks: JWTVerifyGetKey = keysFor(appId),
): Promise<string> {
  const {payload} = await jwtVerify(token, jwks, {
    issuer: ISSUER,
    audience: appId,
    algorithms: [...ALGORITHMS],
  });

  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error("Token has no subject.");
  }
  return subject;
}

/**
 * Who is calling.
 *
 * Identity comes from the Privy access token and nothing else. Never from a
 * `userId` in the body, never from a wallet address in the query — both are
 * things a caller types, and trusting either would let anyone write to anyone's
 * profile by changing one string.
 *
 * The token is verified against Privy's published keys rather than decoded.
 * A decoded JWT is a claim; a verified one is a fact, and the difference is the
 * entire security of every write endpoint in the app.
 */

import {unauthorized} from "@/lib/server/http";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? "";

export const hasServerAuth = Boolean(APP_ID && APP_SECRET);

export interface Caller {
  /** Privy's DID — the primary key of `users`. */
  userId: string;
}

let clientPromise: Promise<import("@privy-io/server-auth").PrivyClient> | null = null;

function client() {
  if (!clientPromise) {
    clientPromise = import("@privy-io/server-auth").then(
      ({PrivyClient}) => new PrivyClient(APP_ID, APP_SECRET),
    );
  }
  return clientPromise;
}

/**
 * The caller, or a 401 response to return as-is.
 *
 * Returning the `Response` rather than throwing keeps the failure on the happy
 * path of every route: `if (caller instanceof Response) return caller;` is one
 * line and cannot be forgotten silently the way a missing try/catch can.
 */
export async function requireCaller(request: Request): Promise<Caller | Response> {
  if (!hasServerAuth) {
    return unauthorized(
      "Accounts are not configured on this deployment. Set PRIVY_APP_SECRET.",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized("Sign in to do that.");

  try {
    const verified = await (await client()).verifyAuthToken(token);
    return {userId: verified.userId};
  } catch {
    // Deliberately not echoing the verifier's message. It distinguishes
    // "expired" from "malformed" from "wrong app", which is useful to an
    // attacker probing and useless to a user, who needs to sign in either way.
    return unauthorized("Your session has expired. Sign in again.");
  }
}

/** The caller when there is one, without demanding it. For public reads. */
export async function optionalCaller(request: Request): Promise<Caller | null> {
  const result = await requireCaller(request);
  return result instanceof Response ? null : result;
}

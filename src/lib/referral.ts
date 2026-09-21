/**
 * The inviter, remembered in the visitor's browser until they sign up.
 *
 * A shared profile link is opened by someone with no account, who is sent to
 * the sign-up page, who may sign in through X — a redirect away and back —
 * before their account exists. The handle has to survive all of that, so it is
 * kept in localStorage rather than in the URL.
 *
 * Last link opened wins, and a remembered inviter expires after 30 days: a link
 * opened months ago did not cause today's sign-up.
 */

const KEY = "trador.referral";
const VISITOR_KEY = "trador.visitor";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HANDLE = /^[A-Za-z0-9_]{1,30}$/;

interface Stored {
  handle: string;
  at: number;
}

export function cleanHandle(value: string | null | undefined): string | null {
  const handle = (value ?? "").replace(/^@/, "").trim();
  return HANDLE.test(handle) ? handle : null;
}

export function saveReferral(value: string | null | undefined): void {
  const handle = cleanHandle(value);
  if (!handle || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({handle, at: Date.now()} satisfies Stored));
  } catch {
    // Storage blocked: the referral is lost, the sign-up still works.
  }
}

export function readReferral(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Stored | null;
    if (!stored || Date.now() - stored.at > MAX_AGE_MS) return null;
    return cleanHandle(stored.handle);
  } catch {
    return null;
  }
}

export function clearReferral(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/** A random id for this browser, so one person's repeated opens count once. */
export function visitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

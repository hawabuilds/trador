/**
 * A local hint that this browser had a session last time.
 *
 * Privy takes a moment to restore a session on a cold load, and reports
 * `authenticated: false` while it does. The landing page cannot tell that state
 * apart from a genuine visitor, so it rendered the marketing page and then
 * replaced it with the feed — a returning user watched the sign-in screen for a
 * second every time they opened the app.
 *
 * Holding the landing page back until Privy answers would fix that by making
 * every *first-time* visitor stare at a blank screen instead, which is a worse
 * trade. This hint resolves it without that cost: it is written when a session
 * exists and cleared when one ends, so the landing page can hold only for
 * people who will be redirected anyway.
 *
 * It is a hint and nothing more. It grants no access and is never read by the
 * server — anyone can set it, and all setting it buys is a blank screen until
 * Privy says otherwise. The session itself is still Privy's to prove.
 */

const KEY = "trador.signedIn";

export function readSignedInHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private mode. Falls back to the old behaviour rather than breaking.
    return false;
  }
}

export function writeSignedInHint(signedIn: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (signedIn) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode. Nothing to remember, which is the safe direction.
  }
}

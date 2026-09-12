"use client";

/**
 * Where the push-permission prompt will live.
 *
 * The intent function is already called from the places that earn the right to
 * ask — starring a coin, posting a comment, placing a trade — because that is
 * the part that is easy to get wrong later. Asking for notifications on first
 * load is the single most reliable way to get permanently denied, so the call
 * sites matter more than the prompt does.
 *
 * Until the prompt exists the intent is recorded and nothing is shown.
 */
export type PushIntent = "watchlist" | "comment" | "trade" | "launch";

let lastIntent: PushIntent | null = null;

export function requestPushIntent(intent: PushIntent): void {
  lastIntent = intent;
}

export function lastPushIntent(): PushIntent | null {
  return lastIntent;
}

export function PushPrompt() {
  return null;
}

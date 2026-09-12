/**
 * Where coin artwork caching will go.
 *
 * The predecessor app cached token art aggressively, for a specific reason: a
 * feed row whose avatar arrives late flashes, and one whose art fails on a
 * second render goes blank — so a logo that has loaded once is never allowed to
 * un-load. That machinery is worth having and none of it is worth faking.
 *
 * Trador has no art pipeline yet: coin images come from creator-supplied
 * metadata that has to be fetched, resized and served before it can be trusted
 * in a list, and rows currently render a seeded monogram instead. So these are
 * honest identity functions rather than a cache that does nothing behind a name
 * suggesting otherwise.
 */

import type {Asset, Stonk} from "./types";

export function applyCachedToken(stonk: Stonk): Stonk {
  return stonk;
}

export function applyCachedLogo<T>(asset: T): T {
  return asset;
}

export function applyCachedAssets(assets: Asset[]): Asset[] {
  return assets;
}

export function rememberTokens(_stonks: readonly Stonk[]): void {
  // No store yet — see the note above.
}

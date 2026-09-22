/**
 * Download the chart and trades code before a coin page is opened.
 *
 * Both are split out of the page bundle, so the page otherwise asks for them
 * only once it mounts, and draws them a round trip after everything else.
 * These are the same modules the page imports, so the page then finds them
 * already loaded. Once per session; the browser keeps them after that.
 */
let started = false;

export function preloadAssetPageCode(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void import("@/components/PriceChart");
  void import("@/components/panels/TradesPanel");
}

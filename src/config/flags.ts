/** Client-readable feature toggles for performance experiments. */

/** Live trade tape over SSE; falls back to polling when off or on error. */
export const TRADES_SSE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_TRADES_SSE === "1";

/** Register a minimal service worker for bootstrap + static shell caching. */
export const SERVICE_WORKER =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_SERVICE_WORKER === "1";

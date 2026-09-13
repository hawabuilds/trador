import type {Asset, AssetKind, Timeframe} from "./types";

/**
 * Chart-page URLs.
 *
 * Stocks are addressed by ticker and coins by mint, so a link is readable and
 * an address pasted into search resolves to the same page a row links to.
 * `timeframe` becomes `?tf=` so a click from the New sort opens 1m rather than
 * the generic default.
 *
 * A ticker is URI-encoded because some carry a dot — `BRK.Bx`. A mint is not
 * touched at all: base58 is case-sensitive, and the lowercasing its EVM
 * ancestor did here would have turned every link into a 404.
 */
export function assetPath(
  kind: AssetKind,
  id: string,
  timeframe?: Timeframe | null,
): string {
  const path =
    kind === "stock" ? `/stock/${encodeURIComponent(id)}` : `/stonk/${id}`;
  return timeframe ? `${path}?tf=${timeframe}` : path;
}

export function assetHref(asset: Asset, timeframe?: Timeframe | null): string {
  return assetPath(asset.kind, asset.id, timeframe);
}

export function profilePath(handle: string): string {
  return `/u/${handle.replace(/^@/, "")}`;
}

export function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://trador.fun")
  );
}

export function shareUrl(path: string): string {
  return `${appOrigin().replace(/\/$/, "")}${path}`;
}

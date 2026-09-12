/**
 * Money formatting for a feed that spans nine orders of magnitude.
 *
 * A launchpad coin can be worth $0.0000000031 and the stock it is priced
 * against $580. Rendering the first as `$0.00` is not a rounding choice, it is
 * wrong — so sub-cent prices compress their leading zeros into a subscript
 * instead of being flattened.
 *
 * The other rule is that an unknown price is never zero. `isPriced` exists so
 * callers have to decide what to show, because `$0.00` for a coin nobody could
 * price is the one formatting mistake a user cannot detect.
 */

export function isPriced(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function subscript(value: number): string {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPTS[Number(digit)])
    .join("");
}

/**
 * Group thousands by hand.
 *
 * `toLocaleString` would be shorter, but the server and the browser need not
 * share a locale, so it produces different strings on each side and React
 * discards the server HTML over the mismatch.
 */
function groupThousands(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function formatPriceUsd(value: number | null | undefined): string {
  if (!isPriced(value)) return "—";

  const abs = Math.abs(value);
  // A price keeps its digits. Compacting a stock at $1,196.81 to "$1.2K" drops
  // precision someone is about to trade on — compaction is for market caps and
  // volumes, where the magnitude is the point.
  if (abs >= 1_000_000) return formatCompactUsd(value);
  if (abs >= 1_000) return `$${groupThousands(value.toFixed(2))}`;
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs >= 0.01) return `$${value.toFixed(4)}`;

  const leadingZeros = Math.floor(-Math.log10(abs)) - 1;
  if (leadingZeros <= 2) return `$${value.toFixed(6)}`;

  const digits = Math.round(abs * 10 ** (leadingZeros + 4))
    .toString()
    .slice(0, 4);
  return `$0.0${subscript(leadingZeros)}${digits}`;
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);

  // Trillions are reachable here: the "underlying market cap" of a stock is the
  // company's, and several of the registry's names are over a trillion dollars.
  // Without this, NVIDIA renders as "$5271B".
  if (abs >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(abs >= 10_000_000_000_000 ? 1 : 2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/** Market cap, or an em dash. Never a zero standing in for "unknown". */
export function formatMarketCapUsd(value: number | null | undefined): string {
  return isPriced(value) ? formatCompactUsd(value) : "—";
}

export function formatVolumeUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  return formatCompactUsd(value);
}

/**
 * How long ago a coin listed, in the shortest form that is still unambiguous.
 *
 * Deterministic given `now`, which the caller must pass on any server-rendered
 * surface — otherwise the server and the browser compute different strings a
 * second apart and React discards the server HTML over the mismatch.
 */
export function tokenAge(
  listedAt: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!listedAt) return "";
  const then = new Date(listedAt).getTime();
  if (!Number.isFinite(then)) return "";

  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(months / 12)}y`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A timestamp that renders identically on the server and in the browser.
 *
 * `toLocaleString` cannot be used in server-rendered markup: the two runtimes
 * need not share a locale or a timezone, and a relative time cannot be used
 * either because the clock moves between render and hydration. Explicit UTC,
 * built by hand, is the only form that is stable in both.
 */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";

  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ` +
    `${String(date.getUTCHours()).padStart(2, "0")}:` +
    `${String(date.getUTCMinutes()).padStart(2, "0")} UTC`
  );
}

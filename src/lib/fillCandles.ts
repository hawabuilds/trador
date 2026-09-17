import type {ChartPoint} from "./types";

/**
 * Fill the buckets a provider left out.
 *
 * GeckoTerminal returns a candle only for a bucket that had at least one
 * trade, so a coin that goes quiet for an hour simply has no candles for that
 * hour. On the 15m and 1h charts of anything but the busiest coins that leaves
 * visible holes — a real one measured 33 missing buckets across 5 gaps, the
 * largest almost four hours wide.
 *
 * A no-trade bucket is not missing data, though. It means the price did not
 * move, because nothing moved it: the mark stays at the last close until
 * somebody trades again. So each gap is filled with flat candles at the
 * previous close, which is what the chart should have shown all along and what
 * every terminal does with an illiquid market.
 *
 * Nothing here invents movement. A filled candle has open, high, low and close
 * all equal to the last real close, so it reads as a flat line and can never
 * imply a high or a low that did not happen.
 */

/**
 * The most buckets one gap may be filled with.
 *
 * A coin dormant for a week would otherwise become two thousand fabricated
 * points on a 5m chart — a payload far larger than the real data, to draw a
 * flat line. Past this, the gap is left as it is: at that width it is not a
 * quiet patch, it is a coin that stopped trading, and the jump says so more
 * honestly than a very long flat line.
 */
const MAX_FILL_PER_GAP = 500;

export function fillCandles(
  points: readonly ChartPoint[],
  stepMs: number,
): ChartPoint[] {
  if (points.length < 2 || !Number.isFinite(stepMs) || stepMs <= 0) {
    return [...points];
  }

  const out: ChartPoint[] = [points[0]];

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const missing = Math.round((current.t - previous.t) / stepMs) - 1;

    // A half-bucket of clock skew is not a gap; anything under one whole
    // bucket rounds to zero and falls through here.
    if (missing > 0 && missing <= MAX_FILL_PER_GAP) {
      for (let step = 1; step <= missing; step += 1) {
        out.push({
          t: previous.t + step * stepMs,
          price: previous.price,
          open: previous.price,
          high: previous.price,
          low: previous.price,
        });
      }
    }

    out.push(current);
  }

  return out;
}

/** Bucket width in milliseconds, per timeframe. */
export const STEP_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1D": 86_400_000,
};

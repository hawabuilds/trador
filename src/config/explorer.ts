/**
 * Links out to a block explorer.
 *
 * Solscan by default because its account pages show token holders and pool
 * activity, which is what someone clicking through from a coin row actually
 * wants. Overridable, since which explorer people trust is a preference.
 */

const BASE = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://solscan.io").replace(
  /\/$/,
  "",
);

export const EXPLORER_NAME = process.env.NEXT_PUBLIC_EXPLORER_NAME ?? "Solscan";

export function accountUrl(address: string): string {
  return `${BASE}/account/${address}`;
}

export function tokenUrl(mint: string): string {
  return `${BASE}/token/${mint}`;
}

export function txUrl(signature: string): string {
  return `${BASE}/tx/${signature}`;
}

const API_KEY = process.env.JUPITER_API_KEY ?? "";

/** Swap + token hosts. Keyed requests use `api.jup.ag`; keyless defaults to lite. */
export const JUPITER_API_BASE =
  process.env.JUPITER_API_URL ??
  (API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag");

export function jupiterFetchHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    accept: "application/json",
    ...(API_KEY ? {"x-api-key": API_KEY} : {}),
    ...extra,
  };
}

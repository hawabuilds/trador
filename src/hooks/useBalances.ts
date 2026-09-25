"use client";

import {useQuery} from "@tanstack/react-query";

import type {Pubkey} from "@/lib/pubkey";

export interface BalancesResponse {
  lamports: string;
  tokens: Record<string, {amount: string; decimals: number}>;
}

export function balancesKey(wallet: Pubkey | null, mints: readonly string[]) {
  return ["balances", wallet, [...mints].sort().join(",")] as const;
}

/**
 * Exact balances for the mints an order ticket trades.
 *
 * Kept fresh rather than cached for long: the number drives a hard limit on
 * what the ticket will let you sign, so a stale one either blocks a trade you
 * can afford or allows one you cannot.
 */
export function useBalances(
  wallet: Pubkey | null,
  mints: readonly string[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: balancesKey(wallet, mints),
    enabled: enabled && wallet !== null,
    staleTime: 5_000,
    refetchInterval: enabled ? 15_000 : false,
    queryFn: async (): Promise<BalancesResponse> => {
      const response = await fetch(
        `/api/balances?wallet=${wallet}&mints=${mints.join(",")}`,
      );
      const body = (await response.json()) as BalancesResponse & {error?: string};
      if (!response.ok) throw new Error(body.error ?? "Could not read your balance.");
      return body;
    },
  });
}

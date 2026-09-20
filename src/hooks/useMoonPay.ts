"use client";

import {useCallback, useState} from "react";

import {isMoonPayEnabled} from "@/config/moonpay";
import {openMoonPayBuy} from "@/lib/moonpay";

export function useMoonPay() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buySol = useCallback(
    async (
      walletAddress: string,
      options?: {baseCurrencyAmount?: string; quoteCurrencyAmount?: string},
    ) => {
      if (!isMoonPayEnabled) {
        setError("MoonPay is not configured on this deployment.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await openMoonPayBuy(walletAddress, options);
      } catch (err) {
        setError((err as Error).message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {buySol, loading, error, enabled: isMoonPayEnabled};
}

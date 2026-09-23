"use client";

import {useEffect, useRef} from "react";

/** One view ping per mount — engagement input for trending score on next decorate. */
export function CoinPageView({mint}: {mint: string}) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/coin/view", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({mint}),
      keepalive: true,
    });
  }, [mint]);

  return null;
}

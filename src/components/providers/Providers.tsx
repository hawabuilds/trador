"use client";

import {useState} from "react";
import dynamic from "next/dynamic";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";

import {DemoSessionProvider} from "./DemoSession";
import {ThemeProvider} from "./ThemeProvider";
import {isPrivyConfigured} from "@/lib/session";

/**
 * Privy is a large dependency and the landing page does not need it, so it is
 * only loaded when an app id is actually configured. Without one the app runs
 * in demo mode, which is what a fresh checkout gets.
 */
const PrivySessionProvider = dynamic(
  () => import("./PrivySession").then((m) => ({default: m.PrivySessionProvider})),
  {ssr: false, loading: () => null},
);

export function Providers({children}: {children: React.ReactNode}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The feed re-polls on its own cadence; refetching on every window
            // focus on top of that just burns provider quota.
            refetchOnWindowFocus: false,
            staleTime: 10_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {isPrivyConfigured ? (
          <PrivySessionProvider>{children}</PrivySessionProvider>
        ) : (
          <DemoSessionProvider>{children}</DemoSessionProvider>
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}

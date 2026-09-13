"use client";

import {useCallback, useMemo} from "react";
import {PrivyProvider, usePrivy} from "@privy-io/react-auth";
import {useSignAndSendTransaction, useWallets} from "@privy-io/react-auth/solana";

import {encodeBase58} from "@/lib/pubkey";

import {asPubkey} from "@/lib/pubkey";
import {SessionContext, type Session} from "@/lib/session";
import {THEME} from "@/lib/theme";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * The real session: X login, an embedded Solana wallet, and signing.
 *
 * Solana-only on purpose. An EVM wallet created alongside would be an empty
 * account the user has to think about, on a chain this app cannot trade.
 */
export function PrivySessionProvider({children}: {children: React.ReactNode}) {
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["twitter"],
        embeddedWallets: {
          solana: {createOnLogin: "users-without-wallets"},
        },
        appearance: {
          // Dark, unconditionally — the app has one theme, and Privy's modal
          // opens over it. The accent is Solana purple, matching `--accent`;
          // it was still HODL's violet, which showed on the one screen every
          // new user sees first.
          theme: THEME,
          accentColor: "#9945FF",
          walletChainType: "solana-only",
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({children}: {children: React.ReactNode}) {
  const {ready, authenticated, user, login, logout, getAccessToken} = usePrivy();
  const {wallets} = useWallets();
  const {signAndSendTransaction} = useSignAndSendTransaction();

  const wallet = wallets[0] ?? null;
  const address = asPubkey(wallet?.address ?? null);

  /**
   * Sign and send serialized transaction bytes, returning the signature.
   *
   * The transaction was built server-side, so nothing here knows or cares what
   * is in it beyond its bytes — which is what keeps `@solana/web3.js` and
   * Anchor out of the browser bundle entirely.
   *
   * Sign-and-send rather than sign-then-broadcast-ourselves: Privy already
   * holds an RPC connection, and doing it in two steps means owning retry and
   * confirmation logic for no benefit. Preflight simulation is left on — it is
   * the last guard before a bad instruction costs real SOL.
   */
  const signAndSend = useCallback(
    async (transaction: Uint8Array): Promise<string> => {
      if (!wallet) throw new Error("No wallet connected.");
      const {signature} = await signAndSendTransaction({transaction, wallet});
      // Solana signatures are base58, everywhere — explorers, RPC, logs.
      return encodeBase58(signature);
    },
    [signAndSendTransaction, wallet],
  );

  const twitter = user?.twitter ?? null;

  const session = useMemo<Session>(
    () => ({
      ready,
      authenticated,
      mode: "privy",
      user:
        authenticated && user
          ? {
              id: user.id,
              handle: twitter?.username ?? user.id.slice(-8),
              displayName: twitter?.name ?? twitter?.username ?? "Trader",
              pfpUrl: twitter?.profilePictureUrl ?? null,
              wallet: address,
            }
          : null,
      login,
      logout,
      signAndSend: wallet ? signAndSend : null,
      getAccessToken: async () => {
        try {
          return await getAccessToken();
        } catch {
          return null;
        }
      },
    }),
    [
      ready,
      authenticated,
      user,
      twitter,
      address,
      login,
      logout,
      wallet,
      signAndSend,
      getAccessToken,
    ],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

"use client";

import {useCallback, useMemo} from "react";
import {PrivyProvider, usePrivy} from "@privy-io/react-auth";
import {useSignAndSendTransaction, useWallets} from "@privy-io/react-auth/solana";
import {createSolanaRpc, createSolanaRpcSubscriptions} from "@solana/kit";

import {encodeBase58} from "@/lib/pubkey";

import {asPubkey} from "@/lib/pubkey";
import {SessionContext, type Session} from "@/lib/session";
import {THEME} from "@/lib/theme";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** The one chain this app trades on. */
const CHAIN = "solana:mainnet" as const;

/**
 * Where the browser sends transactions.
 *
 * Privy's Solana hooks broadcast from the browser, so they need an endpoint the
 * browser can reach — and with nothing configured there is no endpoint at all,
 * which is what made pressing Buy fail.
 *
 * The default is this app's own `/api/rpc`, which forwards to Helius with the
 * key kept server-side. `NEXT_PUBLIC_SOLANA_RPC_URL` overrides it for a
 * deployment that would rather point straight at a domain-restricted key.
 *
 * Subscriptions cannot go through that proxy — a route handler cannot hold a
 * websocket — so they default to the public endpoint. They are used to watch a
 * signature confirm, not to send, so the worst case is a slower confirmation
 * rather than a lost transaction.
 *
 * `@solana/kit` appears here and nowhere else. Every transaction in this app is
 * still built server-side with web3.js and signed over serialized bytes; this
 * is a connection handle Privy asks for, not a second way to build a
 * transaction, so the two worlds still never meet.
 */
function solanaRpcs() {
  const http =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    (typeof window === "undefined" ? "https://api.mainnet-beta.solana.com" : `${window.location.origin}/api/rpc`);
  const ws =
    process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "wss://api.mainnet-beta.solana.com";

  return {
    [CHAIN]: {
      rpc: createSolanaRpc(http),
      rpcSubscriptions: createSolanaRpcSubscriptions(ws),
      blockExplorerUrl: "https://solscan.io",
    },
  };
}

/**
 * The real session: X login, an embedded Solana wallet, and signing.
 *
 * Solana-only on purpose. An EVM wallet created alongside would be an empty
 * account the user has to think about, on a chain this app cannot trade.
 */
export function PrivySessionProvider({children}: {children: React.ReactNode}) {
  /*
   * Built once. These are live connection handles, and rebuilding them on every
   * render hands Privy a different object each time — which at best throws the
   * previous one away and at worst re-initialises the wallet mid-session.
   */
  const rpcs = useMemo(solanaRpcs, []);

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["twitter"],
        embeddedWallets: {
          solana: {createOnLogin: "users-without-wallets"},
        },
        solana: {rpcs},
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
      // The chain is named explicitly. It is optional in the SDK, which means
      // an unset one is resolved by Privy rather than by us — and "whichever
      // cluster the SDK defaulted to" is not something a trade should rest on.
      const {signature} = await signAndSendTransaction({
        transaction,
        wallet,
        chain: CHAIN,
      });
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
              /*
               * X serves a 48px "_normal" crop by default, which is visibly
               * soft on a 42px retina avatar and worse on a profile header.
               * The original is the same URL without that suffix — the same
               * upgrade `live/x.ts` already does for news cards.
               */
              pfpUrl: twitter?.profilePictureUrl?.replace("_normal", "_400x400") ?? null,
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

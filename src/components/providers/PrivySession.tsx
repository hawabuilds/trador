"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {PrivyProvider, usePrivy} from "@privy-io/react-auth";
import {
  useExportWallet,
  useImportWallet,
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {createSolanaRpc, createSolanaRpcSubscriptions} from "@solana/kit";

import {LOCAL_STORE_EVENT, readActiveWallet, writeActiveWallet} from "@/lib/localStore";
import {asPubkey, encodeBase58, type Pubkey} from "@/lib/pubkey";
import {SessionContext, type Session} from "@/lib/session";
import {writeSignedInHint} from "@/lib/signedInHint";
import {THEME} from "@/lib/theme";
import {pickActiveWallet, type WalletEntry} from "@/lib/wallets";

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
 * The default is this app's own `/api/rpc`, which forwards to the configured RPC with the
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
    (typeof window === "undefined"
      ? "https://api.mainnet-beta.solana.com"
      : `${window.location.origin}/api/rpc`);

  /*
   * Subscriptions are configured because the SDK's type requires them, not
   * because this app depends on them: sends use `optimisticBroadcast` and the
   * ticket confirms over HTTP through the proxy. The public endpoint refuses
   * browser origins, which is exactly why nothing is allowed to need it.
   */
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
  const {exportWallet: privyExportWallet} = useExportWallet();
  const {importWallet: privyImportWallet} = useImportWallet();

  const userId = user?.id ?? null;

  /** Which of the account's Solana wallets were imported rather than created. */
  const importedByAddress = useMemo(() => {
    const flags = new Map<string, boolean>();
    for (const account of user?.linkedAccounts ?? []) {
      if (account.type !== "wallet" || account.chainType !== "solana") continue;
      flags.set(account.address, account.imported);
    }
    return flags;
  }, [user]);

  const entries = useMemo<WalletEntry[]>(
    () =>
      wallets.flatMap((connected) => {
        const address = asPubkey(connected.address);
        return address
          ? [{address, imported: importedByAddress.get(connected.address) ?? false}]
          : [];
      }),
    [wallets, importedByAddress],
  );

  /*
   * The wallet that trades, chosen rather than defaulted.
   *
   * This was `wallets[0]`. With one wallet that is the only answer; with an
   * imported second one it would let the list order decide which wallet signs
   * and which portfolio is on screen.
   */
  const [storedActive, setStoredActive] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    const sync = () => setStoredActive(readActiveWallet(userId));
    sync();
    window.addEventListener(LOCAL_STORE_EVENT, sync);
    return () => window.removeEventListener(LOCAL_STORE_EVENT, sync);
  }, [userId]);

  const active = pickActiveWallet(entries, storedActive);
  const wallet = active
    ? (wallets.find((connected) => connected.address === active.address) ?? null)
    : null;
  const address = active?.address ?? null;

  const setActiveWallet = useCallback(
    (next: Pubkey) => {
      if (!userId) return;
      writeActiveWallet(userId, next);
      setStoredActive(next);
    },
    [userId],
  );

  // Privy renders the key in its own iframe; nothing comes back to this app.
  const exportWallet = useCallback(
    (target: Pubkey) => privyExportWallet({address: target}),
    [privyExportWallet],
  );

  /*
   * The one place key material passes through this codebase.
   *
   * Privy has no hosted screen for import, so the key has to be handed to its
   * SDK from here. It goes straight to that call: not stored, not logged, not
   * sent to this app's server, and the sheet that collected it clears it.
   */
  const importWallet = useCallback(
    async (privateKey: string): Promise<Pubkey> => {
      const imported = await privyImportWallet({privateKey: privateKey.trim()});
      const importedAddress = asPubkey(imported.address);
      if (!importedAddress) throw new Error("The imported wallet has an unexpected address.");
      // Importing a wallet is a request to use it.
      setActiveWallet(importedAddress);
      return importedAddress;
    },
    [privyImportWallet, setActiveWallet],
  );

  const hasImported = entries.some((entry) => entry.imported);

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
      /*
       * Broadcast, and confirm ourselves.
       *
       * Privy's own confirmation watches the signature over `rpcSubscriptions`,
       * which is a websocket — and a route handler cannot proxy one, so that
       * had to point at the public endpoint, which refuses browser origins. The
       * transaction landed and the wallet then reported "Something went wrong",
       * which is the worst possible pairing: the money moved and the UI said it
       * had not.
       *
       * `optimisticBroadcast` keeps the send awaited — a failed broadcast still
       * throws here — and skips only the confirmation watch. The ticket then
       * polls for the status through our own RPC proxy, so confirmation runs
       * over the same working path as everything else.
       */
      const {signature} = await signAndSendTransaction({
        transaction,
        wallet,
        chain: CHAIN,
        options: {optimisticBroadcast: true},
      });
      // Solana signatures are base58, everywhere — explorers, RPC, logs.
      return encodeBase58(signature);
    },
    [signAndSendTransaction, wallet],
  );

  /*
   * Remember that this browser had a session, so the landing page can hold
   * instead of showing the door to someone who is about to be redirected in.
   * Written only once Privy is `ready`, because before that `authenticated` is
   * false for everyone and would clear the hint it exists to keep.
   */
  useEffect(() => {
    if (ready) writeSignedInHint(authenticated);
  }, [ready, authenticated]);

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
      wallets: authenticated ? entries : [],
      setActiveWallet: authenticated && entries.length > 1 ? setActiveWallet : null,
      exportWallet: authenticated && entries.length > 0 ? exportWallet : null,
      // Privy allows one imported wallet per account.
      importWallet: authenticated && !hasImported ? importWallet : null,
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
      entries,
      setActiveWallet,
      exportWallet,
      importWallet,
      hasImported,
    ],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

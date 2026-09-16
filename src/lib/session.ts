"use client";

import {createContext, useContext} from "react";

import type {Pubkey} from "./pubkey";
import type {WalletEntry} from "./wallets";

export interface AppUser {
  /** Stable identity id. Privy's DID in real mode. */
  id: string;
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  /** The embedded Solana wallet, once it exists. */
  wallet: Pubkey | null;
}

/**
 * What the app needs from whoever is signed in.
 *
 * The signing surface is a single method taking serialized transaction bytes,
 * which is the whole reason the Solana SDKs never reach the browser: every
 * instruction is built server-side and the client only ever signs an opaque
 * `Uint8Array`. Privy's Solana hooks take exactly that shape, so the two
 * dependency worlds meet at bytes and nowhere else.
 */
export interface Session {
  ready: boolean;
  authenticated: boolean;
  user: AppUser | null;
  mode: "privy" | "demo";
  login: () => void;
  logout: () => void;
  /** Null when there is no wallet to sign with. */
  signAndSend: ((transaction: Uint8Array) => Promise<string>) | null;
  getAccessToken: () => Promise<string | null>;

  /** Every Solana wallet on the account. `user.wallet` is the one that trades. */
  wallets: WalletEntry[];
  /** Choose which wallet trades. Null when there is nothing to choose. */
  setActiveWallet: ((address: Pubkey) => void) | null;
  /**
   * Open Privy's export screen for one wallet.
   *
   * The key is shown inside Privy's iframe, on Privy's domain; this app never
   * receives it. Null in demo mode.
   */
  exportWallet: ((address: Pubkey) => Promise<void>) | null;
  /**
   * Import a wallet from its base58 private key, and make it the one that
   * trades. Null in demo mode, or once the account already has an imported
   * wallet — Privy allows one.
   */
  importWallet: ((privateKey: string) => Promise<Pubkey>) | null;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    // A component reading the session outside the provider is a wiring bug, and
    // a silent "signed out" default would hide it behind an empty screen.
    throw new Error("useSession must be used inside a session provider");
  }
  return session;
}

export const isPrivyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

/**
 * Is this page load a return trip from an OAuth redirect?
 *
 * Checked before any "signed out, go home" redirect fires, because the moment
 * the provider hands control back the session is legitimately not ready yet —
 * and bouncing the user to the landing page at exactly that moment is how a
 * login loop starts.
 */
export function isPrivyOAuthReturn(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.has("privy_oauth_code") ||
    params.has("privy_oauth_state") ||
    params.has("privy_oauth_provider")
  );
}

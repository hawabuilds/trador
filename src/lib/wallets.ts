import {decodeBase58, type Pubkey} from "./pubkey";

/** One of the signed-in account's Solana wallets. */
export interface WalletEntry {
  address: Pubkey;
  /** Brought in with a private key, rather than created at sign-in. */
  imported: boolean;
}

/**
 * Which wallet trades.
 *
 * The session used to take `wallets[0]` — whichever one Privy listed first.
 * With a single wallet that is the only answer; once a second is imported, it
 * means the wallet you trade from, and the portfolio you see, can change
 * without anyone choosing it. So: the stored choice if it is still one of
 * yours, otherwise the wallet created at sign-in, otherwise whatever exists.
 */
export function pickActiveWallet(
  wallets: readonly WalletEntry[],
  stored: string | null,
): WalletEntry | null {
  if (wallets.length === 0) return null;
  const chosen = stored ? wallets.find((wallet) => wallet.address === stored) : undefined;
  return chosen ?? wallets.find((wallet) => !wallet.imported) ?? wallets[0];
}

/** Length of a Solana keypair's secret key: 32-byte seed + 32-byte public key. */
export const SECRET_KEY_BYTES = 64;

/**
 * Is this pasted text shaped like an exported Solana private key?
 *
 * Phantom, Solflare and Backpack all export the 64-byte keypair as base58.
 * Checked before it is handed on, so a stray address or a seed phrase gets a
 * plain answer here instead of an opaque failure from inside the import flow.
 * Only the shape is checked — the text is never stored, logged or sent to
 * this app's server.
 */
export function isSolanaSecretKey(text: string): boolean {
  const decoded = decodeBase58(text.trim());
  return decoded !== null && decoded.length === SECRET_KEY_BYTES;
}

/**
 * What is wrong with pasted import text, or null if it can be submitted.
 *
 * Never repeats the text back: whatever was pasted might be a real key.
 */
export function importProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "Paste a private key to import.";
  if (/\s/.test(trimmed)) {
    return "That looks like a seed phrase. Export the private key from your wallet app instead — seed phrases can't be imported.";
  }
  if (!isSolanaSecretKey(trimmed)) {
    return "That isn't a Solana private key. Paste the base58 key exported from Phantom, Solflare or Backpack — not a wallet address.";
  }
  return null;
}

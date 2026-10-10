/**
 * Where the platform fee lands, and in what.
 *
 * No Trador program is involved. Jupiter takes `platformFeeBps` on the quote
 * and an initialised `feeAccount` on the build, and pays the fee into that
 * account. All this file decides is which account to name.
 *
 * The rule is that the fee is only ever taken in money — USDC or wrapped SOL —
 * never in the stock or coin being traded. On a sell the money is the output,
 * on a buy it is the input, and Swap v2 accepts a fee account on either leg.
 * That is the whole reason the app is on v2: v1 rejects an input-side fee
 * account on-chain with error 6014.
 *
 * Two failure modes are deliberately quiet. An unset or malformed
 * `TRADOR_FEE_WALLET`, and a vault whose token account has not been created
 * yet, both mean "no fee" — the trade still goes through. Nobody should be
 * unable to sell because a collection account is missing.
 */

import {Connection, PublicKey} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";

import {FEE_BPS} from "@/config/fees";
import {TOKEN_2022_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {
  type Pubkey,
  assertPubkey,
  asPubkey,
  isDefaultPubkey,
  samePubkey,
} from "@/lib/pubkey";
import {serverRpcUrl} from "@/lib/server/rpcUrl";

/** The mints a fee may be taken in. Nothing else is money. */
const FEE_MINTS: readonly Pubkey[] = [USDC_MINT, WSOL_MINT];

/** Which leg of the trade the fee comes out of. */
export type FeeSide = "input" | "output";

export interface TradeFee {
  /** The initialised token account Jupiter pays into. */
  account: Pubkey;
  /** Always USDC or wSOL. */
  mint: Pubkey;
  side: FeeSide;
  bps: number;
}

const PLACEHOLDERS = new Set(["unset", "none", "tbd", "changeme", "placeholder"]);

/** The collection wallet, or null when it is unset, invalid or a placeholder. */
export function feeWalletFromEnv(): Pubkey | null {
  const raw = process.env.TRADOR_FEE_WALLET?.trim();
  if (!raw) return null;
  if (PLACEHOLDERS.has(raw.toLowerCase())) return null; // pubkey-lint-ok: a placeholder word, not an address
  const parsed = asPubkey(raw);
  if (!parsed || isDefaultPubkey(parsed)) return null;
  return parsed;
}

function isFeeMint(mint: Pubkey): boolean {
  return FEE_MINTS.some((candidate) => samePubkey(candidate, mint));
}

/**
 * Which mint this trade's fee is taken in, and from which leg.
 *
 * Output first, so a sell pays out of its proceeds — which is both what the
 * quote already prices and the only side where Jupiter's own figure can be
 * trusted. A buy falls through to the input. A trade with money on neither
 * side (a coin for a stock) takes no fee at all.
 */
export function feeLegFor(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): {mint: Pubkey; side: FeeSide} | null {
  if (isFeeMint(params.outputMint)) return {mint: params.outputMint, side: "output"};
  if (isFeeMint(params.inputMint)) return {mint: params.inputMint, side: "input"};
  return null;
}

const TOKEN_PROGRAMS = [
  new PublicKey(TOKEN_PROGRAM),
  new PublicKey(TOKEN_2022_PROGRAM),
];

function rpc() {
  return new Connection(serverRpcUrl(), "confirmed");
}

/** The mint an initialised token account holds, or null if it is neither. */
async function mintOfTokenAccount(address: Pubkey): Promise<Pubkey | null> {
  const info = await rpc().getAccountInfo(new PublicKey(address));
  if (!info) return null;
  const program = TOKEN_PROGRAMS.find((id) => id.equals(info.owner));
  if (!program) return null;
  try {
    const account = unpackAccount(new PublicKey(address), info, program);
    return assertPubkey(account.mint.toBase58(), "token account mint");
  } catch {
    return null;
  }
}

/**
 * The vault's associated token account for a mint.
 *
 * Off-curve owners are allowed because a Squads vault is a program address,
 * not a keypair, and the on-curve check would throw on one.
 */
export function feeAccountAddress(wallet: Pubkey, mint: Pubkey): Pubkey {
  return assertPubkey(
    getAssociatedTokenAddressSync(
      new PublicKey(mint),
      new PublicKey(wallet),
      true,
      TOKEN_PROGRAM_ID,
    ).toBase58(),
    "fee token account",
  );
}

/**
 * The decision itself, with every input handed in.
 *
 * Separated from the lookups so each way a fee can be declined — rate off, no
 * wallet, no money leg, an account that was never created, an account holding
 * the wrong mint — is a branch that can be tested without a network or a
 * particular environment.
 */
export function feeFromParts(params: {
  bps: number;
  wallet: Pubkey | null;
  leg: {mint: Pubkey; side: FeeSide} | null;
  /** The mint the collection account actually holds, or null if it has none. */
  accountMint: Pubkey | null;
}): TradeFee | null {
  const {bps, wallet, leg, accountMint} = params;
  if (!Number.isFinite(bps) || bps <= 0) return null;
  if (!wallet) return null;
  if (!leg) return null;
  if (accountMint === null || !samePubkey(accountMint, leg.mint)) return null;

  return {
    account: feeAccountAddress(wallet, leg.mint),
    mint: leg.mint,
    side: leg.side,
    bps,
  };
}

/**
 * What the fee actually comes to, in base units of the mint it is taken in.
 *
 * Only the output side can use Jupiter's own number. `platformFee.amount` on a
 * quote is always denominated in the *output* mint, even when the fee is taken
 * from the input, so on a buy it describes the token being bought and is no use
 * at all — on a $25 USDC buy it read 16,076 token units against a real charge
 * of 125,000 USDC units. The input side is therefore worked out here, from the
 * amount being spent, which is exactly what the router charges: floor of
 * `inAmount * bps / 10000`, measured against mainnet.
 */
export function feeAmountFor(params: {
  fee: Pick<TradeFee, "side" | "bps">;
  /** Base units going in, from the quote. */
  inAmount: string;
  /** Jupiter's figure, in output-mint base units. */
  quotedFeeAmount: string | null;
}): string | null {
  if (params.fee.side === "output") return params.quotedFeeAmount;
  if (!/^\d+$/.test(params.inAmount)) return null;
  return ((BigInt(params.inAmount) * BigInt(params.fee.bps)) / 10_000n).toString();
}

/** How a fee mint is written and counted on the ticket. */
export function feeTokenFace(mint: Pubkey): {symbol: string; decimals: number} {
  // wSOL is shown as SOL: the swap wraps and unwraps around the trade, so
  // "wSOL" would name something the person never knowingly holds.
  return samePubkey(mint, WSOL_MINT)
    ? {symbol: "SOL", decimals: 9}
    : {symbol: "USDC", decimals: 6};
}

const CACHE_MS = 30_000;
const cache = new Map<string, {at: number; value: TradeFee | null}>();

async function resolveUncached(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): Promise<TradeFee | null> {
  const wallet = feeWalletFromEnv();
  const leg = feeLegFor(params);
  if (FEE_BPS <= 0 || !wallet || !leg) return null;

  // Jupiter does not check that the account's mint belongs to the pair — a
  // wrong one builds cleanly and fails on-chain — so this is read here or not
  // checked at all. It is also how an uncreated vault account is detected.
  const accountMint = await mintOfTokenAccount(feeAccountAddress(wallet, leg.mint));

  return feeFromParts({bps: FEE_BPS, wallet, leg, accountMint});
}

/** The fee this trade can take, or null when it should take none. */
export async function resolveTradeFee(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): Promise<TradeFee | null> {
  const key = `${params.inputMint}\0${params.outputMint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const value = await resolveUncached(params);
  cache.set(key, {at: Date.now(), value});
  return value;
}

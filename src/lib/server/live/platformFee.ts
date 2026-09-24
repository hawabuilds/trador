/**
 * Platform fee token account for Jupiter swaps.
 *
 * No Trador smart contract is involved. Jupiter's hosted API accepts
 * `platformFeeBps` on the quote and a matching, **initialized** `feeAccount`
 * on the build; the fee lands in that token account. Until you are ready, leave
 * `NEXT_PUBLIC_FEE_WALLET` unset — swaps price and simulate with no platform
 * fee.
 *
 * When you turn fees on: set the collector **wallet** (base58) and initialize
 * its wSOL associated token account once. Fees apply on **sells** (token → SOL)
 * only — Jupiter takes ExactIn platform fees from the output mint, so wSOL
 * collection on buys would need a per-stock collector ATA. You may paste an
 * existing wSOL token account instead of the wallet. Unset env, invalid base58,
 * placeholders, or a missing ATA all mean "no fee" — never a user-facing error.
 *
 * Passing a wSOL `feeAccount` on a buy (SOL → token) fails simulation with
 * Jupiter 6014/6025 — Privy surfaces that as "your transaction will likely fail."
 */

import {Connection, PublicKey} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";

import {FEE_BPS} from "@/config/fees";
import {TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT} from "@/lib/programs";
import {
  type Pubkey,
  assertPubkey,
  asPubkey,
  isDefaultPubkey,
  samePubkey,
} from "@/lib/pubkey";
import {serverRpcUrl} from "@/lib/server/rpcUrl";

/** Parse fee collector from env; invalid or placeholder values mean no fee. */
export function feeCollectorFromEnv(): Pubkey | null {
  const raw = process.env.NEXT_PUBLIC_FEE_WALLET?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower === "unset" ||
    lower === "none" ||
    lower === "tbd" ||
    lower === "changeme" ||
    lower === "placeholder"
  ) {
    return null;
  }
  const parsed = asPubkey(raw);
  if (!parsed || isDefaultPubkey(parsed)) return null;
  return parsed;
}

/** Fee collector: owner wallet, or an existing wSOL token account. */
export const FEE_COLLECTOR = feeCollectorFromEnv();

const TOKEN_PROGRAMS = [
  new PublicKey(TOKEN_PROGRAM),
  new PublicKey(TOKEN_2022_PROGRAM),
];

function rpc() {
  return new Connection(serverRpcUrl(), "confirmed");
}

async function readTokenAccount(
  address: Pubkey,
): Promise<{owner: Pubkey; mint: Pubkey} | null> {
  const info = await rpc().getAccountInfo(new PublicKey(address));
  if (!info) return null;
  const program = TOKEN_PROGRAMS.find((id) => id.equals(info.owner));
  if (!program) return null;
  try {
    const acct = unpackAccount(new PublicKey(address), info, program);
    return {
      owner: assertPubkey(acct.owner.toBase58(), "token account owner"),
      mint: assertPubkey(acct.mint.toBase58(), "token account mint"),
    };
  } catch {
    return null;
  }
}

async function initializedTokenAccount(address: Pubkey): Promise<boolean> {
  return (await readTokenAccount(address)) !== null;
}

/** Whether this pair can take a wSOL platform fee (ExactIn: fee mint is output). */
export function platformFeePairEligible(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): boolean {
  const wsolLeg =
    samePubkey(params.inputMint, WSOL_MINT) || samePubkey(params.outputMint, WSOL_MINT);
  return wsolLeg && samePubkey(params.outputMint, WSOL_MINT);
}

/**
 * Initialized wSOL ATA that can receive the platform fee for this pair, or null
 * when fees should not be priced (missing collector config or ATA).
 */
export async function resolvePlatformFeeAccount(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): Promise<Pubkey | null> {
  if (FEE_BPS <= 0 || !FEE_COLLECTOR) return null;
  if (!platformFeePairEligible(params)) return null;

  const configured = await readTokenAccount(FEE_COLLECTOR);
  if (configured && samePubkey(configured.mint, WSOL_MINT)) {
    return FEE_COLLECTOR;
  }

  const owner = configured?.owner ?? FEE_COLLECTOR;
  const wsolAta = assertPubkey(
    getAssociatedTokenAddressSync(
      new PublicKey(WSOL_MINT),
      new PublicKey(owner),
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58(),
    "collector wSOL ATA",
  );

  if (await initializedTokenAccount(wsolAta)) return wsolAta;
  return null;
}

/**
 * Platform fee token account for Jupiter swaps.
 *
 * Jupiter takes `platformFeeBps` on the quote and a matching, **initialized**
 * `feeAccount` on the build. The account's mint must be the input or output of
 * the swap (ExactIn). Passing a wallet address, an uninitialized ATA, or a
 * wSOL account on a route that prices the fee in the output token fails
 * simulation with Jupiter error 6025 — Privy surfaces that as "your transaction
 * will likely fail."
 *
 * OrderSheet only trades SOL ↔ token, so fees are always collected in wSOL:
 * one ATA for the collector, not one per stock mint.
 */

import {Connection, PublicKey} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";

import {FEE_BPS} from "@/config/fees";
import {TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT} from "@/lib/programs";
import {type Pubkey, assertPubkey, asPubkey, samePubkey} from "@/lib/pubkey";
import {serverRpcUrl} from "@/lib/server/rpcUrl";

/** Fee collector: owner wallet, or an existing wSOL token account. */
export const FEE_COLLECTOR = asPubkey(process.env.NEXT_PUBLIC_FEE_WALLET ?? "");

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

/**
 * Initialized wSOL ATA that can receive the platform fee for this pair, or null
 * when fees should not be priced (missing collector config or ATA).
 */
export async function resolvePlatformFeeAccount(params: {
  inputMint: Pubkey;
  outputMint: Pubkey;
}): Promise<Pubkey | null> {
  if (FEE_BPS <= 0 || !FEE_COLLECTOR) return null;

  const wsolLeg =
    samePubkey(params.inputMint, WSOL_MINT) || samePubkey(params.outputMint, WSOL_MINT);
  if (!wsolLeg) return null;

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

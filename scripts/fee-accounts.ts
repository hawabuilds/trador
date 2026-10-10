/**
 * Create the fee vault's USDC and wSOL token accounts.
 *
 * Jupiter pays a platform fee into a token account that must already exist, so
 * until these two are created the app takes no fee at all — see `platformFee.ts`
 * for why that is a quiet skip rather than an error. This creates them.
 *
 * Two things make it simpler than it looks. A Squads vault is a program address
 * rather than a keypair, so its associated token accounts must be derived with
 * the on-curve check turned off — with it on, the derivation throws. And
 * creating an associated token account does not need the owner's signature:
 * anyone can pay the rent for anyone else's, so the multisig is not involved.
 *
 * Dry run, which touches no keys at all:
 *
 *   TRADOR_FEE_WALLET=<vault> npm run fee:accounts
 *
 * To actually create them, signing with your own CLI wallet:
 *
 *   TRADOR_FEE_WALLET=<vault> npm run fee:accounts -- --send
 *
 * The keypair is read by the Solana CLI's own convention, from
 * `~/.config/solana/id.json` or `--keypair <path>`. It is never printed, and
 * nothing else in this repo reads it.
 */

import {readFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {asPubkey} from "@/lib/pubkey";
import {feeAccountAddress} from "@/lib/server/live/platformFee";

const MINTS = [
  {name: "USDC", mint: USDC_MINT},
  {name: "wSOL", mint: WSOL_MINT},
] as const;

function arg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function rpcUrl(): string {
  return (
    process.env.SERVER_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim() ||
    "https://api.mainnet-beta.solana.com"
  );
}

function sol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
}

async function main(): Promise<void> {
  const vault = asPubkey(process.env.TRADOR_FEE_WALLET?.trim() ?? "");
  if (!vault) {
    throw new Error(
      "Set TRADOR_FEE_WALLET to the vault address (base58) before running this.",
    );
  }

  const connection = new Connection(rpcUrl(), "confirmed");
  const owner = new PublicKey(vault);
  const offCurve = !PublicKey.isOnCurve(owner);

  console.log(`Vault    ${vault}`);
  console.log(`Type     ${offCurve ? "program address (off-curve)" : "wallet (on-curve)"}`);
  console.log(`RPC      ${new URL(rpcUrl()).host}`);
  console.log("");

  const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

  const planned: {name: string; address: PublicKey}[] = [];
  for (const {name, mint} of MINTS) {
    // The app's own derivation, not a second copy of it: an account created
    // at a different address from the one the quote names is the same as no
    // account at all, and it would fail silently as "no fee".
    const address = new PublicKey(feeAccountAddress(vault, mint));
    const exists = (await connection.getAccountInfo(address)) !== null;
    console.log(`${name.padEnd(5)} ${address.toBase58()}  ${exists ? "already exists" : "missing"}`);
    if (!exists) planned.push({name, address});
  }

  console.log("");
  if (planned.length === 0) {
    console.log("Both accounts exist. Nothing to do.");
    return;
  }

  const cost = rent * planned.length;
  console.log(
    `To create: ${planned.map((entry) => entry.name).join(" and ")}`,
  );
  console.log(`Rent     ${sol(rent)} each, ${sol(cost)} in total`);
  console.log(`Fee      about ${sol(5_000)} for the transaction`);
  console.log("");

  if (!process.argv.includes("--send")) {
    console.log("Dry run. Nothing was sent and no key was read.");
    console.log("Re-run with --send to create them.");
    return;
  }

  const keypairPath =
    arg("--keypair") ?? join(homedir(), ".config", "solana", "id.json");
  let payer: Keypair;
  try {
    payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
    );
  } catch {
    throw new Error(
      `Could not read a keypair from ${keypairPath}. Pass --keypair <path> if yours is elsewhere.`,
    );
  }

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Paying from ${payer.publicKey.toBase58()} (${sol(balance)})`);
  if (balance < cost + 10_000) {
    throw new Error("That wallet does not hold enough SOL for the rent and fee.");
  }

  const transaction = new Transaction();
  for (const {name, address} of planned) {
    const mint = MINTS.find((entry) => entry.name === name)!.mint;
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        address,
        owner,
        new PublicKey(mint),
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
  console.log("");
  console.log(`Created. https://solscan.io/tx/${signature}`);
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

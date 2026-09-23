/**
 * Putting a launch together: one transaction, simulated, with its cost laid out.
 *
 * Both launchpads hand this module the same thing — instructions, the extra
 * signers (the new mint), and how much stock the dev buy spends — and get back
 * bytes for the creator to sign plus an itemised bill. Keeping the assembly
 * here means the two launchpads cannot drift apart on the parts a user sees:
 * what it costs, and whether it would fail.
 *
 * **The bill is read off the simulation, not estimated.** The chain is asked
 * what every writable account holds before and after, so account rent is the
 * lamports that land in accounts which did not exist, and the launchpad's fee
 * is whatever else left the creator's wallet beyond rent and the network fee.
 * The lines add up to the total by construction — a "total" that is not the
 * sum of its lines is how people stop trusting a cost breakdown.
 *
 * **The dev buy is paid in the stock, not SOL,** on both launchpads, because the
 * curve is priced in the stock. The SOL-to-stock swap is its own transaction
 * (see `devBuySwap`): a launch creates about a dozen accounts no lookup table
 * can hold, and a SOL-to-stock route adds ten more, which is past the packet
 * limit — measured, not assumed.
 */

import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  type Keypair,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {getAssociatedTokenAddressSync} from "@solana/spl-token";

import {buildSwap, quote} from "./jupiter";
import type {Pubkey} from "@/lib/pubkey";
import {serverRpcUrl} from "../rpcUrl";

export const RPC_URL = serverRpcUrl();

export const connection = () => new Connection(RPC_URL, "confirmed");

export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Solana's fee per signature, fixed by the runtime. */
const LAMPORTS_PER_SIGNATURE = 5_000;
const COMPUTE_UNITS_BARE = 250_000;
const COMPUTE_UNITS_WITH_BUY = 450_000;
/** Priority, in micro-lamports per unit. Enough to land in a busy slot. */
const MICRO_LAMPORTS_PER_UNIT = 50_000;
/** The packet limit a serialized transaction must fit inside. */
const MAX_TRANSACTION_BYTES = 1_232;

export class LaunchRefused extends Error {}

/** A line on the bill. */
export interface CostLine {
  key: "network" | "rent" | "launchpad";
  label: string;
  lamports: number;
  note: string;
}

export interface DevBuyResult {
  /** Stock spent on the curve, in whole units. */
  stockIn: number;
  stockTicker: string;
  /** Coins the creator ends up holding, read from the simulation. */
  tokensOut: number;
  /** Share of total supply those coins are. */
  supplyPct: number;
  /** The launchpad's fee on the buy, in whole units of the stock. */
  tradingFeeStock: number;
  tradingFeeBps: number;
}

export interface AssembledLaunch {
  transaction: string;
  /** Every line, in lamports; they sum to `totalLamports`. */
  costs: CostLine[];
  totalLamports: number;
  /** SOL the wallet holds now. */
  balanceLamports: number;
  devBuy: DevBuyResult | null;
}

export interface DevBuyPlan {
  /** Stock to spend, in base units. */
  stockIn: bigint;
  stock: {mint: string; ticker: string; decimals: number};
  buy: TransactionInstruction[];
  /** Where the creator's coins land, to read the simulated result from. */
  creatorCoinAccount: PublicKey;
  coinDecimals: number;
  coinSupply: bigint;
  /** The launchpad's fee on a buy, when it is a published rate. */
  tradingFeeBps: number | null;
  /**
   * The curve's vault for the stock, when fees leave it: the stock that lands
   * there is the buy net of every fee, so the fee is read exactly.
   */
  curveQuoteVault?: PublicKey;
}

/** Stock the wallet holds, in base units, across every account for the mint. */
export async function stockBalance(owner: PublicKey, mint: string): Promise<bigint> {
  const accounts = await connection().getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(mint),
  });
  return accounts.value.reduce(
    (sum, account) =>
      sum + BigInt(account.account.data.parsed?.info?.tokenAmount?.amount ?? "0"),
    0n,
  );
}

/** Token amount at bytes 64..72 of an SPL token account, either program. */
function tokenAmount(data: Buffer | null | undefined): bigint {
  if (!data || data.length < 72) return 0n;
  return data.readBigUInt64LE(64);
}

function failureReason(logs: string[], err: unknown): {text: string; broke: boolean} {
  const text =
    logs.find((line) => /insufficient/i.test(line)) ??
    logs.find((line) => /Error Message:/.test(line))?.split("Error Message:")[1]?.trim() ??
    JSON.stringify(err);
  return {
    text,
    broke: /insufficient|AccountNotFound|InsufficientFunds/i.test(`${text} ${JSON.stringify(err)}`),
  };
}

export async function assembleLaunch(input: {
  creator: PublicKey;
  /** The launch itself: create the mint, the curve, the metadata. */
  launch: TransactionInstruction[];
  signers: Keypair[];
  devBuy: DevBuyPlan | null;
  /** The launchpad's name, for the fee line. */
  launchpadLabel: string;
  /**
   * Public lookup tables holding the launchpad's fixed accounts — the ones its
   * own site uses — so a launch with a buy fits in one packet.
   */
  lookupTables: string[];
}): Promise<AssembledLaunch> {
  const rpc = connection();
  const {creator, devBuy} = input;

  const units = devBuy ? COMPUTE_UNITS_WITH_BUY : COMPUTE_UNITS_BARE;
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({units}),
    ComputeBudgetProgram.setComputeUnitPrice({microLamports: MICRO_LAMPORTS_PER_UNIT}),
    ...input.launch,
    ...(devBuy?.buy ?? []),
  ];

  const tables = (
    await Promise.all(
      input.lookupTables.map(async (address) => {
        const {value} = await rpc.getAddressLookupTable(new PublicKey(address));
        return value;
      }),
    )
  ).filter((table): table is AddressLookupTableAccount => table !== null);

  const {blockhash} = await rpc.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(tables);
  const transaction = new VersionedTransaction(message);

  let bytes: Uint8Array;
  try {
    // Signing serializes the message, so it is the first thing to overrun.
    transaction.sign(input.signers);
    bytes = transaction.serialize();
  } catch {
    bytes = new Uint8Array(MAX_TRANSACTION_BYTES + 1);
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    throw new LaunchRefused("This launch doesn't fit in one transaction.");
  }

  // Every writable account, from the static keys and the lookup tables alike.
  const writable: PublicKey[] = [];
  message.staticAccountKeys.forEach((key, index) => {
    if (message.isAccountWritable(index)) writable.push(key);
  });
  for (const lookup of message.addressTableLookups) {
    const table = tables.find((entry) => entry.key.equals(lookup.accountKey));
    for (const index of lookup.writableIndexes) {
      const key = table?.state.addresses[index];
      if (key) writable.push(key);
    }
  }
  const watched = [...new Map(writable.map((key) => [key.toBase58(), key])).values()];

  const before = await rpc.getMultipleAccountsInfo(watched, "confirmed");
  const simulation = await rpc.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    accounts: {encoding: "base64", addresses: watched.map((key) => key.toBase58())},
  });

  const balanceLamports = before[watched.findIndex((key) => key.equals(creator))]?.lamports ?? 0;

  if (simulation.value.err) {
    const {text, broke} = failureReason(simulation.value.logs ?? [], simulation.value.err);
    throw new LaunchRefused(
      broke
        ? `Not enough SOL in this wallet. It holds ${(balanceLamports / 1e9).toFixed(4)} SOL, and a launch needs about 0.01 SOL.`
        : `The launch would fail: ${text}`,
    );
  }

  const after = simulation.value.accounts ?? [];
  let rent = 0;
  let creatorAfter = balanceLamports;
  let coinsOut = 0n;
  let stockIntoCurve: bigint | null = null;

  watched.forEach((key, index) => {
    const post = after[index];
    if (key.equals(creator)) {
      creatorAfter = post?.lamports ?? balanceLamports;
      return;
    }
    // Rent is what lands in accounts this transaction brings into being.
    if (!before[index] && post && post.lamports > 0) rent += post.lamports;
    if (devBuy && post && key.equals(devBuy.creatorCoinAccount)) {
      coinsOut = tokenAmount(Buffer.from(post.data[0], "base64"));
    }
    if (devBuy?.curveQuoteVault && post && key.equals(devBuy.curveQuoteVault)) {
      stockIntoCurve = tokenAmount(Buffer.from(post.data[0], "base64"));
    }
  });

  const signatures = message.header.numRequiredSignatures;
  const network =
    signatures * LAMPORTS_PER_SIGNATURE + Math.ceil((units * MICRO_LAMPORTS_PER_UNIT) / 1_000_000);
  // The simulation charges the fee itself, so the balance change is the
  // whole cost.
  const total = balanceLamports - creatorAfter;
  const launchpadFee = Math.max(0, total - network - rent);

  const costs: CostLine[] = [
    {
      key: "network",
      label: "Network fee",
      lamports: network,
      note: `${signatures} signatures, plus priority so it lands in a busy block`,
    },
    {
      key: "rent",
      label: "Account rent",
      lamports: rent,
      note: "One-time deposits that create the coin, its curve and your token account",
    },
    {
      key: "launchpad",
      label: `${input.launchpadLabel} fee`,
      lamports: launchpadFee,
      note: launchpadFee === 0 ? "Launching is free here" : "Charged by the launchpad to create the coin",
    },
  ];

  let result: DevBuyResult | null = null;
  if (devBuy) {
    const intoCurve = stockIntoCurve as bigint | null;
    const feeBase =
      intoCurve !== null
        ? Number(devBuy.stockIn - intoCurve)
        : (Number(devBuy.stockIn) * (devBuy.tradingFeeBps ?? 0)) / 10_000;
    const fee = Math.max(0, feeBase);
    result = {
      stockIn: Number(devBuy.stockIn) / 10 ** devBuy.stock.decimals,
      stockTicker: devBuy.stock.ticker,
      tokensOut: Number(coinsOut) / 10 ** devBuy.coinDecimals,
      supplyPct: devBuy.coinSupply > 0n ? (Number(coinsOut) / Number(devBuy.coinSupply)) * 100 : 0,
      tradingFeeStock: fee / 10 ** devBuy.stock.decimals,
      tradingFeeBps: devBuy.stockIn > 0n ? Math.round((fee / Number(devBuy.stockIn)) * 10_000) : 0,
    };
  }

  return {
    transaction: Buffer.from(bytes).toString("base64"),
    costs,
    totalLamports: costs.reduce((sum, line) => sum + line.lamports, 0),
    balanceLamports,
    devBuy: result,
  };
}

export interface DevBuySwap {
  transaction: string;
  solIn: number;
  /** What the swap is expected to deliver, and the least it can. */
  stockOut: bigint;
  stockMinOut: bigint;
  priceImpactPct: number;
  route: string[];
  /** Network fee plus any token-account rent, from the simulation. */
  overheadLamports: number;
}

/**
 * The swap from SOL into the stock that pays for a dev buy.
 *
 * A normal Jupiter swap, simulated against the creator's wallet so its own
 * overhead — the fee and the stock account's rent if it is new — is a measured
 * number on the bill. No platform fee: Trador takes nothing on a launch.
 */
export async function devBuySwap(input: {
  creator: Pubkey;
  stockMint: Pubkey;
  lamports: bigint;
}): Promise<DevBuySwap> {
  const quoted = await quote({
    inputMint: SOL_MINT as Pubkey,
    outputMint: input.stockMint,
    amount: input.lamports.toString(),
    slippageBps: 100,
  });
  const built = await buildSwap({quote: quoted, userPublicKey: input.creator});

  const rpc = connection();
  const transaction = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  const creator = new PublicKey(input.creator);
  const stockProgram = (await rpc.getAccountInfo(new PublicKey(input.stockMint)))?.owner;
  const stockAccount = getAssociatedTokenAddressSync(
    new PublicKey(input.stockMint),
    creator,
    false,
    stockProgram,
  );
  const [balance, existing] = await Promise.all([
    rpc.getBalance(creator),
    rpc.getAccountInfo(stockAccount),
  ]);
  const simulation = await rpc.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: {encoding: "base64", addresses: [stockAccount.toBase58()]},
  });
  if (simulation.value.err) {
    const {text, broke} = failureReason(simulation.value.logs ?? [], simulation.value.err);
    throw new LaunchRefused(
      broke
        ? `Not enough SOL for this dev buy. The wallet holds ${(balance / 1e9).toFixed(4)} SOL.`
        : `The swap for the dev buy would fail: ${text}`,
    );
  }

  /*
   * Overhead from its parts rather than a balance difference: the signature
   * fee, the priority fee the router set, and the stock account's rent if this
   * swap is what creates it. A balance difference is only right for a wallet
   * nothing else is paying into at the same moment.
   */
  const created = existing ? 0 : (simulation.value.accounts?.[0]?.lamports ?? 0);
  const overhead =
    transaction.message.header.numRequiredSignatures * LAMPORTS_PER_SIGNATURE +
    (built.prioritizationFeeLamports ?? 0) +
    created;

  return {
    transaction: built.transactionBase64,
    solIn: Number(input.lamports) / 1e9,
    stockOut: BigInt(quoted.outAmount),
    stockMinOut: BigInt(quoted.otherAmountThreshold),
    priceImpactPct: Math.abs(quoted.priceImpactPct * 100),
    route: quoted.routeLabels,
    overheadLamports: overhead,
  };
}

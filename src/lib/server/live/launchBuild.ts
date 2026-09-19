/**
 * Building a real StonkFun launch.
 *
 * This replaces a planner that refused to sign, and the reason it could change
 * is specific: every uncertainty the planner named was settled against mainnet
 * before a line of this was written.
 *
 *   - **Anyone may launch under StonkFun's platform.** 17,407 distinct wallets
 *     have, and a real launch is signed by exactly two keys — the creator and
 *     the new mint. StonkFun's site builds the transaction; it does not sign it.
 *   - **StonkFun restricts curve parameters** (`restrictCurveParam = 1`), so a
 *     launch must reference the platform's curve rule — the sixteenth account
 *     every real launch carries — and match one of its groups exactly.
 *   - **Those groups require a Token-2022 coin with a transfer fee of 1% or
 *     3%**, capped at 10^15. That fee is how StonkFun's holder rewards are paid.
 *     Leaving it out fails with `CurveParamNotMatchPlatformRule`; that is the
 *     first thing a mainnet simulation reported.
 *
 * With all three in place, a launch priced in NVDAx simulated cleanly on mainnet
 * against a real wallet, for 0.0091 SOL.
 *
 * Nothing here signs for the user. The server generates the new mint's key,
 * signs with that one key — the mint must co-sign its own creation — and hands
 * back bytes for the creator to sign. The mint key is discarded afterwards: once
 * the pool exists, the launchpad holds the mint authority, so the key controls
 * nothing.
 *
 * Every build is simulated before it is returned, and a failing simulation
 * returns an error rather than a transaction. A button that spends SOL does not
 * get to find out on-chain that the transaction was wrong.
 */

import {
  LaunchpadPool,
  PlatformCurveRule,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformCurveRule,
  initializeWithToken2022,
} from "@raydium-io/raydium-sdk-v2";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";

import {RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import type {StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** Reward launches: StonkFun's main platform, and the one that pays holders. */
const PLATFORM = new PublicKey(
  STONKFUN_PLATFORMS.find((platform) => platform.kind === "rewards")!.platformId,
);
const PROGRAM = new PublicKey(RAYDIUM_LAUNCHPAD);

/** The transfer-fee field of a curve-rule constraint group. */
const FIELD_TRANSFER_FEE_BPS = 11;
/** The maximum-fee field. */
const FIELD_TRANSFER_FEE_MAX = 12;

export interface LaunchTemplate {
  configId: string;
  decimals: number;
  supply: string;
  totalSellA: string;
  totalFundRaisingB: string;
  migrateType: "amm" | "cpmm";
  /** Fee rates the platform's curve rule accepts, in basis points. */
  feeBps: number[];
  /** The maximum transfer fee the rule requires, in base units. */
  feeMax: string;
}

/**
 * StonkFun's launch parameters for coins priced in one stock.
 *
 * Copied from the platform's own launches rather than configured here: each
 * stock has its own global config, sized when that stock was added, and the
 * curve rule only accepts what StonkFun itself uses. Reading them from existing
 * pools means a launch from Trador is indistinguishable from one made on
 * StonkFun, which is the only way it passes the rule.
 *
 * Cached for an hour — a stock's config changes when StonkFun reconfigures it,
 * not per request.
 */
export async function launchTemplate(stock: StockMint): Promise<LaunchTemplate | null> {
  const {value} = await cached(`launch-template:${stock.mint}`, 3_600_000, async () => {
    const connection = new Connection(RPC_URL, "confirmed");

    const accounts = await connection.getProgramAccounts(PROGRAM, {
      filters: [
        {dataSize: 429},
        {memcmp: {offset: 173, bytes: PLATFORM.toBase58()}},
        {memcmp: {offset: 237, bytes: stock.mint}},
      ],
    });
    if (accounts.length === 0) return null;

    // The config most launches in this stock use. There is normally one.
    const decoded = accounts.map((account) => LaunchpadPool.decode(account.account.data));
    const counts = new Map<string, number>();
    for (const pool of decoded) {
      const key = pool.configId.toBase58();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const configId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const onConfig = decoded.filter((pool) => pool.configId.toBase58() === configId);
    const sample = onConfig[0];

    /*
     * The funding target, as StonkFun sizes it today.
     *
     * It is not a constant of the config: StonkFun sets it per launch, and
     * across 1,938 NVDAx launches there are 1,626 distinct values, drifting
     * between roughly 38 and 44 NVDAx over time — a fixed amount converted at
     * whatever the stock was worth that day. Taking an arbitrary pool's value
     * picked an old sizing; taking the median of the most recent epoch's
     * launches picks the current one, and a median is not moved by the odd
     * outlier (one launch in the sample raised 1.49 NVDAx).
     *
     * The curve rule does not constrain this field, so any sensible value is
     * accepted; the point is to match what StonkFun itself launches today.
     */
    const latestEpoch = Math.max(...onConfig.map((pool) => Number(pool.epoch)));
    const recent = onConfig
      .filter((pool) => Number(pool.epoch) === latestEpoch)
      .map((pool) => BigInt(pool.totalFundRaisingB.toString()))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const medianRaise = recent[Math.floor(recent.length / 2)] ?? BigInt(sample.totalFundRaisingB.toString());

    // Which transfer-fee rates the platform's rule will accept for this config.
    const rulePda = getPdaPlatformCurveRule(PROGRAM, PLATFORM, new PublicKey(configId)).publicKey;
    const ruleAccount = await connection.getAccountInfo(rulePda);
    if (!ruleAccount) return null;
    const rule = PlatformCurveRule.decode(ruleAccount.data);

    const feeBps = new Set<number>();
    let feeMax = "0";
    for (const group of rule.groups) {
      for (const constraint of group.constraints) {
        if (Number(constraint.field) === FIELD_TRANSFER_FEE_BPS) {
          feeBps.add(Number(constraint.value.toString()));
        }
        if (Number(constraint.field) === FIELD_TRANSFER_FEE_MAX) {
          feeMax = constraint.value.toString();
        }
      }
    }

    return {
      configId,
      decimals: Number(sample.mintDecimalsA),
      supply: sample.supply.toString(),
      totalSellA: sample.totalSellA.toString(),
      totalFundRaisingB: medianRaise.toString(),
      migrateType: Number(sample.migrateType) === 1 ? "cpmm" : "amm",
      feeBps: [...feeBps].filter((bps) => bps > 0).sort((a, b) => a - b),
      feeMax,
    } satisfies LaunchTemplate;
  });

  return value;
}

export interface BuiltLaunch {
  /** Signed by the new mint; the creator signs it next. */
  transaction: string;
  mint: string;
  pool: string;
  /** SOL the creator's wallet pays, from the simulation. */
  costSol: number | null;
}

export class LaunchRefused extends Error {}

export async function buildStonkfunLaunch(input: {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  stock: StockMint;
  feeBps: number;
}): Promise<BuiltLaunch> {
  const template = await launchTemplate(input.stock);
  if (!template) {
    throw new LaunchRefused(
      `StonkFun has no launch priced in ${input.stock.ticker} to take its settings from yet.`,
    );
  }
  if (!template.feeBps.includes(input.feeBps)) {
    throw new LaunchRefused(
      `StonkFun accepts a ${template.feeBps.map((bps) => `${bps / 100}%`).join(" or ")} holder reward here.`,
    );
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const creator = new PublicKey(input.creator);
  const mintB = new PublicKey(input.stock.mint);
  const configId = new PublicKey(template.configId);
  const mint = Keypair.generate();
  const pool = getPdaLaunchpadPoolId(PROGRAM, mint.publicKey, mintB).publicKey;

  const instruction = initializeWithToken2022(
    PROGRAM,
    creator,
    creator,
    configId,
    PLATFORM,
    getPdaLaunchpadAuth(PROGRAM).publicKey,
    pool,
    mint.publicKey,
    mintB,
    getPdaLaunchpadVaultId(PROGRAM, pool, mint.publicKey).publicKey,
    getPdaLaunchpadVaultId(PROGRAM, pool, mintB).publicKey,
    // The quote stock's own token program. Every verified stock is Token-2022
    // today, but this is read from the registry rather than assumed.
    new PublicKey(input.stock.tokenProgram ?? TOKEN_2022.toBase58()),
    template.decimals,
    input.name,
    input.symbol,
    input.uri,
    {
      type: "ConstantCurve",
      totalSellA: new BN(template.totalSellA),
      migrateType: template.migrateType,
      supply: new BN(template.supply),
      totalFundRaisingB: new BN(template.totalFundRaisingB),
    },
    // No vesting: StonkFun's rule requires zero lock, cliff and unlock.
    new BN(0),
    new BN(0),
    new BN(0),
    0,
    {transferFeeBasePoints: input.feeBps, maxinumFee: new BN(template.feeMax)},
    undefined,
    getPdaPlatformCurveRule(PROGRAM, PLATFORM, configId).publicKey,
  );

  const {blockhash} = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: creator,
      recentBlockhash: blockhash,
      instructions: [
        // 97k units in simulation; headroom for a busier slot.
        ComputeBudgetProgram.setComputeUnitLimit({units: 200_000}),
        ComputeBudgetProgram.setComputeUnitPrice({microLamports: 50_000}),
        instruction,
      ],
    }).compileToV0Message(),
  );
  transaction.sign([mint]);

  /*
   * Simulated before it is returned, against the creator's real balance.
   *
   * A failure here is the chain's own verdict — not enough SOL, a rule that
   * changed — and the creator sees that sentence instead of signing a
   * transaction that would fail and still cost them the fee.
   */
  const before = await connection.getBalance(creator);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    accounts: {encoding: "base64", addresses: [creator.toBase58()]},
  });

  if (simulation.value.err) {
    const logs = simulation.value.logs ?? [];
    const reason =
      logs.find((line) => /insufficient/i.test(line)) ??
      logs.find((line) => /Error Message:/.test(line))?.split("Error Message:")[1] ??
      JSON.stringify(simulation.value.err);
    // `AccountNotFound` is how the runtime says the payer has never held SOL.
    const broke = /insufficient|AccountNotFound|InsufficientFunds/i.test(
      `${reason} ${JSON.stringify(simulation.value.err)}`,
    );
    throw new LaunchRefused(
      broke
        ? "Not enough SOL in this wallet to pay for the launch — it costs about 0.01 SOL."
        : `The launch would fail: ${reason.trim()}`,
    );
  }

  const after = simulation.value.accounts?.[0]?.lamports;

  return {
    transaction: Buffer.from(transaction.serialize()).toString("base64"),
    mint: mint.publicKey.toBase58(),
    pool: pool.toBase58(),
    costSol: typeof after === "number" ? (before - after) / 1e9 : null,
  };
}

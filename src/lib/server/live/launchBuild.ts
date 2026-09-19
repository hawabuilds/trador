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
  LaunchpadConfig,
  LaunchpadPool,
  PlatformConfig,
  PlatformCurveRule,
  buyExactInInstruction,
  getPdaCreatorVault,
  getPdaPlatformVault,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformCurveRule,
  initializeWithToken2022,
} from "@raydium-io/raydium-sdk-v2";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {Connection, Keypair, PublicKey} from "@solana/web3.js";
import BN from "bn.js";

import {RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import type {StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";
import {
  type AssembledLaunch,
  type DevBuyPlan,
  LaunchRefused,
  RPC_URL,
  assembleLaunch,
  connection,
} from "./launchAssemble";

export {LaunchRefused};

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

/**
 * Every stock StonkFun has launched a coin in — the stocks a launch here can
 * be priced in, since the settings are copied from an existing launch.
 *
 * One sweep of StonkFun's pools reading only the 32 bytes of the quote mint,
 * cached for an hour.
 */
export async function stonkfunQuoteMints(): Promise<string[]> {
  const {value} = await cached("stonkfun-quote-mints", 3_600_000, async () => {
    const accounts = await connection().getProgramAccounts(PROGRAM, {
      dataSlice: {offset: 237, length: 32},
      filters: [{dataSize: 429}, {memcmp: {offset: 173, bytes: PLATFORM.toBase58()}}],
    });
    return [...new Set(accounts.map((account) => new PublicKey(account.account.data).toBase58()))];
  });
  return value;
}

export interface StonkfunLaunchInput {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  stock: StockMint;
  feeBps: number;
  /** Stock to spend buying the coin in the same transaction, in base units; 0 for none. */
  devBuyStock: bigint;
}

/** Fee rates are parts per million on LaunchLab. */
const RATE_DENOMINATOR = 1_000_000;

export async function buildStonkfunLaunch(input: StonkfunLaunchInput): Promise<BuiltLaunch> {
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

  const rpc = connection();
  const creator = new PublicKey(input.creator);
  const mintB = new PublicKey(input.stock.mint);
  const configId = new PublicKey(template.configId);
  const quoteProgram = new PublicKey(input.stock.tokenProgram ?? TOKEN_2022.toBase58());
  const mint = Keypair.generate();
  const auth = getPdaLaunchpadAuth(PROGRAM).publicKey;
  const pool = getPdaLaunchpadPoolId(PROGRAM, mint.publicKey, mintB).publicKey;
  const vaultA = getPdaLaunchpadVaultId(PROGRAM, pool, mint.publicKey).publicKey;
  const vaultB = getPdaLaunchpadVaultId(PROGRAM, pool, mintB).publicKey;

  const launch = initializeWithToken2022(
    PROGRAM,
    creator,
    creator,
    configId,
    PLATFORM,
    auth,
    pool,
    mint.publicKey,
    mintB,
    vaultA,
    vaultB,
    // The quote stock's own token program. Every verified stock is Token-2022
    // today, but this is read from the registry rather than assumed.
    quoteProgram,
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

  const creatorCoinAccount = getAssociatedTokenAddressSync(mint.publicKey, creator, false, TOKEN_2022);

  let devBuy: DevBuyPlan | null = null;
  if (input.devBuyStock > 0n) {
    // The trade fee a buy pays: the config's own rate, plus StonkFun's
    // platform share and the creator's share.
    const [configAccount, platformAccount] = await rpc.getMultipleAccountsInfo([configId, PLATFORM]);
    const tradeRate = configAccount ? Number(LaunchpadConfig.decode(configAccount.data).tradeFeeRate) : 0;
    const platform = platformAccount ? PlatformConfig.decode(platformAccount.data) : null;
    const rate =
      tradeRate + Number(platform?.feeRate ?? 0) + Number(platform?.creatorFeeRate ?? 0);

    devBuy = {
      stockIn: input.devBuyStock,
      stock: {mint: input.stock.mint, ticker: input.stock.ticker, decimals: input.stock.decimals},
      creatorCoinAccount,
      coinDecimals: template.decimals,
      coinSupply: BigInt(template.supply),
      tradingFeeBps: Math.round((rate / RATE_DENOMINATOR) * 10_000),
      buy: [
        createAssociatedTokenAccountIdempotentInstruction(
          creator,
          creatorCoinAccount,
          creator,
          mint.publicKey,
          TOKEN_2022,
        ),
        buyExactInInstruction(
          PROGRAM,
          creator,
          auth,
          configId,
          PLATFORM,
          pool,
          creatorCoinAccount,
          getAssociatedTokenAddressSync(mintB, creator, false, quoteProgram),
          vaultA,
          vaultB,
          mint.publicKey,
          mintB,
          TOKEN_2022,
          quoteProgram,
          getPdaPlatformVault(PROGRAM, PLATFORM, mintB).publicKey,
          getPdaCreatorVault(PROGRAM, creator, mintB).publicKey,
          new BN(input.devBuyStock.toString()),
          // Any amount of coin: it is the first buy on a curve created one
          // instruction earlier, so nothing can move the price in between.
          new BN(1),
        ),
      ],
    };
  }

  const assembled = await assembleLaunch({
    creator,
    launch: [launch],
    signers: [mint],
    devBuy,
    launchpadLabel: "StonkFun",
    // Raydium's own table: token programs, sysvars, metadata and its programs.
    lookupTables: ["AcL1Vo8oy1ULiavEcjSUcwfBSForXMudcZvDZy5nzJkU"],
  });

  return {...assembled, mint: mint.publicKey.toBase58(), pool: pool.toBase58()};
}

export interface BuiltLaunch extends AssembledLaunch {
  mint: string;
  pool: string;
}

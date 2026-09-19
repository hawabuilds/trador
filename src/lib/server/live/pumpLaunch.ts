/**
 * Building a real pump.fun launch priced in a stock.
 *
 * pump.fun's bonding curve took a quote mint in its `create_v2` upgrade, and
 * the shape was settled by reading a real launch rather than the docs: a coin
 * priced in NVDAx (`AGI`, slot 446,806,946) is `create_v2` with four trailing
 * accounts — the quote mint, the curve's vault for it, the quote token program
 * and the `quote-control` PDA — followed by `buy_exact_quote_in_v2`, which
 * spends the stock itself. The IDL bundled with `@nirholas/pump-sdk@2.0.0`
 * documents exactly that, and this builds it the same way.
 *
 * **Which stocks pump.fun accepts is read from the chain, never assumed.** A
 * mint is admitted either by `Global.whitelisted_quote_mints` or by an entry in
 * the `quote-control` account; anything else is rejected on-chain, so it is
 * refused here first with the list of what is accepted.
 *
 * **Creator fees can go to holders.** With `is_holder_reward` the coin's
 * creator becomes the mint's `holder-rewards` PDA, so creator fees accrue for
 * holders rather than the wallet that launched it — pump.fun's counterpart to
 * StonkFun's reward launches, and off unless the creator chooses it.
 */

import {BorshAccountsCoder} from "@coral-xyz/anchor";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  PumpIdl,
  bondingCurvePda,
  creatorVaultPda,
  getFeeRecipient,
  getPumpProgram,
  holderRewardsPda,
} from "@nirholas/pump-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {Keypair, PublicKey} from "@solana/web3.js";
import BN from "bn.js";

import {PUMP_PROGRAM} from "@/lib/programs";
import type {StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";
import {
  type AssembledLaunch,
  type DevBuyPlan,
  LaunchRefused,
  assembleLaunch,
  connection,
} from "./launchAssemble";

const PROGRAM = new PublicKey(PUMP_PROGRAM);
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const QUOTE_CONTROL = PublicKey.findProgramAddressSync([Buffer.from("quote-control")], PROGRAM)[0];

/** Every pump.fun coin: six decimals, one billion supply. */
const COIN_DECIMALS = 6;
const COIN_SUPPLY = 1_000_000_000n * 10n ** BigInt(COIN_DECIMALS);

export interface PumpQuoteRules {
  /** Mints `Global` whitelists outright. */
  whitelisted: string[];
  /** Mints admitted through `quote-control`. */
  controlled: string[];
  /** Whether the creator may pick their own fee rate on a controlled mint. */
  creatorFeeConfigurable: boolean;
  maxCreatorFeeBps: number;
  holderRewardEnabled: boolean;
  createV2Enabled: boolean;
}

/**
 * What pump.fun accepts today, cached for ten minutes — the list changes when
 * pump.fun admits a stock, not per request.
 */
export async function pumpQuoteRules(): Promise<PumpQuoteRules> {
  const {value} = await cached("pump-quote-rules", 600_000, async () => {
    const rpc = connection();
    const global = await new OnlinePumpSdk(rpc).fetchGlobal();
    const control = await rpc.getAccountInfo(QUOTE_CONTROL);
    const coder = new BorshAccountsCoder(PumpIdl as never);
    const decoded = control
      ? (coder.decode("QuoteControl", control.data) as {mints: {mint: PublicKey}[]})
      : {mints: []};

    const zero = PublicKey.default.toBase58();
    return {
      whitelisted: global.whitelistedQuoteMints
        .map((mint) => mint.toBase58())
        .filter((mint) => mint !== zero),
      controlled: decoded.mints.map((entry) => entry.mint.toBase58()).filter((mint) => mint !== zero),
      creatorFeeConfigurable: Boolean(global.creatorFeeConfigurable),
      maxCreatorFeeBps: Number(global.maxConfigurableCreatorFeeBps ?? 0),
      holderRewardEnabled: Boolean(global.isHolderRewardEnabled),
      createV2Enabled: Boolean(global.createV2Enabled),
    } satisfies PumpQuoteRules;
  });
  return value;
}

export function pumpAccepts(rules: PumpQuoteRules, mint: string): boolean {
  return rules.whitelisted.includes(mint) || rules.controlled.includes(mint);
}

export interface PumpLaunchInput {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  stock: StockMint;
  /** Route creator fees to holders instead of the creator. */
  holderReward: boolean;
  /** The creator's fee rate, when pump.fun lets the creator choose one. */
  creatorFeeBps: number;
  /** Stock to spend buying the coin in the same transaction, in base units; 0 for none. */
  devBuyStock: bigint;
}

export interface BuiltPumpLaunch extends AssembledLaunch {
  mint: string;
  pool: string;
}

export async function buildPumpLaunch(input: PumpLaunchInput): Promise<BuiltPumpLaunch> {
  const rules = await pumpQuoteRules();
  if (!rules.createV2Enabled) throw new LaunchRefused("pump.fun has launches paused right now.");
  if (!pumpAccepts(rules, input.stock.mint)) {
    throw new LaunchRefused(`pump.fun doesn't accept ${input.stock.ticker} as a pair yet.`);
  }
  if (input.holderReward && !rules.holderRewardEnabled) {
    throw new LaunchRefused("pump.fun has holder rewards switched off right now.");
  }

  const controlled = !rules.whitelisted.includes(input.stock.mint);
  // pump.fun ignores the rate on a whitelisted mint, and requires one inside
  // its bounds on a controlled one when configurable.
  const creatorFeeBps =
    controlled && rules.creatorFeeConfigurable
      ? Math.min(Math.max(1, Math.round(input.creatorFeeBps)), rules.maxCreatorFeeBps)
      : 0;

  const rpc = connection();
  const creator = new PublicKey(input.creator);
  const quoteMint = new PublicKey(input.stock.mint);
  const quoteProgram = new PublicKey(input.stock.tokenProgram ?? TOKEN_2022.toBase58());
  const mint = Keypair.generate();
  const curve = bondingCurvePda(mint.publicKey);
  const curveQuoteVault = getAssociatedTokenAddressSync(quoteMint, curve, true, quoteProgram);

  const create = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    creator,
    user: creator,
    mayhemMode: false,
    creatorFeeBps: new BN(creatorFeeBps),
    holderReward: input.holderReward,
  });
  // The quote-mint selection, as trailing accounts — see the note at the top.
  create.keys.push(
    {pubkey: quoteMint, isSigner: false, isWritable: false},
    {pubkey: curveQuoteVault, isSigner: false, isWritable: true},
    {pubkey: quoteProgram, isSigner: false, isWritable: false},
  );
  if (controlled) create.keys.push({pubkey: QUOTE_CONTROL, isSigner: false, isWritable: false});

  const creatorCoinAccount = getAssociatedTokenAddressSync(mint.publicKey, creator, false, TOKEN_2022);

  let devBuy: DevBuyPlan | null = null;
  if (input.devBuyStock > 0n) {
    const global = await new OnlinePumpSdk(rpc).fetchGlobal();
    const program = getPumpProgram(rpc);
    const launchCreator = input.holderReward ? holderRewardsPda(mint.publicKey) : creator;
    const buyback = global.buybackFeeRecipients.filter((key) => !key.equals(PublicKey.default));

    devBuy = {
      stockIn: input.devBuyStock,
      stock: {mint: input.stock.mint, ticker: input.stock.ticker, decimals: input.stock.decimals},
      creatorCoinAccount,
      coinDecimals: COIN_DECIMALS,
      coinSupply: COIN_SUPPLY,
      // Read exactly from the simulation: what reaches the curve's vault is
      // the stock net of every fee.
      curveQuoteVault,
      tradingFeeBps: null,
      buy: [
        createAssociatedTokenAccountIdempotentInstruction(
          creator,
          creatorCoinAccount,
          creator,
          mint.publicKey,
          TOKEN_2022,
        ),
        await program.methods
          .buyExactQuoteInV2(new BN(input.devBuyStock.toString()), new BN(1))
          .accountsPartial({
            global: PublicKey.findProgramAddressSync([Buffer.from("global")], PROGRAM)[0],
            baseMint: mint.publicKey,
            quoteMint,
            baseTokenProgram: TOKEN_2022,
            quoteTokenProgram: quoteProgram,
            feeRecipient: getFeeRecipient(global, false),
            buybackFeeRecipient: buyback[Math.floor(Math.random() * buyback.length)] ?? global.feeRecipient,
            bondingCurve: curve,
            user: creator,
            associatedBaseUser: creatorCoinAccount,
            associatedQuoteUser: getAssociatedTokenAddressSync(quoteMint, creator, false, quoteProgram),
            creatorVault: creatorVaultPda(launchCreator),
          })
          .instruction(),
      ],
    };
  }

  const assembled = await assembleLaunch({
    creator,
    launch: [create],
    signers: [mint],
    devBuy,
    launchpadLabel: "pump.fun",
    // pump.fun's own table: its program, global, fee recipients and vaults.
    lookupTables: ["Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP"],
  });

  return {...assembled, mint: mint.publicKey.toBase58(), pool: curve.toBase58()};
}

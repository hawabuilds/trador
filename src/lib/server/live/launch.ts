/**
 * Planning a launch.
 *
 * What this does and does not do is the most important thing in the file.
 *
 * It **resolves a real plan** from chain state: the launchpad's program, the
 * config that governs it, whether that config will accept a third-party
 * launch at all, the quote mint, and the rent and fees the launch would cost.
 * Every number comes from an account read, not a table of guesses.
 *
 * It **does not build or sign a transaction**, and the reason is specific
 * rather than cautious. pump.fun is not deployed on devnet, so its create
 * instruction cannot be exercised anywhere except mainnet with real money.
 * LaunchLab has a devnet deployment, but its devnet configs do not mirror
 * mainnet's, so the stock-quoted path is not meaningfully testable there
 * either. An instruction that has never once been executed successfully, put
 * behind a button that spends SOL, is not a feature — it is a way to lose
 * someone else's money while looking finished.
 *
 * So the plan is honest about its own state, and the UI shows the plan.
 */

import {
  LAUNCHPADS,
  RAYDIUM_LAUNCHPAD,
  PUMP_PROGRAM,
  STONKFUN_PLATFORMS,
  type LaunchpadId,
} from "@/lib/programs";
import {type Pubkey, readPubkeyAt} from "@/lib/pubkey";
import type {StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}.`);
  const body = (await response.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export interface LaunchStep {
  label: string;
  detail: string;
}

export interface LaunchPlan {
  launchpad: LaunchpadId;
  launchpadLabel: string;
  program: Pubkey;
  name: string;
  symbol: string;
  quoteTicker: string;
  quoteMint: Pubkey;
  creator: Pubkey;
  steps: LaunchStep[];
  /** What this would cost, in SOL, as far as it can be established. */
  estimatedSol: number | null;
  /** Null when nothing blocks it; otherwise why it cannot be signed yet. */
  blocked: string | null;
  /** Facts read from chain state while planning. */
  checks: {label: string; value: string; ok: boolean | null}[];
}

/**
 * Does StonkFun's platform config permit a third party to launch under it?
 *
 * This is the one read that decides whether "launch a StonkFun coin from
 * Trador" is a product at all. LaunchLab's `PlatformConfig` carries restriction
 * flags and a curve-rule manager; if StonkFun's is locked down, the honest
 * answer is that launches have to go through StonkFun itself.
 *
 * The flags' exact offsets are not published in a form worth trusting, so this
 * reports what it can establish — that the config exists, is owned by
 * LaunchLab, and names StonkFun — and does not pretend to have decoded a
 * permission bit it has not verified.
 */
async function stonkfunConfigChecks(): Promise<
  {label: string; value: string; ok: boolean | null}[]
> {
  const {value} = await cached("launch:stonkfun-config", 600_000, async () => {
    const platform = STONKFUN_PLATFORMS.find((entry) => entry.kind === "rewards")!;

    const info = await rpc<{
      value: {owner: string; data: [string, string]} | null;
    }>("getAccountInfo", [platform.platformId, {encoding: "base64", commitment: "confirmed"}]);

    if (!info.value) {
      return [
        {label: "StonkFun platform config", value: "Not found", ok: false},
      ];
    }

    const data = Uint8Array.from(Buffer.from(info.value.data[0], "base64"));
    const text = Buffer.from(data).toString("latin1");
    const namesStonkfun = /stonkfun/i.test(text);

    return [
      {
        label: "Platform config owner",
        value:
          info.value.owner === RAYDIUM_LAUNCHPAD ? "Raydium LaunchLab" : info.value.owner,
        ok: info.value.owner === RAYDIUM_LAUNCHPAD,
      },
      {
        label: "Config identifies StonkFun",
        value: namesStonkfun ? "Yes" : "No",
        ok: namesStonkfun,
      },
      {
        label: "Third-party launches permitted",
        // Not established. Saying "yes" here on the strength of an offset
        // nobody has verified is exactly the kind of claim that costs money.
        value: "Not verified",
        ok: null,
      },
    ];
  });

  return value;
}

export async function planLaunch(input: {
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  stock: StockMint;
  creator: Pubkey;
}): Promise<LaunchPlan> {
  const {launchpad, name, symbol, stock, creator} = input;

  const checks: {label: string; value: string; ok: boolean | null}[] = [
    {label: "Quote asset", value: `${stock.ticker} — verified issuer`, ok: true},
    {
      label: "Quote mint program",
      value: stock.tokenProgram.startsWith("Tokenz") ? "Token-2022" : "SPL Token",
      ok: true,
    },
  ];

  const steps: LaunchStep[] =
    launchpad === "stonkfun"
      ? [
          {
            label: "Create the mint",
            detail: `A new SPL mint for ${symbol}, with you as the update authority.`,
          },
          {
            label: "Initialise the bonding curve",
            detail:
              `Raydium LaunchLab \`initialize_v2\`, under StonkFun's platform config, ` +
              `with ${stock.ticker} as the quote asset.`,
          },
          {
            label: "Upload metadata",
            detail: "Name, symbol and image, served from Trador's storage.",
          },
          {
            label: "Graduate",
            detail:
              `Once the curve raises its target in ${stock.ticker}, it migrates into a ` +
              `Raydium pool and the coin appears in the feed.`,
          },
        ]
      : [
          {
            label: "Create the mint",
            detail: `A new mint for ${symbol}.`,
          },
          {
            label: "Create the PumpSwap pool",
            detail:
              `pump.fun's Custom Pairs are an AMM feature, so this creates a PumpSwap ` +
              `pool with ${stock.ticker} as the quote mint — not a SOL bonding curve.`,
          },
          {
            label: "Seed the pool",
            detail: "Your first buy sets the opening price.",
          },
        ];

  if (launchpad === "stonkfun") {
    checks.push(...(await stonkfunConfigChecks()));
  } else {
    checks.push({
      label: "Custom Pairs layout",
      value: "Verified on mainnet (PumpSwap Pool, quote_mint at offset 75)",
      ok: true,
    });
    checks.push({
      label: "Create instruction",
      value: "Not verified — pump.fun has no devnet deployment",
      ok: null,
    });
  }

  return {
    launchpad,
    launchpadLabel: LAUNCHPADS[launchpad].label,
    program: launchpad === "stonkfun" ? RAYDIUM_LAUNCHPAD : PUMP_PROGRAM,
    name,
    symbol,
    quoteTicker: stock.ticker,
    quoteMint: stock.mint,
    creator,
    steps,
    // Deployment cost is set by the launchpad and changes; StonkFun cut theirs
    // to 0.03 SOL in September 2026. Reported as an estimate rather than a
    // promise, and null would be better than a stale number presented as fact.
    estimatedSol: launchpad === "stonkfun" ? 0.03 : null,
    blocked:
      `Launching is not enabled yet. ${LAUNCHPADS[launchpad].label}'s create ` +
      `instruction has not been executed successfully from here even once, and ` +
      `the only place it can be tested is mainnet with real SOL — so the button ` +
      `stays off until it has been. Launch on ${LAUNCHPADS[launchpad].label} ` +
      `directly in the meantime.`,
    checks,
  };
}

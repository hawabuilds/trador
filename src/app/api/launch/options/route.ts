import {json} from "@/lib/server/http";
import {stonkfunQuoteMints} from "@/lib/server/live/launchBuild";
import {pumpAccepts, pumpQuoteRules} from "@/lib/server/live/pumpLaunch";
import {stocksByPopularity} from "@/lib/stocks/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Which stocks each launchpad will price a coin in, and the choices each one
 * offers — read from the chain, so the form never offers a pair the launchpad
 * would reject.
 */
export async function GET() {
  const [stonkfun, pump] = await Promise.allSettled([stonkfunQuoteMints(), pumpQuoteRules()]);
  const stocks = stocksByPopularity();

  return json(
    {
      stonkfun: {
        available: stonkfun.status === "fulfilled",
        tickers:
          stonkfun.status === "fulfilled"
            ? stocks.filter((stock) => stonkfun.value.includes(stock.mint)).map((stock) => stock.ticker)
            : [],
        // StonkFun's curve rule accepts exactly these holder-reward rates.
        holderRewardBps: [100, 300],
      },
      pumpfun: {
        available: pump.status === "fulfilled" && pump.value.createV2Enabled,
        tickers:
          pump.status === "fulfilled"
            ? stocks.filter((stock) => pumpAccepts(pump.value, stock.mint)).map((stock) => stock.ticker)
            : [],
        creatorFeeConfigurable: pump.status === "fulfilled" && pump.value.creatorFeeConfigurable,
        maxCreatorFeeBps: pump.status === "fulfilled" ? pump.value.maxCreatorFeeBps : 0,
        holderRewardEnabled: pump.status === "fulfilled" && pump.value.holderRewardEnabled,
      },
    },
  );
}

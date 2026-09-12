/**
 * A placeholder that says what is actually missing.
 *
 * "Coming soon" with no detail is worse than a 404, because it tells the person
 * looking at it nothing about whether the thing they want exists. Each of these
 * names the screen and what it will do, so the app reads as unfinished rather
 * than broken — and so the next person to open the repo knows what belongs here.
 */

const PLANNED: Record<string, {title: string; body: string}> = {
  search: {
    title: "Search",
    body:
      "Stonks, stocks and people. Pasting a mint runs the universe test against " +
      "the chain and adds the coin if it qualifies.",
  },
  news: {
    title: "News",
    body:
      "Coverage for the companies behind the stocks people are trading against — " +
      "so a move in NVDAx has a reason next to it.",
  },
  learn: {
    title: "Learn",
    body:
      "Three short lessons: what a tokenized stock is, why pricing a coin in one " +
      "changes what you own, and how to make your first trade. Finishing them " +
      "unlocks Create.",
  },
  stonkfolio: {
    title: "Stonkfolio",
    body:
      "Your holdings across every connected wallet, split into stocks and stonks, " +
      "with the stock rewards your coins have paid out.",
  },
  create: {
    title: "Create",
    body:
      "Launch a coin priced in a tokenized stock, on StonkFun or pump.fun. Every " +
      "transaction is simulated before you are asked to sign it.",
  },
};

export function ComingSoon({route}: {route: string}) {
  const planned = PLANNED[route] ?? {
    title: route,
    body: "This screen is not built yet.",
  };

  return (
    <main className="flex h-full flex-col items-center justify-center px-8 text-center">
      <span className="rounded-pill border border-border px-2.5 py-[4px] text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
        Not built yet
      </span>
      <h1 className="mt-4 text-[22px] font-extrabold tracking-[-0.03em] text-ink">
        {planned.title}
      </h1>
      <p className="mt-2.5 max-w-[290px] text-[13px] leading-[1.6] text-muted">
        {planned.body}
      </p>
    </main>
  );
}

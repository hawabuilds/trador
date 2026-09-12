/**
 * The three lessons.
 *
 * Pure data and pure functions — no React, no database — so the client, the
 * server and the tests all read one copy of the content.
 *
 * Progress is a **count**, not a set of ids. The lessons are ordered, so a
 * single integer can never drift out of sync with the content the way a stored
 * list of ids does when a lesson is renamed or reordered. `completedLessonIds`
 * reconstitutes the ids from the count on both sides.
 *
 * No wallet vocabulary appears anywhere in the copy. Someone reading lesson one
 * has not agreed to learn what a mint is, and the fastest way to lose them is
 * to explain one.
 */

export interface QuickCheck {
  question: string;
  options: string[];
  /** Index into `options`. Graded on the server. */
  answer: number;
  /** Shown after a correct answer, to make the point stick. */
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  body: string[];
  quickCheck: QuickCheck;
}

export type PublicLesson = Omit<Lesson, "quickCheck"> & {
  quickCheck: Omit<QuickCheck, "answer" | "explanation">;
};

export const LESSONS: Lesson[] = [
  {
    id: "what-is-a-tokenized-stock",
    title: "What is a tokenized stock?",
    minutes: 2,
    summary: "A real share, held in custody, represented on-chain.",
    body: [
      "A tokenized stock is a share in a real company — Nvidia, Apple, McDonald's — represented by a token you can hold yourself.",
      "The token is not the company. It is a claim, and behind it a custodian actually holds the share. That backing is the whole thing: it is what separates a tokenized stock from a token that merely follows a price.",
      "Because the claim lives on a public network, it does not keep market hours. The underlying exchange closes at four in the afternoon; the token keeps trading through the night and the weekend, at whatever price people will pay.",
      "That is also the catch worth knowing early. Out of hours there is no exchange to check the price against, so the number you see is what this market thinks the share is worth, not what the exchange last said it was.",
      "Trador calls these Stocks. There are currently twenty-nine of them here, and every one had its issuer verified before it was allowed in.",
    ],
    quickCheck: {
      question: "What makes a tokenized stock different from a token that just tracks a price?",
      options: [
        "It trades on a decentralised exchange",
        "A custodian holds the real share behind it",
        "Its price moves when the stock market moves",
      ],
      answer: 1,
      explanation:
        "Backing is the point. Without a custodian holding the real share, a token can follow a price without ever being a claim on anything.",
    },
  },
  {
    id: "why-the-pairing-matters",
    title: "Why the pairing matters",
    minutes: 2,
    summary: "What a coin is priced in changes what you own.",
    body: [
      "Most coins are priced in SOL. Buy one and you are making two bets at once — on the coin, and on SOL — because when SOL falls, your coin is worth less in dollars even if nothing about the coin changed.",
      "A coin priced in a tokenized stock is priced in that stock instead. A coin quoted in NVDAx rises and falls against Nvidia. The stock is the yardstick.",
      "That is the whole idea behind this app, and it is new: until September 2026 no launchpad let you choose the yardstick. Two of them now do.",
      "Some launches go further. A reward launch routes a share of every single trade back to the people holding the coin, paid in the stock — so holding it pays you in Nvidia rather than in more of the coin. Trador marks those.",
      "Trador calls these coins Stonks, and keeps the word separate from Stocks on purpose. One of the two has a custodian behind it. The other does not.",
    ],
    quickCheck: {
      question: "A coin is priced in NVDAx. NVDAx falls 10% and the coin's price in NVDAx does not move. What happened to your position in dollars?",
      options: [
        "It is worth about 10% less",
        "It is unchanged, because the coin held its price",
        "It is worth about 10% more",
      ],
      answer: 0,
      explanation:
        "Holding its price against the yardstick is not the same as holding its value. The yardstick moved, so the position moved with it — which is exactly what choosing a yardstick means.",
    },
  },
  {
    id: "your-first-trade",
    title: "Your first trade",
    minutes: 1,
    summary: "One signature, and what it costs.",
    body: [
      "Open any coin from the feed and press Buy. Pick an amount, and the ticket shows you the route, the price impact and the fee before you agree to anything.",
      "Price impact is the number to actually read. On a thin pool a small order moves the price against you, and the ticket will refuse an order that would move it more than half. That refusal is a feature.",
      "Then you sign once. There is no approval step and no second confirmation — that is an Ethereum habit this chain does not have.",
      "Trador takes 50 basis points, which is half of one percent, and nothing else. No spread, no withdrawal fee, no premium tier.",
      "Anything you buy shows up in your Stonkfolio, split into the stocks you hold and the coins priced against them, with whatever rewards your coins have paid out.",
    ],
    quickCheck: {
      question: "How many signatures does a trade here take?",
      options: ["Two — approve, then swap", "One", "Three on a first trade"],
      answer: 1,
      explanation:
        "One. Solana has no allowance model, so there is nothing to approve first — the two-step dance other chains require simply does not exist here.",
    },
  },
];

export const LESSON_COUNT = LESSONS.length;

export function publicLessons(): PublicLesson[] {
  return LESSONS.map(({quickCheck, ...lesson}) => ({
    ...lesson,
    quickCheck: {question: quickCheck.question, options: quickCheck.options},
  }));
}

export function lessonIndex(id: string): number {
  return LESSONS.findIndex((lesson) => lesson.id === id);
}

/** Ids implied by a completed count. The count is the source of truth. */
export function completedLessonIds(tasksDone: number): string[] {
  return LESSONS.slice(0, Math.min(Math.max(tasksDone, 0), LESSON_COUNT)).map(
    (lesson) => lesson.id,
  );
}

/**
 * Progress only ever moves forward.
 *
 * Local and remote are merged by taking the larger, so finishing a lesson
 * offline and then signing in cannot roll it back — and neither can a stale
 * response arriving after a fresh answer.
 */
export function mergeTasksDone(serverDone: number, localDone: number): number {
  return Math.min(Math.max(serverDone, localDone), LESSON_COUNT);
}

export function gradeLesson(
  lessonId: string,
  choice: number,
): {correct: boolean; explanation?: string; message?: string} {
  const lesson = LESSONS.find((entry) => entry.id === lessonId);
  if (!lesson) return {correct: false, message: "That lesson does not exist."};

  return lesson.quickCheck.answer === choice
    ? {correct: true, explanation: lesson.quickCheck.explanation}
    : {correct: false, message: "Not quite — have another read and try again."};
}

"use client";

import {useState} from "react";
import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {LessonSheet} from "@/components/LessonSheet";
import {Button} from "@/components/ui/Button";
import {CheckIcon, ClockIcon, LockIcon, RocketIcon} from "@/components/ui/Icons";
import {useLearn} from "@/hooks/useLearn";
import {cn} from "@/lib/cn";
import {LESSON_COUNT} from "@/lib/learn";

/**
 * The Learn tab.
 *
 * Three lessons, about five minutes, and finishing them unlocks Create.
 *
 * That gate is the reward, deliberately. Its ancestor paid $10 of real stock
 * for the same three lessons and needed five anti-farm gates to survive it —
 * account age, a counted submission, a seat budget, share verification. Gating
 * the launch button needs none of that and is a better fit besides: nobody
 * should launch a coin priced in a stock without knowing what the pairing does
 * to the person who buys it.
 */
export function LearnScreen() {
  const learn = useLearn();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const lesson = activeIndex === null ? null : (learn.lessons[activeIndex] ?? null);
  const hasNext = activeIndex !== null && activeIndex + 1 < learn.lessons.length;

  return (
    <div>
      <StickyPageHeader>
        <h1 className="text-[22px] font-extrabold tracking-[-0.035em]">Learn</h1>
        <p className="mb-4 mt-0.5 text-[12.5px] font-medium text-faint">
          Three lessons, about five minutes
        </p>
      </StickyPageHeader>

      <div
        className={cn(
          "mt-1 overflow-hidden rounded-2xl p-4 shadow-card",
          learn.allDone ? "bg-price-up-wash" : "bg-surface-card",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-full",
              learn.allDone
                ? "bg-price-up text-[var(--bg-base)]"
                : "bg-[var(--overlay-wash)] text-faint",
            )}
          >
            {learn.allDone ? (
              <CheckIcon className="h-5 w-5" />
            ) : (
              <RocketIcon className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-extrabold tracking-[-0.02em]">
              {learn.allDone ? "Create is unlocked" : "Finish all three to unlock Create"}
            </p>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-muted">
              {learn.allDone
                ? "You can launch a coin priced in a tokenized stock, on pump.fun or StonkFun."
                : "Launching a coin priced in a stock is worth understanding first. It takes five minutes."}
            </p>
            {learn.allDone ? (
              <Link
                href="/create"
                className="mt-3 inline-flex h-9 items-center rounded-full bg-brand-500 px-4 text-[13px] font-extrabold text-white shadow-brand"
              >
                Open Create
              </Link>
            ) : null}
          </div>
          <span className="tabular-nums shrink-0 text-[13px] font-extrabold text-faint">
            {learn.done}/{LESSON_COUNT}
          </span>
        </div>
      </div>

      <ul className="mt-4 overflow-hidden rounded-2xl bg-surface-card shadow-card">
        {learn.lessons.map((entry, index) => {
          const complete = index < learn.done;
          // Sequential: the next lesson is available, later ones are not. The
          // lessons build on each other, and lesson three assumes lesson two.
          const locked = learn.hydrated && index > learn.done;

          return (
            <li key={entry.id}>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  learn.resetAnswer();
                  setActiveIndex(index);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                  "even:bg-[var(--overlay-wash)]/40",
                  locked ? "cursor-not-allowed opacity-55" : "hover:bg-[var(--overlay-wash)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[9px] text-[12px] font-extrabold",
                    complete
                      ? "bg-price-up text-[var(--bg-base)]"
                      : "bg-[var(--overlay-wash)] text-muted",
                  )}
                >
                  {complete ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold tracking-[-0.015em]">
                    {entry.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] font-medium text-faint">
                    {entry.summary} · {entry.minutes} min
                  </span>
                </span>

                <span className="shrink-0 text-faint">
                  {locked ? (
                    <LockIcon className="h-[15px] w-[15px]" />
                  ) : complete ? (
                    <span className="text-[12px] font-bold text-price-up">Done</span>
                  ) : (
                    <ClockIcon className="h-[15px] w-[15px]" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!learn.hydrated ? null : learn.done === 0 ? (
        <Button
          variant="green"
          fullWidth
          className="mt-4"
          onClick={() => {
            learn.resetAnswer();
            setActiveIndex(0);
          }}
        >
          Start
        </Button>
      ) : null}

      <LessonSheet
        lesson={lesson}
        open={lesson !== null}
        onClose={() => setActiveIndex(null)}
        checking={learn.checking}
        result={learn.result}
        error={learn.error}
        onReset={learn.resetAnswer}
        onAnswer={(choice) => {
          if (lesson && activeIndex !== null) {
            void learn.answer(lesson.id, choice, activeIndex);
          }
        }}
        onNext={
          hasNext
            ? () => {
                learn.resetAnswer();
                setActiveIndex((current) => (current === null ? null : current + 1));
              }
            : undefined
        }
      />
    </div>
  );
}

"use client";

import {useEffect, useState} from "react";
import {cn} from "@/lib/cn";
import type {PublicLesson} from "@/lib/learn";
import {Button} from "./ui/Button";
import {CheckIcon} from "./ui/Icons";
import {Sheet, SheetFooter, SheetTitle} from "./ui/Sheet";

interface LessonSheetProps {
  lesson: PublicLesson | null;
  open: boolean;
  onClose: () => void;
  onAnswer: (choice: number) => void;
  checking: boolean;
  /** null while unanswered, then the graded outcome. */
  result: {correct: boolean; explanation?: string; message?: string} | null;
  /**
   * Set when the check could not be graded at all — signed out, offline, the
   * backend down. Without it a failed request is indistinguishable from a dead
   * button, because an ungraded answer renders nothing.
   */
  error?: string | null;
  onReset: () => void;
  /**
   * Opens the lesson after this one. Set only when there is one, which is what
   * turns the list into a guide: a player who passes is carried forward rather
   * than dropped back to choose again.
   */
  onNext?: () => void;
}

export function LessonSheet({
  lesson,
  open,
  onClose,
  onAnswer,
  checking,
  result,
  error = null,
  onReset,
  onNext,
}: LessonSheetProps) {
  const [choice, setChoice] = useState<number | null>(null);

  // A fresh lesson starts unanswered, otherwise the previous lesson's grade
  // bleeds into this one.
  useEffect(() => {
    setChoice(null);
    onReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id]);

  if (!lesson) return null;

  const graded = result !== null;
  const passed = result?.correct === true;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="90%"
      label={lesson.title}
      header={<SheetTitle title={lesson.title} onClose={onClose} />}
      footer={
        <SheetFooter columns={1}>
          {passed ? (
            <Button variant="primary" onClick={onNext ?? onClose}>
              {onNext ? "Next lesson" : "Done"}
            </Button>
          ) : (
            <Button
              variant="dark"
              disabled={choice === null || checking}
              onClick={() => choice !== null && onAnswer(choice)}
            >
              {checking ? "Checking…" : "Check answer"}
            </Button>
          )}
        </SheetFooter>
      }
    >
      <div className="flex flex-col gap-3 pt-1">
        {lesson.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="text-[14px] leading-[1.62] text-muted">
            {paragraph}
          </p>
        ))}
      </div>

      <div
        className={cn(
          "mt-6 rounded-[16px] border p-4 transition-[border-color,background-color,box-shadow]",
          passed
            ? "border-price-up bg-price-up-wash shadow-[0_0_0_10px_var(--price-up-wash)]"
            : "border-hairline bg-wash",
        )}
      >
        <div className="mb-1 text-[11px] font-bold tracking-[0.09em] text-faint">
          QUICK CHECK
        </div>
        <p className="mb-3.5 text-[14.5px] font-bold tracking-[-0.01em]">
          {lesson.quickCheck.question}
        </p>

        <div className="flex flex-col gap-2">
          {lesson.quickCheck.options.map((option, index) => {
            const selected = choice === index;
            const isRight = passed && selected;

            return (
              <button
                key={option}
                type="button"
                disabled={passed || checking}
                onClick={() => {
                  setChoice(index);
                  if (graded) onReset();
                }}
                aria-pressed={selected}
                className={cn(
                  "flex items-center gap-3 rounded-[13px] border bg-card px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow]",
                  isRight
                    ? "border-price-up bg-price-up-wash-hover shadow-[0_0_0_8px_var(--price-up-wash)]"
                    : selected
                      ? "border-ink"
                      : "border-hairline hover:bg-wash",
                  passed && !selected && "opacity-50",
                )}
              >
                <span className="flex-1 text-[13.5px] font-medium leading-[1.4]">
                  {option}
                </span>
                {isRight ? (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-price-up text-[var(--bg-base)] shadow-[0_0_0_6px_var(--price-up-wash-hover)]">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {passed && result?.explanation ? (
          <p className="mt-3 text-[12.5px] font-medium leading-[1.5] text-price-up">
            {result.explanation}
          </p>
        ) : graded && !passed ? (
          <p className="mt-3 text-[12.5px] font-medium leading-[1.5] text-red">
            {result?.message}
          </p>
        ) : error ? (
          <p
            role="alert"
            className="mt-3 text-[12.5px] font-medium leading-[1.5] text-red"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

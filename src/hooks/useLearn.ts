"use client";

import {useCallback, useEffect, useState} from "react";

import {
  LESSON_COUNT,
  completedLessonIds,
  gradeLesson,
  mergeTasksDone,
  publicLessons,
  type PublicLesson,
} from "@/lib/learn";
import {readLearnDone, writeLearnDone} from "@/lib/localStore";

export type GradeResult = {correct: boolean; explanation?: string; message?: string};

/**
 * Learn progress and grading.
 *
 * Grading goes to the server so the answer key has one home, but it falls back
 * to grading locally when the request fails. Being offline should not stop
 * someone reading three short lessons — and the outcome is identical either
 * way, because both sides call the same pure function.
 */
export function useLearn() {
  const [lessons, setLessons] = useState<PublicLesson[]>(() => publicLessons());
  const [done, setDone] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read stored progress after mount. Reading during render would make the
  // server and client markup disagree on which lessons are unlocked.
  useEffect(() => {
    setDone(readLearnDone(LESSON_COUNT));
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/learn");
        if (!response.ok) return;
        const body = (await response.json()) as {lessons?: PublicLesson[]};
        if (!cancelled && body.lessons?.length) setLessons(body.lessons);
      } catch {
        // The bundled copy is already rendering; a failed fetch changes nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const answer = useCallback(
    async (lessonId: string, choice: number, index: number) => {
      setChecking(true);
      setError(null);

      const apply = (graded: GradeResult) => {
        setResult(graded);
        if (!graded.correct) return;
        // Forward only, and only ever by one — so answering lesson one twice
        // cannot unlock lesson three.
        setDone((current) => {
          const next = mergeTasksDone(index + 1, current);
          writeLearnDone(next, LESSON_COUNT);
          return next;
        });
      };

      try {
        const response = await fetch("/api/learn/complete", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({lessonId, answer: choice}),
        });
        if (!response.ok) throw new Error("Could not check that answer.");
        apply((await response.json()) as GradeResult);
      } catch {
        // Graded locally against the same function the server uses.
        apply(gradeLesson(lessonId, choice));
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  return {
    lessons,
    done,
    hydrated,
    completed: completedLessonIds(done),
    allDone: done >= LESSON_COUNT,
    checking,
    result,
    error,
    answer,
    resetAnswer: () => {
      setResult(null);
      setError(null);
    },
  };
}

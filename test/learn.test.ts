/**
 * The Learn subsystem.
 *
 * Progress is a count rather than a set of ids, and these tests pin the two
 * properties that choice buys: it cannot drift from the content, and it cannot
 * move backwards. Both were real failure modes in the app this pattern came
 * from — a stale response arriving after a correct answer would roll someone
 * back a lesson.
 */
import assert from "node:assert/strict";
import {test} from "node:test";

import {
  LESSONS,
  LESSON_COUNT,
  completedLessonIds,
  gradeLesson,
  lessonIndex,
  mergeTasksDone,
  publicLessons,
} from "@/lib/learn";

test("there are three lessons and each is answerable", () => {
  assert.equal(LESSON_COUNT, 3);

  for (const lesson of LESSONS) {
    assert.ok(lesson.id, "lesson needs an id");
    assert.ok(lesson.title, `${lesson.id} needs a title`);
    assert.ok(lesson.body.length >= 3, `${lesson.id} is too short to be a lesson`);
    assert.ok(lesson.quickCheck.options.length >= 3, `${lesson.id} needs distractors`);
    assert.ok(
      lesson.quickCheck.answer >= 0 &&
        lesson.quickCheck.answer < lesson.quickCheck.options.length,
      `${lesson.id} has an answer index outside its options`,
    );
    assert.ok(lesson.quickCheck.explanation, `${lesson.id} needs an explanation`);
  }
});

test("ids are unique, because progress is reconstituted from a count", () => {
  const ids = new Set(LESSONS.map((lesson) => lesson.id));
  assert.equal(ids.size, LESSON_COUNT);
});

/**
 * The answer key must not be in what the client is served.
 *
 * Its ancestor documented this intent and then imported the full lesson module
 * into a client hook, so the key shipped anyway. The server route uses this
 * function, so the guarantee is at least true of the response.
 */
test("public lessons carry no answer and no explanation", () => {
  for (const lesson of publicLessons()) {
    const check = lesson.quickCheck as Record<string, unknown>;
    assert.equal("answer" in check, false, `${lesson.id} leaked its answer`);
    assert.equal("explanation" in check, false, `${lesson.id} leaked its explanation`);
    assert.ok(check.question);
    assert.ok(Array.isArray(check.options));
  }
});

test("grading accepts the right answer and refuses the others", () => {
  for (const lesson of LESSONS) {
    const right = gradeLesson(lesson.id, lesson.quickCheck.answer);
    assert.equal(right.correct, true, `${lesson.id} rejected its own answer`);
    assert.equal(right.explanation, lesson.quickCheck.explanation);

    lesson.quickCheck.options.forEach((_option, index) => {
      if (index === lesson.quickCheck.answer) return;
      const wrong = gradeLesson(lesson.id, index);
      assert.equal(wrong.correct, false);
      // A wrong answer gets a message to show, not silence.
      assert.ok(wrong.message);
      assert.equal(wrong.explanation, undefined);
    });
  }
});

test("an unknown lesson is refused rather than passed", () => {
  const graded = gradeLesson("no-such-lesson", 0);
  assert.equal(graded.correct, false);
  assert.ok(graded.message);
});

test("completed ids follow the count and clamp at both ends", () => {
  assert.deepEqual(completedLessonIds(0), []);
  assert.deepEqual(completedLessonIds(1), [LESSONS[0].id]);
  assert.deepEqual(completedLessonIds(LESSON_COUNT), LESSONS.map((l) => l.id));

  // Out-of-range counts are clamped, not trusted — a corrupted localStorage
  // value must not produce undefined lesson ids.
  assert.deepEqual(completedLessonIds(-5), []);
  assert.deepEqual(completedLessonIds(99), LESSONS.map((l) => l.id));
});

test("progress only ever moves forward", () => {
  // The case that matters: a stale server response arriving after a fresh
  // local answer must not undo it.
  assert.equal(mergeTasksDone(0, 2), 2);
  assert.equal(mergeTasksDone(2, 0), 2);
  assert.equal(mergeTasksDone(1, 3), LESSON_COUNT);
  // And nothing can exceed the number of lessons that exist.
  assert.equal(mergeTasksDone(99, 99), LESSON_COUNT);
});

test("lessonIndex locates a lesson and reports a miss as -1", () => {
  assert.equal(lessonIndex(LESSONS[1].id), 1);
  assert.equal(lessonIndex("nope"), -1);
});

/**
 * The copy rule, enforced.
 *
 * Lesson one is read by someone who has not agreed to learn any of this
 * vocabulary. Using it there is the fastest way to lose them, so the ban is a
 * test rather than an intention.
 */
test("the first lesson uses no wallet vocabulary", () => {
  const banned = [
    "mint",
    "wallet",
    "private key",
    "seed phrase",
    "gas",
    "slippage",
    "liquidity pool",
  ];
  const text = [LESSONS[0].title, LESSONS[0].summary, ...LESSONS[0].body]
    .join(" ")
    .toLowerCase(); // pubkey-lint-ok: lesson prose, not an address

  for (const word of banned) {
    assert.equal(
      text.includes(word),
      false,
      `lesson one says "${word}" before anyone has agreed to learn it`,
    );
  }
});

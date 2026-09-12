import {badRequest, json} from "@/lib/server/http";
import {gradeLesson} from "@/lib/learn";

export const dynamic = "force-dynamic";

/**
 * Grade one quick check.
 *
 * A wrong answer is a **200** with `{correct: false}`, not an error status. It
 * is a normal outcome of using the feature, and a 4xx would make every client
 * error handler treat a wrong guess as a broken request.
 *
 * Graded here rather than in the browser so the answer key has one home.
 */
export async function POST(request: Request) {
  let body: {lessonId?: unknown; answer?: unknown};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON.");
  }

  const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
  const answer = Number(body.answer);

  if (!lessonId) return badRequest("A lesson id is required.");
  if (!Number.isInteger(answer) || answer < 0 || answer > 20) {
    return badRequest("Answer must be an option index.");
  }

  return json(gradeLesson(lessonId, answer));
}

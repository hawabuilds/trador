import {json} from "@/lib/server/http";
import {publicLessons} from "@/lib/learn";

export const dynamic = "force-dynamic";

/**
 * The lesson content, without the answer key.
 *
 * Progress is not returned: there is no account store yet, so the client is the
 * only place it lives. Returning a zeroed server progress alongside real local
 * progress is how a refresh wipes someone's place.
 */
export async function GET() {
  return json({lessons: publicLessons()});
}

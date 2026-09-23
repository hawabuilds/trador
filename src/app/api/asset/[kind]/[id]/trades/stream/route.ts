import {badRequest, parseKind} from "@/lib/server/http";
import {fetchTrades} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

const sseEnabled = () => process.env.NEXT_PUBLIC_TRADES_SSE === "1";

/**
 * Optional SSE trade tape. Enable with `NEXT_PUBLIC_TRADES_SSE=1`.
 */
export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  if (!sseEnabled()) {
    return new Response("SSE disabled.", {status: 404});
  }

  const kind = parseKind(params.kind);
  if (!kind) return badRequest("Unknown asset kind.");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const push = async () => {
        if (closed) return;
        try {
          const result = await fetchTrades(kind, params.id);
          const payload = JSON.stringify({
            trades: result.data.trades,
            pollMs: result.data.pollMs,
            source: result.data.source,
            tapeComplete: result.data.tapeComplete,
            stale: result.stale,
            error: result.error,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          if (!closed) {
            setTimeout(push, result.data.pollMs);
          }
        } catch (error) {
          const message = (error as Error).message ?? "stream error";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({message})}\n\n`));
          if (!closed) setTimeout(push, 12_000);
        }
      };

      void push();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

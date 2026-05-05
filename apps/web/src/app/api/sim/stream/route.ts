import { buildQueueLabSnapshot } from "@/lib/simQueue/buildQueueLabSnapshot";
import { createBackendLogger } from "@/lib/backendLogger";
import { formatSseDataLine } from "@/lib/simQueue/parseStreamEvent";
import { isNativeSqliteUnavailableError, toNativeSqliteUnavailablePayload } from "@/lib/simQueue/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const logger = createBackendLogger("sim-stream-api");

/**
 * SSE of jobs + lab session summaries. Server polls SQLite on an interval so updates from the
 * separate `pnpm sim:worker` process are visible without in-memory pub/sub (tradeoff: ~0.5–1s latency).
 */
export async function GET(req: Request) {
  const signal = req.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let lastSig = "";
      let lastErrorSig = "";
      let lastErrorAt = 0;
      let closed = false;
      let nativeUnavailableSent = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      const tick = () => {
        if (signal.aborted) {
          close();
          return;
        }
        try {
          const snap = buildQueueLabSnapshot();
          const sig = JSON.stringify(snap);
          if (sig !== lastSig) {
            lastSig = sig;
            controller.enqueue(encoder.encode(formatSseDataLine(snap)));
          }
        } catch (e) {
          if (!nativeUnavailableSent && isNativeSqliteUnavailableError(e)) {
            nativeUnavailableSent = true;
            logger.error("Native SQLite module unavailable for stream", {
              error: e instanceof Error ? e.message : String(e),
            });
            controller.enqueue(encoder.encode(formatSseDataLine({ error: toNativeSqliteUnavailablePayload(e) })));
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            return;
          }
          const msg = e instanceof Error ? e.message : String(e);
          const now = Date.now();
          if (msg !== lastErrorSig || now - lastErrorAt >= 10_000) {
            lastErrorSig = msg;
            lastErrorAt = now;
            logger.error("Stream polling failed", { error: msg });
            controller.enqueue(encoder.encode(formatSseDataLine({ error: msg })));
          }
        }
      };

      tick();
      pollTimer = setInterval(tick, 600);
      pingTimer = setInterval(() => {
        if (signal.aborted) {
          close();
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 20_000);

      signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

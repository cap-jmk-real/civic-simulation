import {
  getJob,
  isNativeSqliteUnavailableError,
  toNativeSqliteUnavailablePayload,
} from "@/lib/simQueue/store";
import { createBackendLogger } from "@/lib/backendLogger";
import { jobRowToDetailApiJson } from "@/lib/simQueue/jobDetailForApi";
import { formatSseDataLine } from "@/lib/simQueue/parseStreamEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const logger = createBackendLogger("sim-job-stream-api");

/**
 * SSE for a single job row (polls SQLite). Stays open after the job finishes so the browser does not
 * auto-reconnect EventSource in a tight loop; client closes when leaving the detail view.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
          const row = getJob(id);
          if (!row) {
            controller.enqueue(encoder.encode(formatSseDataLine({ error: "Not found" })));
            close();
            return;
          }
          const body = jobRowToDetailApiJson(row);
          const sig = `${row.status}\0${row.updated_at}\0${row.progress_note ?? ""}\0${row.error_text ?? ""}\0${row.result_json?.length ?? 0}`;
          if (sig !== lastSig) {
            lastSig = sig;
            controller.enqueue(encoder.encode(formatSseDataLine(body)));
          }
        } catch (e) {
          if (!nativeUnavailableSent && isNativeSqliteUnavailableError(e)) {
            nativeUnavailableSent = true;
            logger.error("Native SQLite module unavailable for job stream", {
              id,
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
            logger.error("Job stream polling failed", { id, error: msg });
            controller.enqueue(encoder.encode(formatSseDataLine({ error: msg })));
          }
        }
      };

      tick();
      pollTimer = setInterval(tick, 500);
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
      }, 25_000);
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

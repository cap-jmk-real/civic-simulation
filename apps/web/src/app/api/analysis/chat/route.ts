import { Agent } from "@cursor/sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type ChatBody = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context: string;
};

const SYSTEM = `You are an expert analyst for batches of agent-based simulations (IP / innovation / wealth dynamics).
You only receive summarized terminal metrics and sweep assignments—not full time series unless quoted.
Be precise; cite cell labels when comparing runs; say when data is insufficient.
Use Markdown (headings, bullet lists, tables) when it improves clarity.`;

export async function POST(req: Request) {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "CURSOR_API_KEY is not set on the server. Add it to .env.local for agentic analysis.",
      },
      { status: 503 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript =
    body.messages
      ?.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n") ?? "";

  const prompt = `${SYSTEM}

--- Dataset (selected batch) ---
${body.context ?? "(empty)"}

--- Conversation ---
${transcript}

Assistant: respond to the latest User message.`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
      try {
        agent = await Agent.create({
          apiKey,
          model: { id: "composer-2" },
          local: {
            cwd: process.cwd(),
            settingSources: [],
          },
        });
        const run = await agent.send(prompt);
        for await (const msg of run.stream()) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                controller.enqueue(encoder.encode(block.text));
              }
            }
          }
        }
        const result = await run.wait();
        if (result.status === "error") {
          controller.enqueue(encoder.encode(`\n\n_[Run ended with status: error]_`));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`\n\n_[Analysis error: ${msg}]_`));
      } finally {
        try {
          if (agent) await agent[Symbol.asyncDispose]();
        } catch {
          /* ignore */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

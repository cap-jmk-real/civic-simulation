import type { AgentObservation } from "@ip-sim/core";
import { ACTIONS, validateAction } from "@ip-sim/core";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  observation: z.custom<AgentObservation>(),
  model: z.string().optional(),
});

const ResponseSchema = z.object({
  action: z.string(),
  rationale: z.string().optional(),
});

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set. Use heuristic or QRE mode, or add the key to .env.local." },
      { status: 503 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model =
    body.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const obs = body.observation;
  const actionList = ACTIONS.join(", ");

  const system = `You choose ONE discrete action for an agent in an intellectual-property / information-sharing simulation.
Valid actions exactly: ${actionList}.
Respond ONLY with compact JSON: {"action":"<one of the valid actions>","rationale":"short optional reason"}.
Be concise.`;

  const user = JSON.stringify({
    agentId: obs.selfId,
    type: obs.type,
    tick: obs.tick,
    wealth: obs.wealth,
    knowledge: obs.knowledge,
    labor: obs.labor,
    patents: obs.patentCount,
    reputation: obs.reputation,
    offeringQuality: obs.lastOfferingQuality,
    pendingInnovation: obs.pendingInnovationCount,
    neighbors: obs.neighbors,
    globalPool: obs.globalPool,
    marketSize: obs.marketSize,
    policy: obs.policy,
    regulatory: obs.regulatory,
    population: obs.population,
    spawn: obs.spawn,
    memory: obs.memory.slice(-6),
    lastProfit: obs.lastProfit,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: `OpenAI error ${res.status}`, detail: errText.slice(0, 400) },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Model returned non-JSON" }, { status: 502 });
  }

  const safe = ResponseSchema.safeParse(parsed);
  if (!safe.success || !validateAction(safe.data.action)) {
    return NextResponse.json(
      { error: "Invalid action from model", raw },
      { status: 502 },
    );
  }

  return NextResponse.json({ action: safe.data.action });
}

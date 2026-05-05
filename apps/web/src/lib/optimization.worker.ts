import { runEvolutionarySearch, type EvolutionaryEvaluationPayload } from "@/lib/evolutionaryOptimize";

type WorkerRequest = {
  type: "run";
  payload: Parameters<typeof runEvolutionarySearch>[0];
};

type WorkerCancel = { type: "cancel" };

let cancelRequested = false;

self.onmessage = (event: MessageEvent<WorkerRequest | WorkerCancel>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "cancel") {
    cancelRequested = true;
    return;
  }
  if (msg.type !== "run") return;

  cancelRequested = false;
  void runEvolutionarySearch({
    ...msg.payload,
    shouldCancel: () => cancelRequested,
    yieldToUi: async () => {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
      });
    },
    onEvaluationBegin: (beg) => {
      self.postMessage({ type: "evaluationBegin", payload: beg });
    },
    onEvaluation: (ev: EvolutionaryEvaluationPayload) => {
      self.postMessage({ type: "evaluation", payload: ev });
    },
    onGeneration: (gen) => {
      self.postMessage({ type: "generation", payload: gen });
    },
  })
    .then((result) => {
      self.postMessage({ type: "done", payload: result });
    })
    .catch((error: unknown) => {
      self.postMessage({
        type: "error",
        payload: error instanceof Error ? error.message : String(error),
      });
    });
};

export {};

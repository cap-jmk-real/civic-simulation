import type { AgentState, MemoryEvent } from "./types.js";

/**
 * Append a short text event to the agent’s memory, cap length to `maxSlots` (oldest dropped),
 * then randomly remove remaining entries with probability `decayDropProbability` per entry.
 * Not re-exported from the package public entry; used by {@link applyStep}.
 */
export function pushMemory(
  agent: AgentState,
  tick: number,
  summary: string,
  maxSlots: number,
  decayDropProbability: number,
  rnd: () => number,
): void {
  agent.memory.push({ tick, summary });
  while (agent.memory.length > maxSlots) {
    agent.memory.shift();
  }
  if (decayDropProbability > 0) {
    agent.memory = agent.memory.filter(() => rnd() > decayDropProbability);
  }
}

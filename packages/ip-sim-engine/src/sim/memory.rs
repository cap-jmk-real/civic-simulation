//! Matches `packages/sim-core/src/memory.ts`.

use crate::sim::types::{Agent, MemoryEvent};
use crate::rng::Rng01;

pub fn push_memory<R: Rng01 + ?Sized>(
    agent: &mut Agent,
    tick: u32,
    summary: &str,
    max_slots: usize,
    decay_drop_probability: f64,
    rnd: &mut R,
) {
    agent.memory.push(MemoryEvent {
        tick,
        summary: summary.to_string(),
    });
    while agent.memory.len() > max_slots {
        agent.memory.remove(0);
    }
    if decay_drop_probability > 0.0 {
        agent.memory.retain(|_| rnd.next_f64() > decay_drop_probability);
    }
}

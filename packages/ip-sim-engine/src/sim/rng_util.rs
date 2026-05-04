//! Tick-local RNG and shuffle — matches `rng.ts` + `runSimulationSync` seed rule.

use crate::rng::{MulBerry32, Rng01};
use crate::sim::types::WorldState;

/// `mulberry32(config.seed + step * 9973 + world.tick * 37)` with uint32 wrap like TS `>>> 0`.
pub fn tick_rng(config_seed: u32, step: u32, world_tick: u32) -> MulBerry32 {
    let s = config_seed
        .wrapping_add(step.wrapping_mul(9973))
        .wrapping_add(world_tick.wrapping_mul(37));
    MulBerry32::new(s)
}

pub fn shuffle_in_place<T, R: Rng01 + ?Sized>(arr: &mut [T], rnd: &mut R) {
    let n = arr.len();
    if n < 2 {
        return;
    }
    for i in (1..n).rev() {
        let r = rnd.next_f64();
        let j = (r * (i + 1) as f64).floor() as usize;
        if j > i {
            continue;
        }
        arr.swap(i, j);
    }
}

/// `rnd` stream for a full tick (same as TS passing closure calling next_f64).
pub fn apply_step_rng(cfg_seed: u32, step: u32, world: &WorldState) -> MulBerry32 {
    tick_rng(cfg_seed, step, world.tick)
}

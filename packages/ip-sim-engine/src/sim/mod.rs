//! Full ABM engine ported from `packages/sim-core` — parity-oriented.

pub mod config;
pub mod demand;
pub mod engine;
pub mod engine_actions;
pub mod factory;
pub mod graph_gen;
pub mod heuristic;
pub mod memory;
pub mod metrics_tick;
pub mod observe;
pub mod production;
pub mod regulatory;
pub mod rng_util;
pub mod types;

pub use config::default_sim_config;
pub use engine::{
    apply_step, create_agent_of_type, create_agents_from_counts, create_world,
    run_simulation_sync_heuristic,
};
pub use types::{
    Agent, DemandModel, Edge, SimConfig, SimulationRun, TickMetrics, TickRecord, WorldState,
};

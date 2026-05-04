//! Full simulation step — matches `packages/sim-core` `engine.ts` / `dist/engine.js`.

use std::collections::HashMap;

use crate::rng::Rng01;
use crate::sim::engine_actions;
use crate::sim::factory::{add_or_strengthen_edge, create_world as build_world, find_edge};
use crate::sim::metrics_tick::compute_tick_metrics;
use crate::sim::production::offering_quality_branches;
use crate::sim::regulatory::{
    advance_regulatory_stringency, compute_net_externality_load, mitigation_baseline_stringency,
};
use crate::sim::rng_util::shuffle_in_place;
use crate::sim::types::*;

pub use crate::sim::factory::{
    create_agent_of_type, create_agents_from_counts, create_world,
};

fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    x.max(lo).min(hi)
}

/// Mutable refs to `agents[xi]` and `agents[yi]` for distinct indices.
fn agents_pair_mut(agents: &mut [Agent], xi: usize, yi: usize) -> (&mut Agent, &mut Agent) {
    assert_ne!(xi, yi);
    if xi < yi {
        let (first, second) = agents.split_at_mut(yi);
        (&mut first[xi], &mut second[0])
    } else {
        let (first, second) = agents.split_at_mut(xi);
        (&mut second[0], &mut first[yi])
    }
}

/// Apply one tick. `rnd` = tick-local stream (`mulberry32` in TS).
pub fn apply_step<R: Rng01 + ?Sized>(
    world: &mut WorldState,
    actions: &HashMap<String, String>,
    rnd: &mut R,
) -> f64 {
    let cfg = world.config.clone();
    let policy = &cfg.policy;
    let mut innovation_flow = 0.0;

    let tick_now = world.tick;
    for agent in &mut world.agents {
        let mut kept = Vec::new();
        for p in std::mem::take(&mut agent.innovation_pipeline) {
            if p.deliver_on_tick == tick_now {
                agent.knowledge += p.knowledge_gain;
                innovation_flow += p.knowledge_gain;
            } else {
                kept.push(p);
            }
        }
        agent.innovation_pipeline = kept;
    }

    let spill_mult = 1.0
        + policy.data_sharing_mandate_strength * 0.25
        + policy.open_science_subsidy * 0.2;

    let (flow_act, collaborators, traders) =
        engine_actions::run_action_phase(world, actions, &cfg, rnd, spill_mult);
    innovation_flow += flow_act;

    let mut collaborators = collaborators;
    shuffle_in_place(&mut collaborators, rnd);
    for pair in collaborators.chunks_exact(2) {
        let x = &pair[0];
        let y = &pair[1];
        add_or_strengthen_edge(world, x, y, rnd);
        let xi = world.agents.iter().position(|a| a.id == *x);
        let yi = world.agents.iter().position(|a| a.id == *y);
        if let (Some(xi), Some(yi)) = (xi, yi) {
            if xi != yi {
                let pool = {
                    let ax = &world.agents[xi];
                    let ay = &world.agents[yi];
                    (ax.knowledge + ay.knowledge) * 0.05
                };
                let (lo, hi) = if xi < yi { (xi, yi) } else { (yi, xi) };
                let (first, second) = world.agents.split_at_mut(hi);
                first[lo].knowledge += pool * 0.45;
                second[0].knowledge += pool * 0.45;
                first[lo].reputation += 0.02;
                second[0].reputation += 0.02;
                innovation_flow += pool * 0.9;
            }
        }
    }

    let mut traders = traders;
    shuffle_in_place(&mut traders, rnd);
    for pair in traders.chunks_exact(2) {
        let x = &pair[0];
        let y = &pair[1];
        if find_edge(world, x, y).is_none() {
            continue;
        }
        let exw = world.edges[find_edge(world, x, y).unwrap()].weight;
        let xi = world.agents.iter().position(|a| a.id == *x);
        let yi = world.agents.iter().position(|a| a.id == *y);
        if let (Some(xi), Some(yi)) = (xi, yi) {
            if xi == yi {
                continue;
            }
            let cap = {
                let ax = &world.agents[xi];
                let ay = &world.agents[yi];
                ax.wealth.min(ay.wealth) * 0.04 * (0.35 + exw * 0.25)
            };
            let p = cap.min(12.0).max(0.0);
            if p <= 0.0 {
                continue;
            }
            let wx_ge = world.agents[xi].wealth >= world.agents[yi].wealth;
            let (ax, ay) = agents_pair_mut(&mut world.agents, xi, yi);
            if wx_ge {
                ax.wealth -= p;
                ay.wealth += p;
            } else {
                ay.wealth -= p;
                ax.wealth += p;
            }
        }
    }

    for a in &mut world.agents {
        if matches!(a.kind, AgentKind::Academic) {
            let stipend = 2.2 * (1.0 + policy.open_science_subsidy);
            a.wealth += stipend;
        }
    }

    let shares = crate::sim::metrics_tick::compute_market_shares(
        &world.agents,
        &world.edges,
        &cfg.type_weights,
        cfg.capability_beta,
        cfg.spillover_alpha,
    );
    let sum_w: f64 = shares.iter().sum::<f64>().max(1e-30);
    let n_ag = world.agents.len();
    let qualities: Vec<f64> = world
        .agents
        .iter()
        .map(|ag| offering_quality_branches(ag.kind, ag.knowledge, ag.labor, &cfg).q)
        .collect();
    let q_mean: f64 = if n_ag > 0 {
        qualities.iter().sum::<f64>() / n_ag as f64
    } else {
        0.0
    };

    let base_revenues = crate::sim::demand::compute_base_revenues(
        &world.agents,
        &world.edges,
        &cfg,
        world.market_size,
        world.global_pool,
        &shares,
        sum_w,
        &qualities,
        &policy.patent_regime,
        rnd,
    );
    let rev_bar: f64 = if n_ag > 0 {
        base_revenues.iter().sum::<f64>() / n_ag as f64
    } else {
        1.0
    };

    for i in 0..n_ag {
        let ag = &mut world.agents[i];
        let q = qualities[i];
        let base_rev = base_revenues[i];
        ag.last_offering_quality = if cfg.ces_quality_enabled { q } else { 1.0 };

        let mut revenue = base_rev;
        if cfg.ces_quality_enabled {
            let rel_q = if q_mean > 1e-9 {
                q / q_mean
            } else {
                1.0
            };
            let mult = clamp(
                1.0 + cfg.ces_revenue_gamma * (rel_q - 1.0),
                0.45,
                1.85,
            );
            revenue = base_rev * mult;
            ag.reputation += clamp(
                cfg.ces_rep_relative_quality * (rel_q - 1.0),
                -0.16,
                0.16,
            );
            let rel_sales = if rev_bar > 1e-9 {
                base_rev / rev_bar
            } else {
                1.0
            };
            ag.reputation += clamp(
                cfg.ces_rep_sales * (rel_sales - 1.0),
                -0.12,
                0.12,
            );
        }
        ag.last_profit = revenue;
        ag.cumulative_profit += revenue;
        ag.wealth += revenue;
    }

    world.last_regulatory_tick = None;
    let reg = &cfg.regulatory;
    if reg.enabled && n_ag > 0 {
        let net_load = compute_net_externality_load(&world.agents, &cfg).net_load;
        let eff_str = mitigation_baseline_stringency(world, &cfg);
        let mit = reg.mitigation_efficiency;
        let mut adjusted_load = net_load;
        if net_load > 0.0 {
            adjusted_load *= 1.0 - (eff_str * mit).min(1.0);
        }
        let sum_ex: f64 = world
            .agents
            .iter()
            .map(|a| reg.victim_vulnerability[a.kind as usize])
            .sum::<f64>()
            .max(1e-30);
        let ws = reg.externality_wealth_scale;
        let rs = reg.externality_reputation_scale;
        let mut transfer_sum = 0.0;
        for ag in &mut world.agents {
            let share = reg.victim_vulnerability[ag.kind as usize] / sum_ex;
            let w_delta = -adjusted_load * ws * share;
            ag.wealth = (ag.wealth + w_delta).max(0.0);
            ag.reputation = (ag.reputation + w_delta * rs).max(0.0);
            transfer_sum += w_delta.abs();
        }
        world.last_regulatory_tick = Some(LastRegulatoryTick {
            net_social_load: net_load,
            mitigated_load: adjusted_load,
            effective_stringency: eff_str,
            total_wealth_transfer: transfer_sum,
            corruption: world.regulatory.corruption,
        });
    }

    let mut rnd_fn = || rnd.next_f64();
    advance_regulatory_stringency(world, &cfg, &mut rnd_fn);

    let dw = clamp(cfg.wealth_depreciation_rate, 0.0, 1.0);
    let dk = clamp(cfg.knowledge_depreciation_rate, 0.0, 1.0);
    for ag in &mut world.agents {
        ag.wealth *= 1.0 - dw;
        ag.knowledge = (ag.knowledge * (1.0 - dk)).max(0.0);
    }

    world.market_size += cfg.market_growth_per_tick;

    let t_new = world.tick + 1;
    for ag in &mut world.agents {
        ag.patent_expires_at.retain(|exp| *exp > t_new);
    }

    world.tick = t_new;
    world.global_pool *= 0.995;

    innovation_flow
}

pub fn run_simulation_sync_heuristic(cfg: SimConfig) -> SimulationRun {
    let seed = cfg.seed;
    let ticks = cfg.ticks;
    let mut world = build_world(cfg);
    let mut history: Vec<TickRecord> = Vec::new();
    for step in 0..ticks {
        let mut rnd = crate::sim::rng_util::tick_rng(seed, step, world.tick);
        let mut actions = HashMap::new();
        for a in &world.agents {
            let act = crate::sim::heuristic::heuristic_policy(a, &world);
            actions.insert(a.id.clone(), act.to_string());
        }
        let flow = apply_step(&mut world, &actions, &mut rnd);
        let metrics = compute_tick_metrics(&world, flow);
        let agent_snapshots: Vec<AgentSnapshot> = world
            .agents
            .iter()
            .map(|a| AgentSnapshot {
                id: a.id.clone(),
                wealth: a.wealth,
                knowledge: a.knowledge,
                labor: a.labor,
                patent_count: a.patent_expires_at.len(),
                reputation: a.reputation,
                offering_quality: a.last_offering_quality,
            })
            .collect();
        let edges = world.edges.clone();
        history.push(TickRecord {
            metrics,
            actions,
            agent_snapshots,
            edges,
        });
    }
    SimulationRun {
        seed,
        history,
        final_world: world,
    }
}

//! Action phase: `mem::take` on `WorldState::agents` for borrowck.

use std::collections::HashMap;

use crate::rng::Rng01;
use crate::sim::factory::create_agent_of_type;
use crate::sim::factory::find_edge;
use crate::sim::memory::push_memory;
use crate::sim::regulatory::clamp01;
use crate::sim::types::*;

fn two_agents_mut(agents: &mut [Agent], i: usize, j: usize) -> Option<(&mut Agent, &mut Agent)> {
    if i == j {
        return None;
    }
    let (lo, hi) = if i < j { (i, j) } else { (j, i) };
    let (first, second) = agents.split_at_mut(hi);
    Some((&mut first[lo], &mut second[0]))
}

fn invest_rnd_cost<R: Rng01 + ?Sized>(agent: &Agent, cfg: &SimConfig, rnd: &mut R) -> f64 {
    cfg.invest_rnd_base_cost
        + rnd.next_f64() * cfg.invest_rnd_cost_random_span
        + cfg.invest_rnd_cost_per_knowledge * agent.knowledge
}

fn invest_rnd_knowledge_gain<R: Rng01 + ?Sized>(agent: &Agent, rnd: &mut R) -> f64 {
    (4.0 + rnd.next_f64() * 10.0)
        * if matches!(agent.kind, AgentKind::Bigco) {
            1.15
        } else {
            1.0
        }
}

fn patent_base_cost(regime: &PatentRegime) -> f64 {
    match regime {
        PatentRegime::Strong => 22.0,
        PatentRegime::Weak => 14.0,
        PatentRegime::None => 8.0,
    }
}

pub fn run_action_phase<R: Rng01 + ?Sized>(
    world: &mut WorldState,
    actions: &HashMap<String, String>,
    cfg: &SimConfig,
    rnd: &mut R,
    spill_mult: f64,
) -> (f64, Vec<String>, Vec<String>) {
    let policy = &cfg.policy;
    let mut innovation_flow = 0.0;
    let mut collaborators: Vec<String> = Vec::new();
    let mut traders: Vec<String> = Vec::new();
    let tick = world.tick;

    let mut agents = std::mem::take(&mut world.agents);
    let mut i = 0usize;
    while i < agents.len() {
        let aid = agents[i].id.clone();
        let act = actions.get(&aid).map(|s| s.as_str()).unwrap_or("idle");
        match act {
            "invest_rnd" => {
                let cost = invest_rnd_cost(&agents[i], cfg, rnd);
                let gain = invest_rnd_knowledge_gain(&agents[i], rnd);
                let delay = cfg.innovation_delay_ticks;
                agents[i].wealth -= cost;
                if delay == 0 {
                    agents[i].knowledge += gain;
                    innovation_flow += gain;
                } else {
                    agents[i].innovation_pipeline.push(PendingInnovation {
                        deliver_on_tick: tick + delay,
                        knowledge_gain: gain,
                    });
                }
                let delay_note = if delay == 0 {
                    "now".to_string()
                } else {
                    format!("in {}t", delay)
                };
                let msg = format!(
                    "invest_rnd: spent {:.1}, Δk={:.1} ({})",
                    cost, gain, delay_note
                );
                push_memory(
                    &mut agents[i],
                    tick,
                    &msg,
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "publish_open" => {
                let my_id = agents[i].id.clone();
                let cost_part = 4.0;
                agents[i].wealth -= cost_part * (1.0 - 0.5 * policy.open_science_subsidy);
                let added =
                    agents[i].knowledge * (0.06 + rnd.next_f64() * 0.08) * spill_mult;
                world.global_pool += added;
                agents[i].reputation += 0.08 + rnd.next_f64() * 0.05;
                innovation_flow += added;
                let edges_clone = world.edges.clone();
                for e in &edges_clone {
                    let other = if e.a == my_id {
                        &e.b
                    } else if e.b == my_id {
                        &e.a
                    } else {
                        continue;
                    };
                    if let Some(j) = agents.iter().position(|a| a.id == *other) {
                        if j != i {
                            let w = e.weight;
                            let share = added
                                * 0.12
                                * w
                                * (0.5 + rnd.next_f64() * 0.5);
                            agents[j].knowledge += share * 0.7;
                            innovation_flow += share * 0.7;
                        }
                    }
                }
                push_memory(
                    &mut agents[i],
                    tick,
                    &format!("publish_open: pool += {:.2}", added),
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "file_patent" => {
                let base_cost = patent_base_cost(&policy.patent_regime);
                agents[i].wealth -= base_cost;
                if !matches!(policy.patent_regime, PatentRegime::None) {
                    let dur = cfg.policy.patent_duration_ticks;
                    agents[i].patent_expires_at.push(tick + dur);
                    agents[i].knowledge += 0.5 + rnd.next_f64() * 1.5;
                    innovation_flow += 1.0;
                }
                push_memory(
                    &mut agents[i],
                    tick,
                    &format!("file_patent: regime={:?}", policy.patent_regime),
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "collaborate" => {
                agents[i].wealth -= 2.5;
                collaborators.push(aid.clone());
                push_memory(
                    &mut agents[i],
                    tick,
                    "collaborate: seeking partner",
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "trade" => {
                agents[i].wealth -= 1.0;
                traders.push(aid.clone());
                push_memory(
                    &mut agents[i],
                    tick,
                    "trade: seek counterparty",
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "enforce_ip" => {
                let cost = 10.0
                    * cfg.policy.litigation_cost_multiplier
                    * (0.5 + policy.enforcement_intensity);
                agents[i].wealth -= cost;
                if rnd.next_f64() < policy.enforcement_intensity {
                    let others: Vec<usize> = agents
                        .iter()
                        .enumerate()
                        .filter(|(j, a)| *j != i && !a.patent_expires_at.is_empty())
                        .map(|(j, _)| j)
                        .collect();
                    if !others.is_empty() {
                        let tix = others[(rnd.next_f64() * others.len() as f64).floor() as usize
                            % others.len()];
                        let fee = 6.0 + rnd.next_f64() * 12.0;
                        if let Some((ai, tgt)) = two_agents_mut(&mut agents, i, tix) {
                            tgt.wealth -= fee;
                            ai.wealth += fee * 0.35;
                            ai.reputation += 0.03;
                        }
                    }
                }
                push_memory(
                    &mut agents[i],
                    tick,
                    "enforce_ip",
                    cfg.memory_slots,
                    cfg.memory_decay_per_tick,
                    rnd,
                );
            }
            "bribe_regulator" => {
                let reg = &cfg.regulatory;
                let br = &reg.bribe;
                if reg.enabled && br.enabled {
                    agents[i].wealth -= br.base_cost;
                    let mut p_det = br.detection_probability;
                    if br.corruption_reduces_detection {
                        p_det *= 1.0 - world.regulatory.corruption * 0.5;
                    } else {
                        p_det *= 1.0 + world.regulatory.corruption * 0.25;
                    }
                    p_det = clamp01(p_det);
                    if rnd.next_f64() < p_det {
                        agents[i].wealth -= br.penalty_wealth;
                        agents[i].reputation =
                            (agents[i].reputation - br.penalty_reputation).max(0.0);
                        agents[i].knowledge =
                            (agents[i].knowledge - br.penalty_knowledge).max(0.0);
                        push_memory(
                            &mut agents[i],
                            tick,
                            "bribe_regulator: detected (penalties)",
                            cfg.memory_slots,
                            cfg.memory_decay_per_tick,
                            rnd,
                        );
                    } else {
                        world.regulatory.corruption = clamp01(
                            world.regulatory.corruption + br.corruption_delta,
                        );
                        push_memory(
                            &mut agents[i],
                            tick,
                            "bribe_regulator: undetected",
                            cfg.memory_slots,
                            cfg.memory_decay_per_tick,
                            rnd,
                        );
                    }
                } else {
                    push_memory(
                        &mut agents[i],
                        tick,
                        "bribe_regulator: unavailable",
                        cfg.memory_slots,
                        cfg.memory_decay_per_tick,
                        rnd,
                    );
                }
            }
            "spawn_agent" => {
                let sp = &cfg.spawn;
                let need = sp.parent_cost_wealth + sp.min_parent_wealth_floor;
                if !sp.enabled {
                    push_memory(
                        &mut agents[i],
                        tick,
                        "spawn_agent: disabled",
                        cfg.memory_slots,
                        cfg.memory_decay_per_tick,
                        rnd,
                    );
                } else if agents.len() as u32 >= sp.max_agents {
                    push_memory(
                        &mut agents[i],
                        tick,
                        "spawn_agent: at population cap",
                        cfg.memory_slots,
                        cfg.memory_decay_per_tick,
                        rnd,
                    );
                } else if agents[i].wealth < need {
                    push_memory(
                        &mut agents[i],
                        tick,
                        &format!("spawn_agent: need wealth ≥ {:.0}", need),
                        cfg.memory_slots,
                        cfg.memory_decay_per_tick,
                        rnd,
                    );
                } else {
                    let parent_id = agents[i].id.clone();
                    let pk = agents[i].knowledge;
                    let pr = agents[i].reputation;
                    agents[i].wealth -= sp.parent_cost_wealth;
                    let child_kind = if sp.child_type_inherit {
                        agents[i].kind
                    } else {
                        sp.child_type.unwrap_or(agents[i].kind)
                    };
                    let mut child =
                        create_agent_of_type(child_kind, &mut world.id_seq);
                    child.knowledge = (pk * sp.inherit_knowledge_fraction).max(1.0);
                    child.wealth = sp.child_start_wealth;
                    child.reputation =
                        (pr * 0.35 + rnd.next_f64() * 0.08).max(0.4);
                    child.last_offering_quality = 1.0;
                    innovation_flow += (child.knowledge * 0.15).min(8.0);
                    agents.push(child);
                    let child_id = agents.last().unwrap().id.clone();
                    if let Some(pi) = agents.iter().position(|a| a.id == parent_id) {
                        agents[pi].reputation += sp.parent_reputation_on_success;
                    }
                    if sp.link_parent_edge_weight > 0.0 {
                        let w = (sp.link_parent_edge_weight * (0.85 + rnd.next_f64() * 0.15))
                            .max(0.12)
                            .min(3.0);
                        if let Some(ix) = find_edge(world, &parent_id, &child_id) {
                            let ew = world.edges[ix].weight;
                            world.edges[ix].weight = (ew + w * 0.4).min(3.0);
                        } else {
                            world.edges.push(Edge {
                                a: parent_id.clone(),
                                b: child_id.clone(),
                                weight: w,
                            });
                        }
                    }
                    if let Some(pi) = agents.iter().position(|a| a.id == parent_id) {
                        push_memory(
                            &mut agents[pi],
                            tick,
                            &format!("spawn_agent: new {:?} {}", child_kind, child_id),
                            cfg.memory_slots,
                            cfg.memory_decay_per_tick,
                            rnd,
                        );
                    }
                    if let Some(ci) = agents.iter().position(|a| a.id == child_id) {
                        push_memory(
                            &mut agents[ci],
                            tick,
                            &format!("spawned by {}", parent_id),
                            cfg.memory_slots,
                            cfg.memory_decay_per_tick,
                            rnd,
                        );
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    world.agents = agents;
    (innovation_flow, collaborators, traders)
}

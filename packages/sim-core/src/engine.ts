// @ts-nocheck — implementation aligned with dist build; keep in sync with `types.ts` / `engine.d.ts`.
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";
import { generateInitialEdges } from "./graph.js";
import { pushMemory } from "./memory.js";
import { computeBaseRevenues } from "./demand.js";
import { computeTickMetrics, computeMarketShares } from "./metrics.js";
import { offeringQualityBranches } from "./production.js";
import { buildObservation } from "./observe.js";
import { advanceRegulatoryStringency, clamp01, computeNetExternalityLoad, mitigationBaselineStringency, } from "./regulatory.js";
import { mulberry32, shuffleInPlace } from "./rng.js";
import { ACTIONS } from "./types.js";
import { applyGovernanceMaintenance, initializeCivicRoles, isGovernanceMaintenanceTick, } from "./governance.js";
let idCounter = 0;
function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
}
function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}
/**
 * Create one agent of the given type using the same baselines as the initial population generator.
 * Uses the global id counter (reset in {@link createWorld}).
 */
export function createAgentOfType(type) {
    const startWealth = type === "bigco" ? 180 : type === "academic" ? 70 : type === "smb" ? 95 : 75;
    const startK = type === "academic" ? 22 : type === "bigco" ? 28 : 18;
    const baseLabor = type === "bigco" ? 16 : type === "academic" ? 5 : type === "smb" ? 8 : 4;
    return {
        id: nextId(type),
        type,
        civicRole: "citizen",
        publicServantFireable: true,
        wealth: startWealth + idCounter * 0.01,
        knowledge: startK,
        labor: baseLabor + idCounter * 0.001,
        patentExpiresAt: [],
        reputation: type === "academic" ? 1.2 : 1,
        memory: [],
        lastProfit: 0,
        cumulativeProfit: 0,
        innovationPipeline: [],
        lastOfferingQuality: 1,
    };
}
/**
 * Instantiate agents from per-type counts (`bigco`, `academic`, `smb`, `solo`).
 * IDs and small numeric offsets are generated from an internal counter reset by {@link createWorld}.
 */
export function createAgentsFromCounts(counts) {
    const agents = [];
    ["bigco", "academic", "smb", "solo"].forEach((t) => {
        const n = Math.max(0, Math.floor(counts[t] ?? 0));
        for (let i = 0; i < n; i++) {
            agents.push(createAgentOfType(t));
        }
    });
    return agents;
}
/**
 * Build initial {@link WorldState}: merges `config`, seeds RNG from `config.seed`, creates agents and graph edges.
 * Resets the internal id counter so runs are reproducible for a given config.
 */
export function createWorld(config = defaultSimConfig()) {
    idCounter = 0;
    const cfg = mergeSimConfig(config);
    const rnd = mulberry32(cfg.seed);
    const agents = createAgentsFromCounts(cfg.agentCounts);
    const edges = generateInitialEdges(agents, cfg.graph, rnd);
    const ambition = clamp01(cfg.policy.regulatoryAmbition);
    const reg = cfg.regulatory;
    const initialStr = clamp01(reg.baseStringency * (0.2 + 0.8 * ambition) * reg.policyScale);
    const world = {
        tick: 0,
        agents,
        edges,
        globalPool: 12,
        marketSize: cfg.baseMarketSize,
        config: cfg,
        regulatory: { stringency: initialStr, corruption: 0 },
        lastRegulatoryTick: null,
    };
    initializeCivicRoles(world);
    return world;
}
function agentById(world, id) {
    return world.agents.find((a) => a.id === id);
}
function findEdge(world, a, b) {
    return world.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}
function addOrStrengthenEdge(world, a, b, rnd) {
    const ex = findEdge(world, a, b);
    if (ex)
        ex.weight = Math.min(3, ex.weight + 0.15 + rnd() * 0.1);
    else
        world.edges.push({ a, b, weight: 0.35 + rnd() * 0.25 });
}
function investRndCost(agent, cfg, rnd) {
    return (cfg.investRndBaseCost +
        rnd() * cfg.investRndCostRandomSpan +
        cfg.investRndCostPerKnowledge * agent.knowledge);
}
function investRndKnowledgeGain(agent, rnd) {
    return (4 + rnd() * 10) * (agent.type === "bigco" ? 1.15 : 1);
}
/**
 * Advance one simulation tick: applies delayed R&D, then each agent’s action, collaboration/trade pairing,
 * subsidies, market revenue (edge-logit by default; contest legacy optional) + CES quality effects, depreciation, patent expiry, pool decay, and increments `world.tick`.
 * @returns Total innovation flow (immediate + delayed + spillovers) attributed this tick for metrics.
 */
export function applyStep(world, opts) {
    const { actions, rnd } = opts;
    const cfg = world.config;
    const policy = cfg.policy;
    let innovationFlow = 0;
    // --- Delayed R&D completions (start of tick, before actions) ---
    for (const agent of world.agents) {
        const kept = [];
        for (const p of agent.innovationPipeline) {
            if (p.deliverOnTick === world.tick) {
                agent.knowledge += p.knowledgeGain;
                innovationFlow += p.knowledgeGain;
            }
            else {
                kept.push(p);
            }
        }
        agent.innovationPipeline = kept;
    }
    const spillMult = 1 +
        policy.dataSharingMandateStrength * 0.25 +
        policy.openScienceSubsidy * 0.2;
    // --- Action phase ---
    const collaborators = [];
    const traders = [];
    for (const agent of world.agents) {
        const act = actions[agent.id] ?? "idle";
        if (act === "invest_rnd") {
            const cost = investRndCost(agent, cfg, rnd);
            agent.wealth -= cost;
            const gain = investRndKnowledgeGain(agent, rnd);
            const delay = Math.max(0, Math.floor(cfg.innovationDelayTicks));
            if (delay === 0) {
                agent.knowledge += gain;
                innovationFlow += gain;
            }
            else {
                agent.innovationPipeline.push({
                    deliverOnTick: world.tick + delay,
                    knowledgeGain: gain,
                });
            }
            const delayNote = delay === 0 ? "now" : `in ${delay}t`;
            pushMemory(agent, world.tick, `invest_rnd: spent ${cost.toFixed(1)}, Δk=${gain.toFixed(1)} (${delayNote})`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "publish_open") {
            const cost = 4;
            agent.wealth -= cost * (1 - 0.5 * policy.openScienceSubsidy);
            const added = agent.knowledge * (0.06 + rnd() * 0.08) * spillMult;
            world.globalPool += added;
            agent.reputation += 0.08 + rnd() * 0.05;
            innovationFlow += added;
            // Neighbors absorb partial spill (diminishing)
            for (const e of world.edges) {
                const other = e.a === agent.id ? e.b : e.b === agent.id ? e.a : null;
                if (!other)
                    continue;
                const peer = agentById(world, other);
                if (peer) {
                    const share = added * 0.12 * e.weight * (0.5 + rnd() * 0.5);
                    peer.knowledge += share * 0.7;
                    innovationFlow += share * 0.7;
                }
            }
            pushMemory(agent, world.tick, `publish_open: pool += ${added.toFixed(2)}`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "file_patent") {
            const baseCost = policy.patentRegime === "strong" ? 22 : policy.patentRegime === "weak" ? 14 : 8;
            agent.wealth -= baseCost;
            if (policy.patentRegime !== "none") {
                const dur = cfg.policy.patentDurationTicks;
                agent.patentExpiresAt.push(world.tick + dur);
                agent.knowledge += 0.5 + rnd() * 1.5;
                innovationFlow += 1;
            }
            pushMemory(agent, world.tick, `file_patent: regime=${policy.patentRegime}`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "collaborate") {
            agent.wealth -= 2.5;
            collaborators.push(agent.id);
            pushMemory(agent, world.tick, "collaborate: seeking partner", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "trade") {
            agent.wealth -= 1;
            traders.push(agent.id);
            pushMemory(agent, world.tick, "trade: seek counterparty", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "enforce_ip") {
            const cost = 10 *
                cfg.policy.litigationCostMultiplier *
                (0.5 + policy.enforcementIntensity);
            agent.wealth -= cost;
            if (rnd() < policy.enforcementIntensity) {
                const others = world.agents.filter((x) => x.id !== agent.id && x.patentExpiresAt.length > 0);
                if (others.length) {
                    const target = others[Math.floor(rnd() * others.length)];
                    const fee = 6 + rnd() * 12;
                    target.wealth -= fee;
                    agent.wealth += fee * 0.35;
                    agent.reputation += 0.03;
                }
            }
            pushMemory(agent, world.tick, "enforce_ip", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
        }
        else if (act === "bribe_regulator") {
            const reg = cfg.regulatory;
            const br = reg.bribe;
            if (reg.enabled && br.enabled) {
                agent.wealth -= br.baseCost;
                let pDet = br.detectionProbability;
                if (br.corruptionReducesDetection) {
                    pDet *= 1 - world.regulatory.corruption * 0.5;
                }
                else {
                    pDet *= 1 + world.regulatory.corruption * 0.25;
                }
                pDet = clamp01(pDet);
                if (rnd() < pDet) {
                    agent.wealth -= br.penaltyWealth;
                    agent.reputation = Math.max(0, agent.reputation - br.penaltyReputation);
                    agent.knowledge = Math.max(0, agent.knowledge - br.penaltyKnowledge);
                    pushMemory(agent, world.tick, "bribe_regulator: detected (penalties)", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
                }
                else {
                    world.regulatory.corruption = clamp01(world.regulatory.corruption + br.corruptionDelta);
                    pushMemory(agent, world.tick, "bribe_regulator: undetected", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
                }
            }
            else {
                pushMemory(agent, world.tick, "bribe_regulator: unavailable", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
            }
        }
        else if (act === "spawn_agent") {
            const sp = cfg.spawn;
            const need = sp.parentCostWealth + sp.minParentWealthFloor;
            if (!sp.enabled) {
                pushMemory(agent, world.tick, "spawn_agent: disabled", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
            }
            else if (world.agents.length >= sp.maxAgents) {
                pushMemory(agent, world.tick, "spawn_agent: at population cap", cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
            }
            else if (agent.wealth < need) {
                pushMemory(agent, world.tick, `spawn_agent: need wealth ≥ ${need.toFixed(0)}`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
            }
            else {
                agent.wealth -= sp.parentCostWealth;
                const childType = sp.childType === "inherit" ? agent.type : sp.childType;
                const child = createAgentOfType(childType);
                child.civicRole = "citizen";
                child.publicServantFireable = true;
                child.knowledge = Math.max(1, agent.knowledge * sp.inheritKnowledgeFraction);
                child.wealth = sp.childStartWealth;
                child.reputation = Math.max(0.4, agent.reputation * 0.35 + rnd() * 0.08);
                child.lastOfferingQuality = 1;
                agent.reputation += sp.parentReputationOnSuccess;
                innovationFlow += Math.min(8, child.knowledge * 0.15);
                world.agents.push(child);
                if (sp.linkParentEdgeWeight > 0) {
                    const ex = findEdge(world, agent.id, child.id);
                    const w = Math.min(3, Math.max(0.12, sp.linkParentEdgeWeight * (0.85 + rnd() * 0.15)));
                    if (ex)
                        ex.weight = Math.min(3, ex.weight + w * 0.4);
                    else
                        world.edges.push({ a: agent.id, b: child.id, weight: w });
                }
                pushMemory(agent, world.tick, `spawn_agent: new ${childType} ${child.id}`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
                pushMemory(child, world.tick, `spawned by ${agent.id}`, cfg.memorySlots, cfg.memoryDecayPerTick, rnd);
            }
        }
    }
    shuffleInPlace(collaborators, rnd);
    for (let i = 0; i + 1 < collaborators.length; i += 2) {
        const x = collaborators[i];
        const y = collaborators[i + 1];
        addOrStrengthenEdge(world, x, y, rnd);
        const ax = agentById(world, x);
        const ay = agentById(world, y);
        if (ax && ay) {
            const pool = (ax.knowledge + ay.knowledge) * 0.05;
            ax.knowledge += pool * 0.45;
            ay.knowledge += pool * 0.45;
            innovationFlow += pool * 0.9;
            ax.reputation += 0.02;
            ay.reputation += 0.02;
        }
    }
    shuffleInPlace(traders, rnd);
    for (let i = 0; i + 1 < traders.length; i += 2) {
        const x = traders[i];
        const y = traders[i + 1];
        const ex = findEdge(world, x, y);
        const ax = agentById(world, x);
        const ay = agentById(world, y);
        if (!ex || !ax || !ay)
            continue;
        const cap = Math.min(ax.wealth, ay.wealth) * 0.04 * (0.35 + ex.weight * 0.25);
        const p = Math.min(12, Math.max(0, cap));
        if (p <= 0)
            continue;
        if (ax.wealth >= ay.wealth) {
            ax.wealth -= p;
            ay.wealth += p;
        }
        else {
            ay.wealth -= p;
            ax.wealth += p;
        }
    }
    // Academic stipend / SME subsidy channel
    for (const a of world.agents) {
        if (a.type === "academic") {
            const stipend = 2.2 * (1 + policy.openScienceSubsidy);
            a.wealth += stipend;
        }
    }
    // --- Economy: contest market ---
    const shares = computeMarketShares(world.agents, world.edges, cfg.typeWeights, cfg.capabilityBeta, cfg.spilloverAlpha);
    const sumW = shares.reduce((s, x) => s + x, 0) || 1;
    const nAg = world.agents.length;
    const qualities = world.agents.map((ag) => offeringQualityBranches(ag, cfg).q);
    const qMean = qualities.reduce((s, q) => s + q, 0) / (nAg > 0 ? nAg : 1);
    const baseRevenues = computeBaseRevenues(world.agents, world.edges, cfg, world.marketSize, world.globalPool, shares, sumW, qualities, policy.patentRegime, rnd);
    const revBar = baseRevenues.reduce((s, x) => s + x, 0) / (nAg > 0 ? nAg : 1) || 1;
    for (let i = 0; i < nAg; i++) {
        const ag = world.agents[i];
        const q = qualities[i];
        const baseRev = baseRevenues[i];
        ag.lastOfferingQuality = cfg.cesQualityEnabled ? q : 1;
        let revenue = baseRev;
        if (cfg.cesQualityEnabled) {
            const relQ = qMean > 1e-9 ? q / qMean : 1;
            const mult = clamp(1 + cfg.cesRevenueGamma * (relQ - 1), 0.45, 1.85);
            revenue = baseRev * mult;
            ag.reputation += clamp(cfg.cesRepRelativeQuality * (relQ - 1), -0.16, 0.16);
            const relSales = revBar > 1e-9 ? baseRev / revBar : 1;
            ag.reputation += clamp(cfg.cesRepSales * (relSales - 1), -0.12, 0.12);
        }
        const profit = revenue;
        ag.lastProfit = profit;
        ag.cumulativeProfit += profit;
        ag.wealth += profit;
    }
    // --- Regulatory externality (goods/services social load) ---
    world.lastRegulatoryTick = null;
    const reg = cfg.regulatory;
    if (reg.enabled && nAg > 0) {
        const { netLoad } = computeNetExternalityLoad(world.agents, cfg);
        const effStr = mitigationBaselineStringency(world, cfg);
        const mit = reg.mitigationEfficiency;
        let adjustedLoad = netLoad;
        if (netLoad > 0) {
            adjustedLoad = netLoad * (1 - Math.min(1, effStr * mit));
        }
        const exp = (t) => reg.victimVulnerability[t] ?? 1;
        const sumEx = world.agents.reduce((s, a) => s + exp(a.type), 0) || 1;
        const ws = reg.externalityWealthScale;
        const rs = reg.externalityReputationScale;
        let transferSum = 0;
        for (const ag of world.agents) {
            const share = exp(ag.type) / sumEx;
            const wDelta = -adjustedLoad * ws * share;
            ag.wealth = Math.max(0, ag.wealth + wDelta);
            ag.reputation = Math.max(0, ag.reputation + wDelta * rs);
            transferSum += Math.abs(wDelta);
        }
        world.lastRegulatoryTick = {
            netSocialLoad: netLoad,
            mitigatedLoad: adjustedLoad,
            effectiveStringency: effStr,
            totalWealthTransfer: transferSum,
            corruption: world.regulatory.corruption,
        };
    }
    advanceRegulatoryStringency(world, cfg, rnd);
    const dw = Math.max(0, Math.min(1, cfg.wealthDepreciationRate));
    const dk = Math.max(0, Math.min(1, cfg.knowledgeDepreciationRate));
    for (const ag of world.agents) {
        ag.wealth *= 1 - dw;
        ag.knowledge = Math.max(0, ag.knowledge * (1 - dk));
    }
    world.marketSize += cfg.marketGrowthPerTick;
    // Patent expiry
    const t = world.tick + 1;
    for (const ag of world.agents) {
        ag.patentExpiresAt = ag.patentExpiresAt.filter((exp) => exp > t);
    }
    if (isGovernanceMaintenanceTick(cfg.governance, t)) {
        applyGovernanceMaintenance(world, cfg, rnd);
    }
    world.tick = t;
    world.globalPool *= 0.995;
    return innovationFlow;
}
/**
 * Type guard: true iff `a` is one of {@link ACTIONS}.
 */
export function validateAction(a) {
    return ACTIONS.includes(a);
}
/**
 * Run `config.ticks` steps synchronously: each tick calls `decide` for every agent, then {@link applyStep} and {@link computeTickMetrics}.
 * Returns a {@link SimulationRun} plus `finalWorld` for inspection.
 */
export function runSimulationSync(options) {
    const config = mergeSimConfig(options.config ?? defaultSimConfig());
    const world = createWorld({ ...config, seed: config.seed });
    const history = [];
    for (let step = 0; step < config.ticks; step++) {
        const rnd = mulberry32(config.seed + step * 9973 + world.tick * 37);
        const actions = {};
        for (const agent of world.agents) {
            actions[agent.id] = options.decide(world, agent);
        }
        const innovationFlow = applyStep(world, { actions, rnd });
        const metrics = computeTickMetrics(world, innovationFlow);
        history.push({
            metrics,
            actions,
            agentSnapshots: world.agents.map((a) => ({
                id: a.id,
                civicRole: a.civicRole,
                publicServantFireable: a.publicServantFireable,
                wealth: a.wealth,
                knowledge: a.knowledge,
                labor: a.labor,
                patentCount: a.patentExpiresAt.length,
                reputation: a.reputation,
                offeringQuality: a.lastOfferingQuality,
            })),
            edges: world.edges.map((e) => ({ ...e })),
        });
    }
    return {
        manifest: { schemaVersion: 1, ...options.manifest, config },
        history,
        finalWorld: world,
    };
}
/**
 * Same as {@link runSimulationSync} but `decide` may return a `Promise` (e.g. LLM policies).
 */
export async function runSimulationAsync(options) {
    const config = mergeSimConfig(options.config ?? defaultSimConfig());
    const world = createWorld({ ...config, seed: config.seed });
    const history = [];
    for (let step = 0; step < config.ticks; step++) {
        const rnd = mulberry32(config.seed + step * 9973 + world.tick * 37);
        const actions = {};
        for (const agent of world.agents) {
            actions[agent.id] = await options.decide(world, agent);
        }
        const innovationFlow = applyStep(world, { actions, rnd });
        const metrics = computeTickMetrics(world, innovationFlow);
        history.push({
            metrics,
            actions,
            agentSnapshots: world.agents.map((a) => ({
                id: a.id,
                civicRole: a.civicRole,
                publicServantFireable: a.publicServantFireable,
                wealth: a.wealth,
                knowledge: a.knowledge,
                labor: a.labor,
                patentCount: a.patentExpiresAt.length,
                reputation: a.reputation,
                offeringQuality: a.lastOfferingQuality,
            })),
            edges: world.edges.map((e) => ({ ...e })),
        });
    }
    return {
        manifest: { schemaVersion: 1, ...options.manifest, config },
        history,
        finalWorld: world,
    };
}
/**
 * Same tick loop as {@link runSimulationSync} but `await`s `yieldToUi` every `tickYieldInterval` ticks (default 2)
 * so the browser can paint and handle input (e.g. Stop). Aborts with partial history when `shouldCancel()` is true.
 */
export async function runSimulationCooperative(options) {
    const tickYieldInterval = Math.max(1, Math.floor(options.tickYieldInterval ?? 2));
    const config = mergeSimConfig(options.config ?? defaultSimConfig());
    const world = createWorld({ ...config, seed: config.seed });
    const history = [];
    for (let step = 0; step < config.ticks; step++) {
        const rnd = mulberry32(config.seed + step * 9973 + world.tick * 37);
        const actions = {};
        for (const agent of world.agents) {
            actions[agent.id] = options.decide(world, agent);
        }
        const innovationFlow = applyStep(world, { actions, rnd });
        const metrics = computeTickMetrics(world, innovationFlow);
        history.push({
            metrics,
            actions,
            agentSnapshots: world.agents.map((a) => ({
                id: a.id,
                civicRole: a.civicRole,
                publicServantFireable: a.publicServantFireable,
                wealth: a.wealth,
                knowledge: a.knowledge,
                labor: a.labor,
                patentCount: a.patentExpiresAt.length,
                reputation: a.reputation,
                offeringQuality: a.lastOfferingQuality,
            })),
            edges: world.edges.map((e) => ({ ...e })),
        });
        if ((step + 1) % tickYieldInterval === 0 || step === config.ticks - 1) {
            if (options.yieldToUi)
                await options.yieldToUi();
            if (options.shouldCancel && options.shouldCancel()) {
                return {
                    manifest: { schemaVersion: 1, ...options.manifest, config },
                    history,
                    finalWorld: world,
                    cancelled: true,
                };
            }
        }
    }
    return {
        manifest: { schemaVersion: 1, ...options.manifest, config },
        history,
        finalWorld: world,
        cancelled: false,
    };
}
export { buildObservation };

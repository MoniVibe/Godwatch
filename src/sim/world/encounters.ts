import { event } from "../chronicle/events";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  CreatureCategory,
  CreatureCategoryProfile,
  EncounterDefinition,
  EncounterKind,
  Id,
  Settlement,
  SpecialWorldEventKind,
  SpecialWorldEventState,
  World,
  WorldEventConsequence,
  WorldFeature,
  WorldPhaseKind,
  WorldPhaseState
} from "../types";

export interface EncounterSeedOptions {
  danger?: number;
  name?: string;
  factionId?: Id;
  tags?: string[];
}

export interface WorldEventScheduleOptions {
  locationId?: Id;
  durationTicks?: number;
  intensity?: number;
  tags?: string[];
}

export interface WorldEventTickResult {
  activeEvents: number;
  expiredEvents: number;
  consequencesApplied: number;
  phase: WorldPhaseKind;
}

interface WorldEventTemplate {
  kind: SpecialWorldEventKind;
  name: string;
  phase: WorldPhaseKind;
  durationTicks: number;
  intensity: number;
  consequences: Omit<WorldEventConsequence, "locationId" | "featureId">[];
  tags: string[];
}

export const creatureCategoryProfiles: Record<CreatureCategory, CreatureCategoryProfile> = {
  mortal: { category: "mortal", threatBias: 0, moralePressure: 0, resourceAffinity: ["food", "coin", "iron"], tags: ["living", "social"] },
  beast: { category: "beast", threatBias: 6, moralePressure: 4, resourceAffinity: ["hide", "bone", "meat"], tags: ["living", "wild"] },
  demon: { category: "demon", threatBias: 28, moralePressure: 24, resourceAffinity: ["sulfur", "blood-amber", "relic glass"], tags: ["infernal", "curse", "boss-ready"] },
  undead: { category: "undead", threatBias: 18, moralePressure: 18, resourceAffinity: ["grave salt", "bone", "moon-iron"], tags: ["dead", "curse", "night"] },
  summon: { category: "summon", threatBias: 14, moralePressure: 10, resourceAffinity: ["aether residue", "storm quartz", "binding ash"], tags: ["temporary", "controlled", "ritual"] },
  otherworldly: { category: "otherworldly", threatBias: 24, moralePressure: 16, resourceAffinity: ["void glass", "auramite", "sky salt"], tags: ["alien", "aether", "rare"] },
  construct: { category: "construct", threatBias: 12, moralePressure: 6, resourceAffinity: ["cogwork", "green amber", "iron"], tags: ["built", "battery", "salvage"] }
};

export const specialWorldEventTemplates: Record<SpecialWorldEventKind, WorldEventTemplate> = {
  "blood-moon": {
    kind: "blood-moon",
    name: "Blood Moon",
    phase: "blood-moon",
    durationTicks: 18,
    intensity: 74,
    consequences: [
      { kind: "encounter-pressure", magnitude: 18, encounterKind: "gravebreak", category: "undead", tags: ["night", "undead"] },
      { kind: "resource-spawn", magnitude: 2, resource: "blood-amber", tags: ["moon", "volatile"] },
      { kind: "settlement-modifier", magnitude: 8, tags: ["unrest", "threat"] }
    ],
    tags: ["moon", "night", "hostile"]
  },
  holiday: {
    kind: "holiday",
    name: "High Feast",
    phase: "holiday",
    durationTicks: 24,
    intensity: 45,
    consequences: [
      { kind: "settlement-modifier", magnitude: -6, tags: ["unrest", "prosperity"] },
      { kind: "resource-spawn", magnitude: 1, resource: "festival stores", tags: ["trade", "supply"] }
    ],
    tags: ["society", "festival", "trade"]
  },
  "hard-mode-transition": {
    kind: "hard-mode-transition",
    name: "World Wound Opens",
    phase: "hard-mode",
    durationTicks: 9999,
    intensity: 86,
    consequences: [
      { kind: "encounter-pressure", magnitude: 24, encounterKind: "boss", category: "demon", tags: ["boss", "hard-mode"] },
      { kind: "resource-spawn", magnitude: 3, resource: "auramite", tags: ["deep", "rare"] },
      { kind: "feature-modifier", magnitude: 12, tags: ["danger", "richness"] }
    ],
    tags: ["hard-mode", "phase", "danger"]
  },
  "resource-bloom": {
    kind: "resource-bloom",
    name: "Aether Bloom",
    phase: "aether-surge",
    durationTicks: 12,
    intensity: 52,
    consequences: [
      { kind: "resource-spawn", magnitude: 3, resource: "storm quartz", tags: ["aether", "crystal"] },
      { kind: "feature-modifier", magnitude: 6, tags: ["richness"] }
    ],
    tags: ["aether", "resource", "crystal"]
  },
  "boss-stirring": {
    kind: "boss-stirring",
    name: "Boss Stirring",
    phase: "eclipse",
    durationTicks: 14,
    intensity: 68,
    consequences: [
      { kind: "encounter-pressure", magnitude: 20, encounterKind: "boss", category: "otherworldly", tags: ["boss", "omen"] },
      { kind: "settlement-modifier", magnitude: 7, tags: ["threat"] }
    ],
    tags: ["boss", "omen"]
  },
  "summoning-window": {
    kind: "summoning-window",
    name: "Summoning Window",
    phase: "aether-surge",
    durationTicks: 10,
    intensity: 60,
    consequences: [
      { kind: "encounter-pressure", magnitude: 18, encounterKind: "summoning", category: "summon", tags: ["ritual", "summon"] },
      { kind: "resource-spawn", magnitude: 1, resource: "binding ash", tags: ["ritual"] }
    ],
    tags: ["ritual", "summon", "aether"]
  }
};

function chooseSettlement(world: World, rng: Rng, locationId?: Id): Settlement | undefined {
  if (locationId) {
    return world.settlements[locationId];
  }
  const settlements = Object.values(world.settlements);
  return settlements.length ? rng.pick(settlements) : undefined;
}

function chooseFeature(world: World, rng: Rng, locationId?: Id): WorldFeature | undefined {
  const features = Object.values(world.planet.features);
  if (features.length === 0) {
    return undefined;
  }
  const local = locationId ? features.filter((feature) => feature.nearestSettlementId === locationId) : [];
  return local.length ? rng.pick(local) : rng.pick(features);
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function templateFor(kind: SpecialWorldEventKind): WorldEventTemplate {
  return specialWorldEventTemplates[kind];
}

export function creatureProfile(category: CreatureCategory): CreatureCategoryProfile {
  return creatureCategoryProfiles[category];
}

export function classifyCreature(label: string, tags: string[] = []): CreatureCategory {
  const text = `${label} ${tags.join(" ")}`.toLowerCase();
  if (/(demon|devil|fiend|infernal)/.test(text)) return "demon";
  if (/(undead|skeleton|zombie|wraith|ghost|lich|grave)/.test(text)) return "undead";
  if (/(summon|familiar|bound|conjured)/.test(text)) return "summon";
  if (/(otherworld|void|alien|star|aether)/.test(text)) return "otherworldly";
  if (/(golem|construct|clockwork|automaton)/.test(text)) return "construct";
  if (/(wolf|bear|spider|beast|warg|serpent)/.test(text)) return "beast";
  return "mortal";
}

export function makeEncounterDefinition(
  world: World,
  locationId: Id | undefined,
  kind: EncounterKind,
  category: CreatureCategory,
  rng: Rng,
  options: EncounterSeedOptions = {}
): EncounterDefinition {
  const profile = creatureProfile(category);
  const settlement = chooseSettlement(world, rng, locationId);
  const danger = clamp(Math.round((options.danger ?? settlement?.threat ?? 24) + profile.threatBias + rng.int(-4, 8)), 1, 100);
  const name = options.name ?? `${profile.tags[0] ?? category} ${kind}`.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    id: makeId("encounter", world.tick * 1000 + danger + kind.length + category.length),
    kind,
    category,
    name,
    danger,
    locationId: settlement?.id ?? locationId,
    factionId: options.factionId ?? settlement?.factionId,
    tags: [...new Set([kind, category, ...profile.tags, ...(options.tags ?? [])])]
  };
}

export function ensureWorldPhase(world: World): WorldPhaseState {
  world.worldPhase ??= {
    current: "normal",
    changedTick: world.tick,
    hardMode: false,
    tags: ["normal"]
  };
  world.worldPhase.tags ??= [];
  return world.worldPhase;
}

export function deterministicEventCandidates(world: World): SpecialWorldEventKind[] {
  const phase = ensureWorldPhase(world);
  const candidates: SpecialWorldEventKind[] = [];
  if (world.day > 0 && world.day % 28 === 0) candidates.push("blood-moon");
  if (world.day > 0 && world.day % 45 === 0) candidates.push("holiday");
  if (world.day > 0 && world.day % 37 === 0) candidates.push("resource-bloom");
  if (!phase.hardMode && world.day >= 120) candidates.push("hard-mode-transition");
  if (world.day > 0 && world.day % 63 === 0) candidates.push("summoning-window");
  return candidates;
}

export function scheduleSpecialWorldEvent(world: World, kind: SpecialWorldEventKind, rng: Rng, options: WorldEventScheduleOptions = {}): SpecialWorldEventState {
  const template = templateFor(kind);
  const settlement = chooseSettlement(world, rng, options.locationId);
  const consequences = template.consequences.map((consequence) => ({ ...consequence, locationId: settlement?.id ?? options.locationId, tags: [...consequence.tags] }));
  const state: SpecialWorldEventState = {
    id: makeId("world-event", world.tick * 1000 + Object.keys(world.specialEvents ?? {}).length + kind.length),
    kind,
    name: template.name,
    phase: template.phase,
    startTick: world.tick,
    remainingTicks: Math.max(1, Math.round(options.durationTicks ?? template.durationTicks)),
    intensity: clamp(Math.round(options.intensity ?? template.intensity), 1, 100),
    locationId: settlement?.id ?? options.locationId,
    consequences,
    tags: [...new Set([...template.tags, ...(options.tags ?? [])])]
  };
  world.specialEvents ??= {};
  world.specialEvents[state.id] = state;
  const phase = ensureWorldPhase(world);
  phase.previous = phase.current;
  phase.current = state.phase;
  phase.changedTick = world.tick;
  phase.hardMode = phase.hardMode || state.phase === "hard-mode";
  phase.tags = [...new Set([...phase.tags, state.phase, ...state.tags])];
  event(world, "world", state.intensity >= 70 ? "high" : "medium", `${state.name} begins.`, [], [], state.locationId);
  return state;
}

export function applyWorldEventConsequences(world: World, state: SpecialWorldEventState, rng: Rng): WorldEventConsequence[] {
  const applied: WorldEventConsequence[] = [];
  world.encounterPressure ??= {};
  for (const consequence of state.consequences) {
    if (consequence.kind === "resource-spawn") {
      const feature = chooseFeature(world, rng, consequence.locationId);
      const settlement = chooseSettlement(world, rng, consequence.locationId);
      const resource = consequence.resource ?? "strange ore";
      if (feature) {
        addUnique(feature.resources, resource);
        feature.richness = clamp(feature.richness + consequence.magnitude * 4, 0, 100);
        feature.tags = [...new Set([...feature.tags, ...consequence.tags, state.kind])];
        consequence.featureId = feature.id;
      } else if (settlement) {
        addUnique(settlement.resources, resource);
        settlement.tags = [...new Set([...settlement.tags, ...consequence.tags, state.kind])];
      }
      applied.push({ ...consequence, resource });
    } else if (consequence.kind === "encounter-pressure" && consequence.encounterKind) {
      world.encounterPressure[consequence.encounterKind] = clamp((world.encounterPressure[consequence.encounterKind] ?? 0) + consequence.magnitude, 0, 100);
      applied.push({ ...consequence });
    } else if (consequence.kind === "settlement-modifier") {
      const settlement = chooseSettlement(world, rng, consequence.locationId);
      if (settlement) {
        if (consequence.tags.includes("unrest")) {
          settlement.unrest = clamp(settlement.unrest + consequence.magnitude, 0, 100);
        }
        if (consequence.tags.includes("threat")) {
          settlement.threat = clamp(settlement.threat + Math.max(0, consequence.magnitude), 0, 100);
        }
        if (consequence.tags.includes("prosperity")) {
          settlement.prosperity = clamp(settlement.prosperity + Math.abs(consequence.magnitude), 0, 100);
        }
      }
      applied.push({ ...consequence, locationId: settlement?.id ?? consequence.locationId });
    } else if (consequence.kind === "feature-modifier") {
      const feature = chooseFeature(world, rng, consequence.locationId);
      if (feature) {
        if (consequence.tags.includes("danger")) {
          feature.danger = clamp(feature.danger + consequence.magnitude, 0, 100);
        }
        if (consequence.tags.includes("richness")) {
          feature.richness = clamp(feature.richness + consequence.magnitude * 3, 0, 100);
        }
        feature.tags = [...new Set([...feature.tags, ...consequence.tags, state.kind])];
      }
      applied.push({ ...consequence, featureId: feature?.id ?? consequence.featureId });
    }
  }
  state.tags = [...new Set([...state.tags, "applied"])];
  return applied;
}

export function tickSpecialWorldEvents(world: World, rng: Rng): WorldEventTickResult {
  world.specialEvents ??= {};
  const phase = ensureWorldPhase(world);
  let expiredEvents = 0;
  let consequencesApplied = 0;
  for (const state of Object.values(world.specialEvents)) {
    if (!state.tags.includes("applied")) {
      consequencesApplied += applyWorldEventConsequences(world, state, rng).length;
    }
    state.remainingTicks -= 1;
    if (state.remainingTicks <= 0 && state.phase !== "hard-mode") {
      delete world.specialEvents[state.id];
      expiredEvents += 1;
      event(world, "world", "low", `${state.name} ends.`, [], [], state.locationId);
    }
  }
  const activeEvents = Object.keys(world.specialEvents).length;
  if (activeEvents === 0 && phase.current !== "normal" && !phase.hardMode) {
    phase.previous = phase.current;
    phase.current = "normal";
    phase.changedTick = world.tick;
    phase.tags = ["normal"];
  } else if (phase.hardMode) {
    phase.current = "hard-mode";
  }
  return { activeEvents, expiredEvents, consequencesApplied, phase: phase.current };
}

export function maybeScheduleDeterministicWorldEvent(world: World, rng: Rng): SpecialWorldEventState | undefined {
  const activeKinds = new Set(Object.values(world.specialEvents ?? {}).map((state) => state.kind));
  const kind = deterministicEventCandidates(world).find((candidate) => !activeKinds.has(candidate));
  return kind ? scheduleSpecialWorldEvent(world, kind, rng) : undefined;
}

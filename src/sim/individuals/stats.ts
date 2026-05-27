import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  ArchetypeKey,
  CoreStatBlock,
  CoreStatKey,
  DerivedStatBlock,
  DerivedStatKey,
  Person,
  QuestKind,
  SkillBlock,
  StatBlock,
  TraitBlock
} from "../types";

type BandAction = "rest" | "patrol" | "train" | "recruit";

export const coreStatKeys = ["physique", "finesse", "willpower"] as const;
export const derivedStatKeys = ["strength", "dexterity", "endurance", "intelligence", "wisdom", "perception", "charisma"] as const;

export const statLabels: Record<CoreStatKey | DerivedStatKey, string> = {
  physique: "Physique",
  finesse: "Finesse",
  willpower: "Will",
  strength: "Strength",
  dexterity: "Dexterity",
  endurance: "Endurance",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
  perception: "Perception",
  charisma: "Charisma"
};

export const archetypeInfo: Record<ArchetypeKey, { label: string; description: string; favoredStats: DerivedStatKey[] }> = {
  vanguard: {
    label: "Vanguard",
    description: "Hard-bodied front-line people who endure pressure and break it back.",
    favoredStats: ["strength", "endurance"]
  },
  duelist: {
    label: "Duelist",
    description: "Precise movers who turn timing, speed, and threat reading into survival.",
    favoredStats: ["dexterity", "perception"]
  },
  arcanist: {
    label: "Arcanist",
    description: "Pattern-minded casters whose force comes from will, study, and attention.",
    favoredStats: ["intelligence", "wisdom"]
  },
  medicant: {
    label: "Medicant",
    description: "Stubborn healers and warders who keep bodies and vows from failing.",
    favoredStats: ["wisdom", "endurance"]
  },
  pathfinder: {
    label: "Pathfinder",
    description: "Road-wise scouts who read terrain quickly and keep moving.",
    favoredStats: ["perception", "dexterity"]
  },
  envoy: {
    label: "Envoy",
    description: "Social operators who survive by judgment, pressure, and nerve.",
    favoredStats: ["charisma", "wisdom"]
  },
  laborer: {
    label: "Laborer",
    description: "Practical workers with durable bodies and habits made by necessity.",
    favoredStats: ["endurance", "strength"]
  }
};

const archetypeByRole: Record<Person["role"], ArchetypeKey> = {
  leader: "envoy",
  fighter: "vanguard",
  healer: "medicant",
  mage: "arcanist",
  scout: "pathfinder",
  commoner: "laborer"
};

const archetypeBias: Record<ArchetypeKey, Partial<Record<CoreStatKey, number>>> = {
  vanguard: { physique: 15, willpower: 7 },
  duelist: { finesse: 15, physique: 5 },
  arcanist: { willpower: 16, finesse: 5 },
  medicant: { willpower: 13, physique: 4 },
  pathfinder: { finesse: 13, physique: 6 },
  envoy: { willpower: 11, finesse: 6 },
  laborer: { physique: 12, willpower: 3 }
};

const roleBias: Record<Person["role"], Partial<Record<CoreStatKey, number>>> = {
  leader: { willpower: 9, physique: 3 },
  fighter: { physique: 10, finesse: 3 },
  healer: { willpower: 10 },
  mage: { willpower: 11, finesse: 2 },
  scout: { finesse: 10, physique: 3 },
  commoner: {}
};

function bounded(value: number): number {
  return clamp(Math.round(value), 1, 100);
}

function neutralCoreStats(): CoreStatBlock {
  return {
    physique: 50,
    finesse: 50,
    willpower: 50
  };
}

export function defaultArchetypeForRole(role: Person["role"]): ArchetypeKey {
  return archetypeByRole[role];
}

export function randomArchetype(rng: Rng, role: Person["role"]): ArchetypeKey {
  const base = archetypeByRole[role];
  const options: { value: ArchetypeKey; weight: number }[] = [
    { value: base, weight: 8 },
    { value: "vanguard", weight: role === "fighter" ? 5 : 2 },
    { value: "duelist", weight: role === "fighter" || role === "scout" ? 4 : 2 },
    { value: "arcanist", weight: role === "mage" ? 6 : 1 },
    { value: "medicant", weight: role === "healer" ? 6 : 1 },
    { value: "pathfinder", weight: role === "scout" ? 6 : 2 },
    { value: "envoy", weight: role === "leader" ? 6 : 2 },
    { value: "laborer", weight: role === "commoner" ? 6 : 1 }
  ];
  return rng.weighted(options);
}

export function randomCoreStats(rng: Rng, role: Person["role"], archetype: ArchetypeKey): CoreStatBlock {
  const core = {
    physique: rng.int(34, 64),
    finesse: rng.int(34, 64),
    willpower: rng.int(34, 64)
  } as CoreStatBlock;

  for (const key of coreStatKeys) {
    core[key] = bounded(core[key] + (archetypeBias[archetype][key] ?? 0) + (roleBias[role][key] ?? 0) + rng.int(-4, 5));
  }

  return core;
}

export function deriveStats(core: CoreStatBlock, traits: TraitBlock, skills: SkillBlock): DerivedStatBlock {
  const resolve = traits.bravery * 0.34 + traits.loyalty * 0.28 + traits.caution * 0.18 + traits.ambition * 0.2;
  const judgment = traits.caution * 0.28 + traits.mercy * 0.25 + traits.curiosity * 0.18 + traits.loyalty * 0.17 + skills.medicine * 0.12;
  const dexterity = bounded(core.finesse * 0.85 + core.physique * 0.15);
  const intelligence = bounded(core.willpower * 0.55 + core.finesse * 0.2 + traits.curiosity * 0.15 + skills.sorcery * 0.1);
  const wisdom = bounded(core.willpower * 0.62 + judgment * 0.26 + skills.diplomacy * 0.06 + skills.ward * 0.06);

  return {
    strength: bounded(core.physique * 0.8 + core.willpower * 0.2),
    dexterity,
    endurance: bounded(core.physique * 0.66 + core.willpower * 0.24 + resolve * 0.1),
    intelligence,
    wisdom,
    perception: bounded(dexterity * 0.36 + intelligence * 0.34 + wisdom * 0.14 + traits.curiosity * 0.1 + skills.survival * 0.06),
    charisma: bounded(
      core.willpower * 0.32 + wisdom * 0.22 + traits.loyalty * 0.12 + traits.mercy * 0.1 + traits.ambition * 0.08 + skills.diplomacy * 0.16
    )
  };
}

export function makeStats(core: CoreStatBlock, traits: TraitBlock, skills: SkillBlock): StatBlock {
  return {
    core,
    derived: deriveStats(core, traits, skills)
  };
}

export function ensureStats(person: Person, rng?: Rng): StatBlock {
  person.archetype ??= rng ? randomArchetype(rng, person.role) : defaultArchetypeForRole(person.role);
  const fallbackCore = rng ? randomCoreStats(rng, person.role, person.archetype) : neutralCoreStats();
  person.stats = person.stats ?? { core: fallbackCore, derived: deriveStats(fallbackCore, person.traits, person.skills) };

  for (const key of coreStatKeys) {
    person.stats.core[key] = bounded(person.stats.core[key] ?? fallbackCore[key]);
  }
  person.stats.derived = deriveStats(person.stats.core, person.traits, person.skills);
  return person.stats;
}

export function shiftCoreStats(person: Person, shift: Partial<Record<CoreStatKey, number>>): void {
  const stats = ensureStats(person);
  for (const key of coreStatKeys) {
    const delta = shift[key] ?? 0;
    if (delta !== 0) {
      stats.core[key] = bounded(stats.core[key] + delta);
    }
  }
  stats.derived = deriveStats(stats.core, person.traits, person.skills);
}

export function archetypeLabel(archetype: ArchetypeKey): string {
  return archetypeInfo[archetype]?.label ?? archetype;
}

function averageRelevant(stats: DerivedStatBlock, keys: DerivedStatKey[]): number {
  return keys.reduce((sum, key) => sum + stats[key], 0) / keys.length;
}

export function statQuestBias(person: Person, kind: QuestKind): number {
  const stats = ensureStats(person).derived;
  const relevant: Record<QuestKind, DerivedStatKey[]> = {
    defense: ["strength", "endurance", "wisdom"],
    delve: ["perception", "intelligence", "dexterity"],
    hunt: ["perception", "dexterity", "strength"],
    escort: ["endurance", "wisdom", "perception"],
    politics: ["charisma", "wisdom", "intelligence"]
  };
  return (averageRelevant(stats, relevant[kind]) - 50) * 0.34;
}

export function statActionBias(person: Person, action: BandAction): number {
  const stats = ensureStats(person).derived;
  if (action === "rest") {
    return (50 - stats.endurance) * 0.12 + (stats.wisdom - 50) * 0.05;
  }
  if (action === "patrol") {
    return ((stats.perception + stats.dexterity) / 2 - 50) * 0.26;
  }
  if (action === "train") {
    return ((stats.intelligence + stats.wisdom) / 2 - 50) * 0.22;
  }
  return ((stats.charisma + stats.wisdom) / 2 - 50) * 0.22;
}

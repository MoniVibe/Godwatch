import { clamp, makeId } from "../core/math";
import { ensureItemPowerCell, ensurePersonResources } from "../economy/power";
import type {
  AugmentationCompatibilityTag,
  AugmentationModifier,
  AugmentationRecord,
  AugmentationSideEffect,
  AugmentationUpkeep,
  AugmentationUpkeepChannel,
  BodyLocus,
  CoreStatKey,
  DerivedStatKey,
  Id,
  InjuryRecord,
  InjurySeverity,
  Item,
  Person,
  ResourcePoolKey,
  ScarRecord,
  ScarSeverity,
  SkillKey
} from "../types";

export type PersonUpkeepPool = ResourcePoolKey | "mana" | "vitality";

export type AugmentationDraft = Partial<AugmentationRecord> &
  Pick<AugmentationRecord, "id" | "name" | "kind" | "source" | "locus">;

export interface InjuryBurdenOptions {
  memoryWindow?: number;
}

export interface InjuryBurdenResult {
  burden: number;
  pain: number;
  mobilityPenalty: number;
  trauma: number;
  severity: InjurySeverity;
  reasons: string[];
  tags: string[];
}

export interface InjuryCreationOptions {
  tick?: number;
  source?: string;
  locus?: BodyLocus;
  minSeverity?: InjurySeverity;
  tags?: readonly string[];
}

export interface ScarCreationOptions {
  tick?: number;
  includeMemoryScars?: boolean;
  maxCreated?: number;
}

export interface AugmentationInstallOptions {
  tick?: number;
  allowSameLocus?: boolean;
  replacingInjuryIds?: readonly Id[];
  itemId?: Id;
  compatibilityTags?: readonly AugmentationCompatibilityTag[];
}

export interface AugmentationRemoveOptions {
  tick?: number;
  leaveScar?: boolean;
}

export interface AugmentationMutationResult {
  success: boolean;
  augmentation?: AugmentationRecord;
  removed?: AugmentationRecord;
  repaired?: number;
  reasons: string[];
}

export interface AugmentationEffectSummary {
  coreStatBonuses: Partial<Record<CoreStatKey, number>>;
  derivedStatBonuses: Partial<Record<DerivedStatKey, number>>;
  skillBonuses: Partial<Record<SkillKey, number>>;
  resourceBonuses: Partial<Record<ResourcePoolKey, number>>;
  resistanceBonuses: Record<string, number>;
  powerBonus: number;
  fatiguePenalty: number;
  moralePenalty: number;
  burdenOffset: number;
  sideEffects: AugmentationSideEffect[];
  activeIds: Id[];
  inactiveIds: Id[];
  notes: string[];
}

export interface AugmentationUpkeepOptions {
  tick?: number;
  scale?: number;
  allowFallback?: boolean;
  fallbackChannel?: PersonUpkeepPool;
}

export interface AugmentationUpkeepResult {
  augmentationId: Id;
  channel: AugmentationUpkeepChannel;
  required: boolean;
  paid: boolean;
  requested: number;
  spentFromPerson: Partial<Record<PersonUpkeepPool, number>>;
  spentFromItems: { itemId: Id; amount: number; remaining: number }[];
  shortfall: number;
  notes: string[];
}

export interface TickAugmentationsOptions {
  tick?: number;
  upkeepScale?: number;
  recordCurrentInjury?: boolean;
  scarSevereInjuries?: boolean;
}

export interface TickAugmentationsResult {
  tick: number;
  burden: InjuryBurdenResult;
  effects: AugmentationEffectSummary;
  upkeep: AugmentationUpkeepResult[];
  injuriesCreated: InjuryRecord[];
  scarsCreated: ScarRecord[];
  conditionChanged: { augmentationId: Id; condition: number }[];
  statusAdded: string[];
  notes: string[];
}

const injurySeverityRank: Record<InjurySeverity, number> = {
  minor: 1,
  moderate: 2,
  severe: 3,
  critical: 4,
  maiming: 5
};

const injuryRecoveryTicks: Record<InjurySeverity, number> = {
  minor: 3,
  moderate: 9,
  severe: 24,
  critical: 60,
  maiming: 0
};

const scarSeverityForInjury: Record<InjurySeverity, ScarSeverity> = {
  minor: "faint",
  moderate: "notable",
  severe: "deep",
  critical: "crippling",
  maiming: "legendary"
};

const statusBurden: Record<string, number> = {
  wounded: 26,
  bleeding: 20,
  "stone-bruised": 12,
  "wind-battered": 12,
  "road-worn": 8,
  exhausted: 14,
  "augmentation-pain": 10,
  "augmentation-strain": 12,
  "augmentation-low-power": 14
};

const coreStatKeys: CoreStatKey[] = ["physique", "finesse", "willpower"];
const derivedStatKeys: DerivedStatKey[] = ["strength", "dexterity", "endurance", "intelligence", "wisdom", "perception", "charisma"];
const skillKeys: SkillKey[] = ["blade", "ward", "sorcery", "medicine", "survival", "diplomacy", "command"];
const resourcePoolKeys: ResourcePoolKey[] = ["focus", "energy", "battery", "charge"];

function rounded(value: number, min: number, max: number): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function includesKey<T extends string>(keys: readonly T[], value: string): value is T {
  return keys.includes(value as T);
}

function hpRatio(person: Person): number {
  return person.maxHp > 0 ? clamp(person.hp / person.maxHp, 0, 1) : 0;
}

export function injurySeverityForBurden(burden: number): InjurySeverity {
  if (burden >= 82) return "maiming";
  if (burden >= 62) return "critical";
  if (burden >= 40) return "severe";
  if (burden >= 18) return "moderate";
  return "minor";
}

function burdenFloorForSeverity(severity: InjurySeverity): number {
  if (severity === "maiming") return 82;
  if (severity === "critical") return 62;
  if (severity === "severe") return 40;
  if (severity === "moderate") return 18;
  return 0;
}

function scarBurden(severity: ScarSeverity): number {
  if (severity === "legendary") return 26;
  if (severity === "crippling") return 20;
  if (severity === "deep") return 13;
  if (severity === "notable") return 7;
  return 3;
}

function inferLocus(tags: readonly string[]): BodyLocus {
  const text = tags.join(" ").toLowerCase();
  if (text.includes("mind") || text.includes("compulsion") || text.includes("memory")) return "mind";
  if (text.includes("soul") || text.includes("curse")) return "soul";
  if (text.includes("eye") || text.includes("sight")) return "eye";
  if (text.includes("spine") || text.includes("back")) return "spine";
  if (text.includes("leg") || text.includes("road") || text.includes("wind")) return "leg";
  if (text.includes("arm") || text.includes("blade") || text.includes("hand")) return "arm";
  if (text.includes("bleeding") || text.includes("blood")) return "blood";
  if (text.includes("stone") || text.includes("bruise")) return "torso";
  return "whole-body";
}

function activeReplacementIds(person: Person): Set<Id> {
  return new Set(
    (person.augmentations ?? [])
      .filter((augmentation) => augmentation.active && augmentation.condition > 0)
      .flatMap((augmentation) => augmentation.replacedInjuryIds ?? [])
  );
}

export function deriveInjuryBurden(person: Person, options: InjuryBurdenOptions = {}): InjuryBurdenResult {
  const reasons: string[] = [];
  const tags: string[] = ["injury-burden"];
  const ratio = person.alive ? hpRatio(person) : 0;
  const hpPressure = person.alive ? (1 - ratio) * 42 + (ratio < 0.35 ? 18 : 0) + (ratio < 0.16 ? 18 : 0) : 100;
  if (hpPressure >= 12) {
    reasons.push(ratio <= 0 ? "dead-or-incapacitated" : "low-health");
    tags.push("low-health");
  }

  let statusPressure = 0;
  for (const status of person.status ?? []) {
    const pressure = statusBurden[status] ?? 0;
    statusPressure += pressure;
    if (pressure > 0) {
      reasons.push(`status:${status}`);
      tags.push(status);
    }
  }

  const memoryWindow = options.memoryWindow ?? 8;
  let memoryPressure = 0;
  let trauma = 0;
  for (const memory of (person.memories ?? []).slice(0, Math.max(0, memoryWindow))) {
    const memoryTags = memory.tags ?? [];
    const nearDeath = memoryTags.some((tag) => ["near-death", "death", "defeat", "combat", "wound", "bleeding"].includes(tag));
    if (!nearDeath) {
      continue;
    }
    const pressure = Math.max(0, Math.abs(Math.min(0, memory.weight)) * 1.8 + (memoryTags.includes("near-death") ? 16 : 0) + (memoryTags.includes("death") ? 8 : 0));
    memoryPressure += pressure;
    trauma += pressure * 0.7;
    reasons.push(memoryTags.includes("near-death") ? "memory:near-death" : "memory:combat");
    tags.push(...memoryTags);
  }

  const replacedIds = activeReplacementIds(person);
  let injuryPressure = 0;
  let pain = 0;
  let mobilityPenalty = 0;
  for (const injury of person.injuries ?? []) {
    const supported = replacedIds.has(injury.id);
    const supportScale = supported ? 0.38 : 1;
    injuryPressure += injury.burden * supportScale;
    pain += injury.pain * supportScale;
    mobilityPenalty += injury.mobilityPenalty * supportScale;
    tags.push(injury.severity, injury.locus, ...injury.tags);
    if (supported) {
      reasons.push(`supported:${injury.locus}`);
    } else {
      reasons.push(`injury:${injury.locus}`);
    }
  }

  let scarPressure = 0;
  for (const scar of person.scars ?? []) {
    scarPressure += scar.burden * 0.45;
    pain += scar.severity === "crippling" || scar.severity === "legendary" ? scar.burden * 0.16 : 0;
    tags.push(scar.severity, scar.locus, ...scar.tags);
  }

  const burden = rounded(hpPressure + statusPressure + memoryPressure + injuryPressure + scarPressure, 0, 100);
  const severity = injurySeverityForBurden(burden);
  return {
    burden,
    pain: rounded(pain + hpPressure * 0.26 + statusPressure * 0.22, 0, 100),
    mobilityPenalty: rounded(mobilityPenalty + (person.status ?? []).filter((status) => ["road-worn", "stone-bruised", "wind-battered"].includes(status)).length * 4, 0, 100),
    trauma: rounded(trauma, 0, 100),
    severity,
    reasons: uniqueText(reasons).slice(0, 10),
    tags: uniqueText([severity, ...tags]).slice(0, 16)
  };
}

export function createInjuryFromPersonState(person: Person, options: InjuryCreationOptions = {}): InjuryRecord | undefined {
  const burden = deriveInjuryBurden(person);
  const minSeverity = options.minSeverity ?? "moderate";
  if (injurySeverityRank[burden.severity] < injurySeverityRank[minSeverity]) {
    return undefined;
  }

  const tick = options.tick ?? 0;
  const locus = options.locus ?? inferLocus([...burden.tags, ...(person.status ?? [])]);
  const severity = burden.severity;
  const index = (person.injuries?.length ?? 0) + (person.scars?.length ?? 0) + tick + person.id.length;
  return {
    id: makeId("injury", index),
    label: `${severity} ${locus} injury`,
    locus,
    severity,
    burden: clamp(Math.max(burdenFloorForSeverity(severity), burden.burden), 0, 100),
    pain: burden.pain,
    mobilityPenalty: locus === "leg" || locus === "spine" || locus === "whole-body" ? Math.max(burden.mobilityPenalty, Math.round(burden.burden * 0.22)) : burden.mobilityPenalty,
    createdTick: tick,
    source: options.source,
    remainingTicks: injuryRecoveryTicks[severity] || undefined,
    permanent: severity === "maiming",
    tags: uniqueText(["injury", severity, locus, ...(options.tags ?? []), ...burden.tags]).slice(0, 14)
  };
}

export function recordInjuryFromPersonState(person: Person, options: InjuryCreationOptions = {}): InjuryRecord | undefined {
  const injury = createInjuryFromPersonState(person, options);
  if (!injury) {
    return undefined;
  }
  person.injuries ??= [];
  const duplicate = person.injuries.some((existing) => existing.createdTick === injury.createdTick && existing.locus === injury.locus && existing.severity === injury.severity);
  if (!duplicate) {
    person.injuries.unshift(injury);
    person.injuries = person.injuries.slice(0, 12);
  }
  return duplicate ? undefined : injury;
}

export function createScarFromInjury(person: Person, injury: InjuryRecord, options: ScarCreationOptions = {}): ScarRecord | undefined {
  if (injurySeverityRank[injury.severity] < injurySeverityRank.severe && !injury.permanent) {
    return undefined;
  }
  const severity = scarSeverityForInjury[injury.severity];
  const tick = options.tick ?? injury.createdTick;
  return {
    id: `scar:${person.id}:${injury.id}`,
    label: `${severity} scar from ${injury.label}`,
    locus: injury.locus,
    severity,
    burden: scarBurden(severity),
    createdTick: tick,
    fromInjuryId: injury.id,
    tags: uniqueText(["scar", severity, injury.locus, ...injury.tags]).slice(0, 12)
  };
}

function createScarFromMemory(person: Person, memoryId: Id, label: string, tick: number, tags: readonly string[], weight: number): ScarRecord {
  const severity: ScarSeverity = tags.includes("near-death") || weight <= -8 ? "deep" : "notable";
  const locus = inferLocus(tags);
  return {
    id: `scar:${person.id}:memory:${memoryId}`,
    label: `${severity} scar from ${label}`,
    locus,
    severity,
    burden: scarBurden(severity),
    createdTick: tick,
    memoryId,
    tags: uniqueText(["scar", severity, locus, ...tags]).slice(0, 12)
  };
}

export function createScarsFromSevereWounds(person: Person, options: ScarCreationOptions = {}): ScarRecord[] {
  person.scars ??= [];
  const existingIds = new Set(person.scars.map((scar) => scar.id));
  const created: ScarRecord[] = [];
  const maxCreated = options.maxCreated ?? 4;

  for (const injury of person.injuries ?? []) {
    if (created.length >= maxCreated) {
      break;
    }
    const scar = createScarFromInjury(person, injury, options);
    if (scar && !existingIds.has(scar.id)) {
      person.scars.unshift(scar);
      existingIds.add(scar.id);
      created.push(scar);
    }
  }

  if (options.includeMemoryScars ?? true) {
    for (const memory of person.memories ?? []) {
      if (created.length >= maxCreated) {
        break;
      }
      const tags = memory.tags ?? [];
      if (!tags.some((tag) => ["near-death", "wound", "bleeding"].includes(tag))) {
        continue;
      }
      const scar = createScarFromMemory(person, memory.id, memory.label, options.tick ?? memory.tick, tags, memory.weight);
      if (!existingIds.has(scar.id)) {
        person.scars.unshift(scar);
        existingIds.add(scar.id);
        created.push(scar);
      }
    }
  }

  person.scars = person.scars.slice(0, 16);
  return created;
}

function personCompatibilityTags(person: Person): AugmentationCompatibilityTag[] {
  const tags: AugmentationCompatibilityTag[] = ["organic", `ancestry:${person.ancestry}`];
  if (person.skills.sorcery >= 45 || person.skills.ward >= 45) {
    tags.push("arcane");
  }
  if (person.skills.medicine >= 45 || person.skills.survival >= 45) {
    tags.push("living-tissue");
  }
  if (person.status.includes("aether-touched")) {
    tags.push("aetheric");
  }
  for (const augmentation of person.augmentations ?? []) {
    tags.push(...augmentation.compatibilityTags);
  }
  return uniqueText(tags) as AugmentationCompatibilityTag[];
}

function normalizeSideEffect(effect: AugmentationSideEffect): AugmentationSideEffect {
  return {
    ...effect,
    magnitude: Math.max(0, effect.magnitude),
    tags: uniqueText(effect.tags ?? [])
  };
}

function normalizeModifier(effect: AugmentationModifier): AugmentationModifier {
  return {
    ...effect,
    magnitude: Number.isFinite(effect.magnitude) ? effect.magnitude : 0,
    tags: uniqueText(effect.tags ?? [])
  };
}

function defaultPowered(kind: AugmentationRecord["kind"], upkeep: AugmentationUpkeep | undefined): boolean {
  return Boolean(upkeep) || kind === "bionic" || kind === "powered-armor" || kind === "exoskeleton" || kind === "arcane-graft";
}

function normalizeUpkeep(draft: AugmentationDraft, powered: boolean): AugmentationUpkeep | undefined {
  if (draft.upkeep) {
    return {
      ...draft.upkeep,
      amount: Math.max(0, draft.upkeep.amount),
      intervalTicks: Math.max(1, draft.upkeep.intervalTicks ?? 1),
      tags: uniqueText(draft.upkeep.tags ?? [])
    };
  }
  if (!powered) {
    return undefined;
  }
  return {
    channel: draft.kind === "powered-armor" ? "item-cell" : "energy",
    amount: draft.kind === "powered-armor" ? 2 : 1,
    itemId: draft.itemId,
    required: true,
    intervalTicks: 1,
    tags: ["augmentation-upkeep", draft.kind]
  };
}

function normalizeAugmentation(draft: AugmentationDraft, options: AugmentationInstallOptions = {}): AugmentationRecord {
  const maxCondition = Math.max(1, rounded(draft.maxCondition ?? 100, 1, 100));
  const condition = rounded(draft.condition ?? maxCondition, 0, maxCondition);
  const powered = draft.powered ?? defaultPowered(draft.kind, draft.upkeep);
  const upkeep = normalizeUpkeep({ ...draft, itemId: options.itemId ?? draft.itemId }, powered);
  const compatibilityTags = uniqueText([
    ...(draft.compatibilityTags ?? []),
    ...(options.compatibilityTags ?? []),
    draft.kind,
    draft.source,
    `source:${draft.source}`,
    `slot:${draft.locus}`
  ]) as AugmentationCompatibilityTag[];
  return {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    source: draft.source,
    locus: draft.locus,
    installedTick: draft.installedTick ?? options.tick ?? 0,
    condition,
    maxCondition,
    powered,
    active: draft.active ?? condition > 0,
    effects: (draft.effects ?? []).map(normalizeModifier),
    sideEffects: (draft.sideEffects ?? []).map(normalizeSideEffect),
    compatibilityTags,
    incompatibleTags: draft.incompatibleTags ? ([...draft.incompatibleTags] as AugmentationCompatibilityTag[]) : undefined,
    upkeep,
    replacedInjuryIds: uniqueText([...(draft.replacedInjuryIds ?? []), ...(options.replacingInjuryIds ?? [])]),
    itemId: options.itemId ?? draft.itemId,
    tags: uniqueText(["augmentation", draft.kind, draft.source, draft.locus, ...(draft.tags ?? [])])
  };
}

export function installAugmentation(person: Person, draft: AugmentationDraft, options: AugmentationInstallOptions = {}): AugmentationMutationResult {
  person.augmentations ??= [];
  const augmentation = normalizeAugmentation(draft, options);
  const reasons: string[] = [];
  if (person.augmentations.some((existing) => existing.id === augmentation.id)) {
    return { success: false, augmentation, reasons: ["augmentation id already installed"] };
  }
  if (!options.allowSameLocus && person.augmentations.some((existing) => existing.active && existing.locus === augmentation.locus)) {
    return { success: false, augmentation, reasons: [`active augmentation already occupies ${augmentation.locus}`] };
  }
  const personTags = new Set(personCompatibilityTags(person));
  const incompatible = (augmentation.incompatibleTags ?? []).filter((tag) => personTags.has(tag));
  if (incompatible.length > 0) {
    reasons.push(`incompatible tags: ${incompatible.join(", ")}`);
  }
  if (augmentation.condition <= 0) {
    reasons.push("augmentation condition is depleted");
  }
  if (reasons.length > 0) {
    return { success: false, augmentation, reasons };
  }

  person.augmentations.unshift(augmentation);
  person.augmentations = person.augmentations.slice(0, 12);
  return { success: true, augmentation, reasons: ["installed"] };
}

export function removeAugmentation(person: Person, augmentationId: Id, options: AugmentationRemoveOptions = {}): AugmentationMutationResult {
  const augmentations = person.augmentations ?? [];
  const index = augmentations.findIndex((augmentation) => augmentation.id === augmentationId);
  if (index === -1) {
    return { success: false, reasons: ["augmentation not found"] };
  }

  const [removed] = augmentations.splice(index, 1);
  if (options.leaveScar) {
    person.scars ??= [];
    const severity: ScarSeverity = removed.condition <= removed.maxCondition * 0.25 ? "deep" : "notable";
    person.scars.unshift({
      id: `scar:${person.id}:removed:${removed.id}`,
      label: `${severity} scar from removing ${removed.name}`,
      locus: removed.locus,
      severity,
      burden: scarBurden(severity),
      createdTick: options.tick ?? 0,
      tags: uniqueText(["scar", "augmentation-removal", removed.kind, removed.locus])
    });
    person.scars = person.scars.slice(0, 16);
  }
  return { success: true, removed, reasons: ["removed"] };
}

export function repairAugmentation(person: Person, augmentationId: Id, amount: number): AugmentationMutationResult {
  const augmentation = (person.augmentations ?? []).find((candidate) => candidate.id === augmentationId);
  if (!augmentation) {
    return { success: false, reasons: ["augmentation not found"] };
  }
  const before = augmentation.condition;
  augmentation.condition = clamp(augmentation.condition + Math.max(0, Math.round(amount)), 0, augmentation.maxCondition);
  if (augmentation.condition > 0 && !augmentation.upkeep?.required) {
    augmentation.active = true;
  }
  return { success: augmentation.condition > before, augmentation, repaired: augmentation.condition - before, reasons: ["repaired"] };
}

function addToPartialRecord<T extends string>(record: Partial<Record<T, number>>, key: T, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function addToRecord(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function conditionScale(augmentation: AugmentationRecord): number {
  return augmentation.maxCondition > 0 ? clamp(augmentation.condition / augmentation.maxCondition, 0, 1) : 0;
}

export function computeAugmentationEffects(person: Person): AugmentationEffectSummary {
  const summary: AugmentationEffectSummary = {
    coreStatBonuses: {},
    derivedStatBonuses: {},
    skillBonuses: {},
    resourceBonuses: {},
    resistanceBonuses: {},
    powerBonus: 0,
    fatiguePenalty: 0,
    moralePenalty: 0,
    burdenOffset: 0,
    sideEffects: [],
    activeIds: [],
    inactiveIds: [],
    notes: []
  };

  const injuriesById = new Map((person.injuries ?? []).map((injury) => [injury.id, injury]));
  for (const augmentation of person.augmentations ?? []) {
    const scale = conditionScale(augmentation);
    const active = augmentation.active && scale > 0;
    if (!active) {
      summary.inactiveIds.push(augmentation.id);
      if (augmentation.powered) {
        summary.fatiguePenalty += 2;
        summary.notes.push(`${augmentation.name} is dead weight without power`);
      }
      continue;
    }

    summary.activeIds.push(augmentation.id);
    for (const effect of augmentation.effects) {
      if (effect.requiresPower && !augmentation.powered) {
        continue;
      }
      const amount = Math.round(effect.magnitude * scale);
      if (amount === 0) {
        continue;
      }
      if (effect.kind === "core-stat" && includesKey(coreStatKeys, effect.target)) {
        addToPartialRecord(summary.coreStatBonuses, effect.target, amount);
      } else if (effect.kind === "derived-stat" && includesKey(derivedStatKeys, effect.target)) {
        addToPartialRecord(summary.derivedStatBonuses, effect.target, amount);
      } else if (effect.kind === "skill" && includesKey(skillKeys, effect.target)) {
        addToPartialRecord(summary.skillBonuses, effect.target, amount);
      } else if (effect.kind === "resource" && includesKey(resourcePoolKeys, effect.target)) {
        addToPartialRecord(summary.resourceBonuses, effect.target, amount);
      } else if (effect.kind === "resistance") {
        addToRecord(summary.resistanceBonuses, effect.target, amount);
      } else if (effect.kind === "power") {
        summary.powerBonus += amount;
      } else if (effect.kind === "morale") {
        summary.moralePenalty -= amount;
      } else if (effect.kind === "fatigue") {
        summary.fatiguePenalty -= amount;
      }
    }

    for (const sideEffect of augmentation.sideEffects) {
      if (sideEffect.threshold !== undefined && scale > sideEffect.threshold) {
        continue;
      }
      const stressScale = 1 + Math.max(0, 0.55 - scale);
      const magnitude = Math.round(sideEffect.magnitude * stressScale);
      if (magnitude <= 0) {
        continue;
      }
      const applied = { ...sideEffect, magnitude };
      summary.sideEffects.push(applied);
      if (sideEffect.kind === "fatigue" || sideEffect.kind === "overheat" || sideEffect.kind === "maintenance-debt") {
        summary.fatiguePenalty += magnitude;
      }
      if (sideEffect.kind === "pain" || sideEffect.kind === "rejection" || sideEffect.kind === "identity-drift") {
        summary.moralePenalty += Math.ceil(magnitude * 0.5);
      }
    }

    for (const injuryId of augmentation.replacedInjuryIds ?? []) {
      const injury = injuriesById.get(injuryId);
      if (injury) {
        summary.burdenOffset += Math.round(injury.burden * 0.62 * scale);
      }
    }
  }

  summary.powerBonus = Math.round(summary.powerBonus);
  summary.fatiguePenalty = rounded(summary.fatiguePenalty, -100, 100);
  summary.moralePenalty = rounded(summary.moralePenalty, -100, 100);
  summary.burdenOffset = rounded(summary.burdenOffset, 0, 100);
  summary.sideEffects = summary.sideEffects.slice(0, 12);
  summary.notes = uniqueText(summary.notes).slice(0, 8);
  return summary;
}

export const computeAugmentationBonuses = computeAugmentationEffects;

function carriedItems(person: Person): Item[] {
  const items = [
    person.equipment.weapon,
    person.equipment.armor,
    person.equipment.trinket,
    ...(person.inventory ?? [])
  ].filter((item): item is Item => Boolean(item));
  const seen = new Set<Id>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function itemForUpkeep(person: Person, augmentation: AugmentationRecord, upkeep: AugmentationUpkeep): Item | undefined {
  const itemId = upkeep.itemId ?? augmentation.itemId;
  const items = carriedItems(person);
  if (itemId) {
    return items.find((item) => item.id === itemId);
  }
  if (augmentation.kind === "powered-armor" && person.equipment.armor) {
    return person.equipment.armor;
  }
  return items.find((item) => item.powerCell || item.tags.includes("power-armor") || item.tags.includes("battery") || item.tags.includes("aetheric"));
}

function spendPersonPool(person: Person, pool: PersonUpkeepPool, amount: number, tick: number): number {
  if (amount <= 0) {
    return 0;
  }
  if (pool === "mana") {
    const spent = Math.min(person.mana, amount);
    person.mana = clamp(person.mana - spent, 0, person.maxMana);
    return spent;
  }
  if (pool === "vitality") {
    const spendable = Math.max(0, person.hp - 1);
    const spent = Math.min(spendable, amount);
    person.hp = clamp(person.hp - spent, 1, person.maxHp);
    return spent;
  }
  const resources = ensurePersonResources(person, tick);
  const resource = pool === "battery" ? resources.battery : resources[pool];
  if (!resource) {
    return 0;
  }
  const spent = Math.min(resource.current, amount);
  resource.current = clamp(resource.current - spent, 0, resource.max);
  return spent;
}

function dueAmount(upkeep: AugmentationUpkeep, tick: number | undefined, scale: number): number {
  const interval = Math.max(1, upkeep.intervalTicks ?? 1);
  if (tick !== undefined && upkeep.lastPaidTick !== undefined && tick - upkeep.lastPaidTick < interval) {
    return 0;
  }
  return Math.max(0, upkeep.amount * Math.max(0, scale));
}

export function payAugmentationUpkeep(
  person: Person,
  augmentation: AugmentationRecord,
  options: AugmentationUpkeepOptions = {}
): AugmentationUpkeepResult | undefined {
  const upkeep = augmentation.upkeep;
  if (!upkeep || !augmentation.powered || augmentation.condition <= 0) {
    return undefined;
  }

  const tick = options.tick ?? 0;
  const requested = dueAmount(upkeep, options.tick, options.scale ?? 1);
  const result: AugmentationUpkeepResult = {
    augmentationId: augmentation.id,
    channel: upkeep.channel,
    required: upkeep.required,
    paid: true,
    requested,
    spentFromPerson: {},
    spentFromItems: [],
    shortfall: 0,
    notes: []
  };
  if (requested <= 0) {
    result.notes.push("upkeep not due");
    return result;
  }

  let remaining = requested;
  if (upkeep.channel === "item-cell") {
    const item = itemForUpkeep(person, augmentation, upkeep);
    if (item) {
      const cell = ensureItemPowerCell(item);
      const spent = Math.min(cell.charge, remaining);
      cell.charge = clamp(cell.charge - spent, 0, cell.capacity);
      remaining -= spent;
      result.spentFromItems.push({ itemId: item.id, amount: spent, remaining: cell.charge });
    } else {
      result.notes.push("no item power cell found");
    }
    if (remaining > 0 && (options.allowFallback ?? true)) {
      const fallback = options.fallbackChannel ?? "energy";
      const spent = spendPersonPool(person, fallback, remaining, tick);
      remaining -= spent;
      result.spentFromPerson[fallback] = (result.spentFromPerson[fallback] ?? 0) + spent;
    }
  } else if (upkeep.channel === "mana" || upkeep.channel === "vitality" || includesKey(resourcePoolKeys, upkeep.channel)) {
    const spent = spendPersonPool(person, upkeep.channel, remaining, tick);
    remaining -= spent;
    result.spentFromPerson[upkeep.channel] = (result.spentFromPerson[upkeep.channel] ?? 0) + spent;
  }

  result.shortfall = Math.max(0, remaining);
  result.paid = result.shortfall <= 0;
  if (result.paid) {
    upkeep.lastPaidTick = tick;
    augmentation.active = true;
    result.notes.push("upkeep paid");
  } else {
    result.notes.push("upkeep shortfall");
    if (upkeep.required) {
      augmentation.active = false;
    }
  }
  return result;
}

function addStatus(person: Person, status: string, added: string[]): void {
  if (!person.status.includes(status)) {
    person.status = [...person.status, status];
    added.push(status);
  }
}

function clearAugmentationStatuses(person: Person): void {
  person.status = person.status.filter(
    (status) => !["augmentation-pain", "augmentation-strain", "augmentation-low-power", "augmentation-rejection", "augmentation-maintenance"].includes(status)
  );
}

function statusForSideEffect(effect: AugmentationSideEffect): string | undefined {
  if (effect.kind === "pain") return "augmentation-pain";
  if (effect.kind === "fatigue" || effect.kind === "overheat") return "augmentation-strain";
  if (effect.kind === "low-power") return "augmentation-low-power";
  if (effect.kind === "rejection" || effect.kind === "infection") return "augmentation-rejection";
  if (effect.kind === "maintenance-debt" || effect.kind === "instability") return "augmentation-maintenance";
  return undefined;
}

export function tickAugmentations(person: Person, options: TickAugmentationsOptions = {}): TickAugmentationsResult {
  const tick = options.tick ?? person.resources?.lastUpdatedTick ?? 0;
  person.injuries ??= [];
  person.scars ??= [];
  person.augmentations ??= [];
  clearAugmentationStatuses(person);

  const statusAdded: string[] = [];
  const notes: string[] = [];
  const injuriesCreated: InjuryRecord[] = [];
  if (options.recordCurrentInjury) {
    const injury = recordInjuryFromPersonState(person, { tick, source: "augmentation-tick" });
    if (injury) {
      injuriesCreated.push(injury);
    }
  }

  const scarsCreated = options.scarSevereInjuries ?? true ? createScarsFromSevereWounds(person, { tick }) : [];
  const upkeep = person.augmentations
    .map((augmentation) => payAugmentationUpkeep(person, augmentation, { tick, scale: options.upkeepScale ?? 1 }))
    .filter((result): result is AugmentationUpkeepResult => Boolean(result));

  const conditionChanged: { augmentationId: Id; condition: number }[] = [];
  for (const result of upkeep) {
    if (result.shortfall <= 0) {
      continue;
    }
    addStatus(person, "augmentation-low-power", statusAdded);
    const augmentation = person.augmentations.find((candidate) => candidate.id === result.augmentationId);
    if (augmentation) {
      const before = augmentation.condition;
      augmentation.condition = clamp(augmentation.condition - Math.ceil(result.shortfall * 2), 0, augmentation.maxCondition);
      if (augmentation.condition !== before) {
        conditionChanged.push({ augmentationId: augmentation.id, condition: augmentation.condition });
      }
    }
  }

  const effects = computeAugmentationEffects(person);
  for (const effect of effects.sideEffects) {
    const status = statusForSideEffect(effect);
    if (status) {
      addStatus(person, status, statusAdded);
    }
  }
  if (effects.fatiguePenalty > 0 || upkeep.some((result) => result.shortfall > 0)) {
    const shortfallFatigue = upkeep.reduce((sum, result) => sum + result.shortfall * 3, 0);
    person.fatigue = rounded(person.fatigue + effects.fatiguePenalty + shortfallFatigue, 0, 100);
    addStatus(person, "augmentation-strain", statusAdded);
  }
  if (effects.moralePenalty > 0) {
    person.morale = rounded(person.morale - effects.moralePenalty, 0, 100);
  }
  if (effects.activeIds.length === 0 && person.augmentations.length > 0) {
    notes.push("no active augmentations after upkeep");
  }

  const burden = deriveInjuryBurden(person);
  return {
    tick,
    burden,
    effects,
    upkeep,
    injuriesCreated,
    scarsCreated,
    conditionChanged,
    statusAdded: uniqueText(statusAdded),
    notes: uniqueText(notes)
  };
}

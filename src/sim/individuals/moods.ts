import { average, clamp } from "../core/math";
import type {
  Id,
  LoyaltyAnchor,
  LoyaltyConflict,
  LoyaltyConflictSeverity,
  Memory,
  MoodKind,
  MoraleStateKind,
  Organization,
  Person,
  PersonEmotionalState,
  PersonLoyaltyState,
  RelationStance,
  RelationStanceKind,
  StressResolveState,
  World
} from "../types";

export interface EmotionalStateOptions {
  tick?: number;
  previous?: PersonEmotionalState;
  memoryWindow?: number;
  extraStress?: number;
  extraResolve?: number;
  drivers?: readonly string[];
}

export interface MoodScoreInput {
  valence: number;
  stress: number;
  resolve: number;
  arousal: number;
  morale: number;
  compelled?: boolean;
  wounded?: boolean;
  grieving?: boolean;
  fatigued?: boolean;
}

export interface RelationStanceOptions {
  relation?: number;
  trust?: number;
  suspicion?: number;
  membershipOverlap?: readonly Id[];
}

export interface LoyaltyDerivationOptions {
  tick?: number;
  includeHiddenMemberships?: boolean;
  maxConflicts?: number;
}

export interface SocialEmotionalTickResult {
  emotionalState: PersonEmotionalState;
  loyalty: PersonLoyaltyState;
}

interface EmotionalInputs {
  stress: number;
  resolve: number;
  valence: number;
  arousal: number;
  pressure: number;
  recovery: number;
  drivers: string[];
  tags: string[];
  compelled: boolean;
  wounded: boolean;
  grieving: boolean;
  fatigued: boolean;
}

interface MemoryTone {
  positive: number;
  negative: number;
  drivers: string[];
  grieving: boolean;
}

interface StatusTone {
  stress: number;
  relief: number;
  drivers: string[];
  wounded: boolean;
  grieving: boolean;
}

interface ResourceTone {
  strain: number;
  recovery: number;
  drivers: string[];
}

interface TensionResult {
  tension: number;
  reasons: string[];
}

const stressfulStatusWeights: Record<string, number> = {
  wounded: 18,
  "item-cursed": 18,
  "road-worn": 8,
  "stone-bruised": 10,
  "wind-battered": 10,
  orphan: 12,
  ward: 6,
  "war-ward": 16,
  "soul-debt": 14,
  "aether-touched": 8,
  bleeding: 16,
  haunted: 12,
  "hungry-iron": 10
};

const relievingStatusWeights: Record<string, number> = {
  blessed: 18,
  braced: 8,
  warded: 8,
  adopted: 6,
  "birthright-stirred": 6
};

function rounded(value: number, min: number, max: number): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function scoreTag(score: number, positiveTag: string, negativeTag: string): string | undefined {
  if (score >= 12) {
    return positiveTag;
  }
  if (score <= -12) {
    return negativeTag;
  }
  return undefined;
}

function memoryTagDriver(memory: Memory): string | undefined {
  const priorityTag = memory.tags.find((tag) =>
    [
      "combat",
      "death",
      "defeat",
      "victory",
      "ward",
      "orphan",
      "deception",
      "mind-control",
      "blessing",
      "lesson",
      "family",
      "relation",
      "quest"
    ].includes(tag)
  );
  return priorityTag ? `memory:${priorityTag}` : undefined;
}

function memoryTone(memories: readonly Memory[], window: number): MemoryTone {
  let positive = 0;
  let negative = 0;
  let grieving = false;
  const drivers: string[] = [];
  const recent = memories.slice(0, Math.max(0, window));

  recent.forEach((memory, index) => {
    const recency = 1 + Math.max(0, recent.length - index) / Math.max(1, recent.length) * 0.35;
    const value = memory.weight * recency;
    if (value >= 0) {
      positive += value;
    } else {
      negative += Math.abs(value);
    }
    if (memory.tags.some((tag) => ["death", "grief", "orphan", "war-ward"].includes(tag))) {
      negative += 3;
      grieving = true;
    }
    if (memory.tags.some((tag) => ["victory", "blessing", "lesson", "aid"].includes(tag))) {
      positive += 2;
    }
    const driver = memoryTagDriver(memory);
    if (driver) {
      drivers.push(driver);
    }
  });

  return { positive, negative, drivers: uniqueText(drivers).slice(0, 5), grieving };
}

function statusTone(statuses: readonly string[]): StatusTone {
  let stress = 0;
  let relief = 0;
  let wounded = false;
  let grieving = false;
  const drivers: string[] = [];

  for (const status of statuses) {
    const stressWeight = stressfulStatusWeights[status] ?? 0;
    const reliefWeight = relievingStatusWeights[status] ?? 0;
    stress += stressWeight;
    relief += reliefWeight;
    if (stressWeight > 0) {
      drivers.push(`status:${status}`);
    }
    if (reliefWeight > 0) {
      drivers.push(`relief:${status}`);
    }
    wounded ||= ["wounded", "bleeding", "stone-bruised", "wind-battered"].includes(status);
    grieving ||= ["orphan", "war-ward"].includes(status);
  }

  return { stress, relief, drivers: uniqueText(drivers).slice(0, 5), wounded, grieving };
}

function fraction(current: number, max: number): number {
  return max > 0 ? clamp(current / max, 0, 1) : 0;
}

function resourceTone(person: Person): ResourceTone {
  const pools = [
    { key: "focus", pool: person.resources?.focus },
    { key: "energy", pool: person.resources?.energy },
    { key: "charge", pool: person.resources?.charge },
    { key: "battery", pool: person.resources?.battery }
  ] as const;
  const deficits: number[] = [];
  const readiness: number[] = [];
  const drivers: string[] = [];

  for (const item of pools) {
    if (!item.pool) {
      continue;
    }
    const ready = fraction(item.pool.current, item.pool.max);
    const deficit = 1 - ready;
    readiness.push(ready);
    deficits.push(deficit);
    if (deficit >= 0.55) {
      drivers.push(`low-${item.key}`);
    }
  }

  if (deficits.length === 0) {
    return { strain: 0, recovery: 0, drivers: [] };
  }

  return {
    strain: average(deficits) * 32,
    recovery: average(readiness) * 18,
    drivers: uniqueText(drivers)
  };
}

function emotionalInputs(person: Person, options: EmotionalStateOptions = {}): EmotionalInputs {
  const hpRatio = person.alive ? fraction(person.hp, person.maxHp) : 0;
  const fatigue = clamp(person.fatigue, 0, 100);
  const morale = clamp(person.morale, 0, 100);
  const memory = memoryTone(person.memories ?? [], options.memoryWindow ?? 6);
  const status = statusTone(person.status ?? []);
  const resources = resourceTone(person);
  const compulsion = person.social?.compulsion;
  const compulsionPressure = compulsion ? compulsion.strength * 0.52 + Math.min(18, compulsion.remainingTicks * 0.7) : 0;
  const injuryPressure = person.alive ? (1 - hpRatio) * 42 + (hpRatio < 0.35 ? 18 : 0) : 100;
  const fatiguePressure = fatigue * 0.42 + (fatigue > 75 ? 12 : 0);
  const moralePressure = Math.max(0, 50 - morale) * 0.65;
  const extraStress = options.extraStress ?? 0;
  const extraResolve = options.extraResolve ?? 0;

  const stress = rounded(
    injuryPressure +
      fatiguePressure +
      moralePressure +
      memory.negative * 2.2 +
      status.stress +
      resources.strain +
      compulsionPressure +
      extraStress -
      memory.positive * 0.55 -
      status.relief * 0.7,
    0,
    100
  );
  const resolve = rounded(
    24 +
      morale * 0.45 +
      person.stats.core.willpower * 0.24 +
      person.traits.bravery * 0.14 +
      person.traits.loyalty * 0.12 +
      memory.positive * 1.1 +
      status.relief * 0.5 +
      resources.recovery +
      extraResolve -
      injuryPressure * 0.18 -
      fatigue * 0.12 -
      memory.negative * 0.28 -
      compulsionPressure * 0.22,
    0,
    100
  );
  const valence = rounded(
    morale -
      50 +
      (hpRatio - 0.65) * 30 -
      fatigue * 0.22 +
      memory.positive * 1.2 -
      memory.negative * 1.1 +
      status.relief * 0.55 -
      status.stress * 0.35 -
      compulsionPressure * 0.45 +
      resources.recovery * 0.45 -
      resources.strain * 0.35,
    -100,
    100
  );
  const arousal = rounded(stress * 0.68 + person.traits.wrath * 0.12 + person.traits.caution * 0.08 + compulsionPressure * 0.2 - fatigue * 0.08, 0, 100);
  const pressure = rounded(stress - resolve * 0.32 + compulsionPressure * 0.25, 0, 100);
  const recovery = rounded(resolve * 0.55 + resources.recovery + status.relief * 0.35 - stress * 0.22, 0, 100);
  const healthDriver = hpRatio < 0.35 ? "low-health" : undefined;
  const fatigueDriver = fatigue > 70 ? "fatigue" : undefined;
  const moraleDriver = morale < 38 ? "low-morale" : morale > 72 ? "high-morale" : undefined;
  const compulsionDriver = compulsion ? "compulsion" : undefined;
  const scoreDriver = scoreTag(valence, "positive-outlook", "negative-outlook");
  const drivers = uniqueText([
    healthDriver,
    fatigueDriver,
    moraleDriver,
    compulsionDriver,
    scoreDriver,
    ...memory.drivers,
    ...status.drivers,
    ...resources.drivers,
    ...(options.drivers ?? [])
  ].filter((driver): driver is string => Boolean(driver))).slice(0, 10);

  return {
    stress,
    resolve,
    valence,
    arousal,
    pressure,
    recovery,
    drivers,
    tags: uniqueText(["mood", ...drivers]).slice(0, 12),
    compelled: Boolean(compulsion),
    wounded: status.wounded || hpRatio < 0.35,
    grieving: status.grieving || memory.grieving,
    fatigued: fatigue > 72
  };
}

export function moraleStateForScore(morale: number): MoraleStateKind {
  if (morale <= 18) {
    return "broken";
  }
  if (morale <= 34) {
    return "shaken";
  }
  if (morale <= 48) {
    return "strained";
  }
  if (morale >= 84) {
    return "zealous";
  }
  if (morale >= 68) {
    return "confident";
  }
  return "steady";
}

export function moodKindForScores(input: MoodScoreInput): MoodKind {
  if (input.compelled) {
    return "compelled";
  }
  if (input.wounded && input.stress >= 44) {
    return "wounded";
  }
  if (input.grieving && input.valence < 12) {
    return "grieving";
  }
  if (input.fatigued && input.resolve < 58) {
    return "exhausted";
  }
  if (input.stress >= 82 && input.resolve <= 34) {
    return "despairing";
  }
  if (input.stress >= 68 && input.arousal >= 58 && input.valence < 0) {
    return "angry";
  }
  if (input.stress >= 62 && input.resolve < 50) {
    return "fearful";
  }
  if (input.valence <= -28 || input.stress >= 58) {
    return "grim";
  }
  if (input.valence >= 36 && input.resolve >= 64) {
    return "inspired";
  }
  if (input.valence >= 14 || input.morale >= 68) {
    return "hopeful";
  }
  return "steady";
}

export function deriveStressResolveState(person: Person, options: EmotionalStateOptions = {}): StressResolveState {
  const inputs = emotionalInputs(person, options);
  const previous = options.previous ?? person.emotionalState;
  return {
    stress: inputs.stress,
    resolve: inputs.resolve,
    stressDrift: rounded(inputs.stress - (previous?.stress.stress ?? inputs.stress), -24, 24),
    resolveDrift: rounded(inputs.resolve - (previous?.stress.resolve ?? inputs.resolve), -24, 24),
    pressure: inputs.pressure,
    recovery: inputs.recovery,
    tags: inputs.tags
  };
}

export function derivePersonEmotionalState(person: Person, options: EmotionalStateOptions = {}): PersonEmotionalState {
  const inputs = emotionalInputs(person, options);
  const stress = deriveStressResolveState(person, options);
  return {
    mood: moodKindForScores({
      valence: inputs.valence,
      stress: inputs.stress,
      resolve: inputs.resolve,
      arousal: inputs.arousal,
      morale: person.morale,
      compelled: inputs.compelled,
      wounded: inputs.wounded,
      grieving: inputs.grieving,
      fatigued: inputs.fatigued
    }),
    moraleState: moraleStateForScore(person.morale),
    valence: inputs.valence,
    arousal: inputs.arousal,
    stress,
    updatedTick: options.tick ?? person.emotionalState?.updatedTick ?? 0,
    drivers: inputs.drivers
  };
}

export function updatePersonEmotionalState(person: Person, options: EmotionalStateOptions = {}): PersonEmotionalState {
  const state = derivePersonEmotionalState(person, { ...options, previous: options.previous ?? person.emotionalState });
  person.emotionalState = state;
  return state;
}

export function tickPersonEmotionalState(person: Person, tick: number, options: Omit<EmotionalStateOptions, "tick" | "previous"> = {}): PersonEmotionalState {
  return updatePersonEmotionalState(person, { ...options, tick, previous: person.emotionalState });
}

function sharedMembershipIds(first: Person, second: Person): Id[] {
  const secondMemberships = new Set((second.memberships ?? []).map((membership) => membership.organizationId));
  return uniqueText((first.memberships ?? []).map((membership) => membership.organizationId).filter((id) => secondMemberships.has(id)));
}

function familyOverlap(first: Person, second: Person): boolean {
  if (first.familyName && first.familyName === second.familyName) {
    return true;
  }
  const firstKin = new Set([...first.parentIds, ...first.childIds, ...first.guardianIds]);
  const secondKin = new Set([...second.parentIds, ...second.childIds, ...second.guardianIds]);
  if (firstKin.has(second.id) || secondKin.has(first.id)) {
    return true;
  }
  return [...firstKin].some((id) => secondKin.has(id));
}

export function classifyRelationStance(person: Person, target: Person, options: RelationStanceOptions = {}): RelationStance {
  const membershipOverlap = uniqueText([...(options.membershipOverlap ?? sharedMembershipIds(person, target))]);
  const relation = options.relation ?? average([person.relations[target.id] ?? 0, target.relations[person.id] ?? person.relations[target.id] ?? 0]);
  const trust = options.trust ?? person.social?.trustByPersonId[target.id] ?? Math.max(0, relation);
  const suspicion = options.suspicion ?? person.social?.suspicionByPersonId[target.id] ?? Math.max(0, -relation);
  const sameBand = Boolean(person.bandId && person.bandId === target.bandId);
  const sameFaction = person.factionId === target.factionId;
  const isFamily = familyOverlap(person, target);
  const affinity = rounded(
    relation * 0.62 +
      trust * 0.34 -
      suspicion * 0.56 +
      membershipOverlap.length * 8 +
      (sameBand ? 10 : 0) +
      (sameFaction ? 4 : 0) +
      (isFamily ? 18 : 0),
    -100,
    100
  );
  const friendship = rounded(Math.max(0, affinity) + Math.max(0, trust - 35) * 0.35 + (isFamily ? 10 : 0), 0, 100);
  const rivalry = rounded(Math.max(0, -affinity) + Math.max(0, suspicion - 35) * 0.45 + Math.max(0, -relation) * 0.3, 0, 100);
  let stance: RelationStanceKind = "neutral";
  if (isFamily && affinity >= 8) {
    stance = "kin";
  } else if (affinity >= 70 && trust >= 45) {
    stance = "trusted-friend";
  } else if (affinity >= 48) {
    stance = "friend";
  } else if (affinity >= 22) {
    stance = "ally";
  } else if (rivalry >= 72 || relation <= -62) {
    stance = "enemy";
  } else if (rivalry >= 48) {
    stance = "rival";
  } else if (suspicion >= 58) {
    stance = "suspicious";
  } else if (affinity <= -18) {
    stance = "uneasy";
  }

  const tags = uniqueText([
    stance,
    isFamily ? "family" : "",
    sameBand ? "same-band" : "",
    sameFaction ? "same-faction" : "",
    membershipOverlap.length > 0 ? "shared-membership" : "",
    suspicion >= 58 ? "suspicion" : ""
  ]);

  return {
    targetPersonId: target.id,
    stance,
    affinity,
    friendship,
    rivalry,
    trust: rounded(trust, -100, 100),
    suspicion: rounded(suspicion, 0, 100),
    membershipOverlap,
    familyOverlap: isFamily,
    bandOverlap: sameBand,
    tags
  };
}

export function updatePersonRelationStance(person: Person, target: Person, options: RelationStanceOptions = {}): RelationStance {
  const stance = classifyRelationStance(person, target, options);
  person.relationStances ??= {};
  person.relationStances[target.id] = stance;
  return stance;
}

function makeAnchor(input: Omit<LoyaltyAnchor, "strength" | "pressure" | "obligation" | "tags"> & { strength: number; pressure?: number; obligation?: number; tags?: string[] }): LoyaltyAnchor {
  return {
    ...input,
    strength: rounded(input.strength, 0, 100),
    pressure: rounded(input.pressure ?? 0, 0, 100),
    obligation: rounded(input.obligation ?? 0, 0, 100),
    tags: uniqueText(input.tags ?? [])
  };
}

function relationToPeople(person: Person, ids: readonly Id[], world: World): number {
  const values = ids.filter((id) => Boolean(world.persons[id])).map((id) => person.relations[id] ?? 0);
  return values.length > 0 ? average(values) : 0;
}

function organizationStatusPressure(organization: Organization): number {
  if (organization.status === "broken") {
    return 36;
  }
  if (organization.status === "outlawed") {
    return 30;
  }
  if (organization.status === "strained") {
    return 20;
  }
  if (organization.status === "dormant") {
    return 10;
  }
  return 0;
}

function membershipStatusPressure(status: string): number {
  if (status === "strained") {
    return 22;
  }
  if (status === "hidden") {
    return 12;
  }
  if (status === "suspended") {
    return 26;
  }
  if (status === "banished") {
    return 40;
  }
  if (status === "oathbound") {
    return 8;
  }
  return 0;
}

function membershipStatusStrength(status: string): number {
  if (status === "oathbound") {
    return 12;
  }
  if (status === "hidden") {
    return -4;
  }
  if (status === "strained") {
    return -8;
  }
  if (status === "suspended") {
    return -16;
  }
  if (status === "banished") {
    return -26;
  }
  return 0;
}

function collectLoyaltyAnchors(person: Person, world: World, options: LoyaltyDerivationOptions): LoyaltyAnchor[] {
  const anchors: LoyaltyAnchor[] = [];
  const familyIds = uniqueText([...person.parentIds, ...person.childIds, ...person.guardianIds]);
  if (familyIds.length > 0 || person.familyName) {
    const familyRelation = relationToPeople(person, familyIds, world);
    const familyPressure = (person.adoptionStatus === "orphan" ? 22 : 0) + (person.adoptionStatus === "ward" ? 16 : 0) + (person.status.includes("war-ward") ? 14 : 0);
    anchors.push(
      makeAnchor({
        kind: "family",
        id: `family:${person.familyName || person.id}`,
        label: person.familyName ? `${person.familyName} family` : "family ties",
        strength: 24 + person.traits.loyalty * 0.24 + familyIds.length * 8 + familyRelation * 0.16,
        pressure: familyPressure,
        obligation: Math.min(100, familyIds.length * 15 + (person.guardianIds.length > 0 ? 10 : 0)),
        public: true,
        tags: ["family", person.adoptionStatus]
      })
    );
  }

  const faction = world.factions[person.factionId];
  if (faction) {
    anchors.push(
      makeAnchor({
        kind: "faction",
        id: faction.id,
        label: faction.name,
        strength: 18 + person.traits.loyalty * 0.34 + person.morale * 0.18 + faction.stability * 0.24 + (faction.cultureId === person.cultureId ? 8 : 0),
        pressure: faction.activeWars.length * 10 + Math.max(0, 35 - faction.stability) * 0.55,
        obligation: 34 + faction.activeWars.length * 10,
        public: true,
        tags: ["faction", faction.kind]
      })
    );
  }

  const culture = world.cultures[person.cultureId];
  if (culture) {
    const culturePressure = (person.birthCultureId && person.birthCultureId !== person.cultureId ? 10 : 0) + (person.fosterCultureId && person.fosterCultureId !== person.birthCultureId ? 8 : 0);
    anchors.push(
      makeAnchor({
        kind: "culture",
        id: culture.id,
        label: culture.name,
        strength: 20 + person.traits.loyalty * 0.18 + culture.cohesion * 0.3 + (person.birthCultureId === culture.id ? 8 : 0),
        pressure: culturePressure,
        obligation: culture.tradition * 0.36,
        public: true,
        tags: ["culture"]
      })
    );
  }

  const band = person.bandId ? world.bands[person.bandId] : undefined;
  if (band) {
    const leaderRelation = band.leaderId === person.id ? 45 : person.relations[band.leaderId] ?? 0;
    const purposePressure = band.purpose === "rebellion" ? 22 : band.purpose === "raiding" ? 18 : 0;
    anchors.push(
      makeAnchor({
        kind: "band",
        id: band.id,
        label: band.name,
        strength: 16 + band.cohesion * 0.48 + person.morale * 0.14 + person.traits.loyalty * 0.16 + leaderRelation * 0.18 + (band.leaderId === person.id ? 14 : 0),
        pressure: purposePressure + Math.max(0, 35 - band.supplies) * 0.22,
        obligation: band.leaderId === person.id ? 74 : 38,
        public: true,
        tags: ["band", band.purpose]
      })
    );
  }

  for (const membership of person.memberships ?? []) {
    if (membership.public === false && options.includeHiddenMemberships === false) {
      continue;
    }
    const organization = world.organizations?.[membership.organizationId];
    if (!organization) {
      continue;
    }
    anchors.push(
      makeAnchor({
        kind: "organization",
        id: organization.id,
        label: organization.name,
        strength:
          12 +
          membership.loyalty * 0.62 +
          membership.obligation * 0.2 +
          membership.influence * 0.12 +
          organization.outlook.cohesion * 0.1 +
          membershipStatusStrength(membership.status),
        pressure: membershipStatusPressure(membership.status) + organizationStatusPressure(organization) + Math.max(0, membership.obligation - membership.loyalty) * 0.18,
        obligation: membership.obligation,
        public: membership.public,
        tags: ["organization", organization.kind, membership.status, membership.role]
      })
    );
  }

  const compulsion = person.social?.compulsion;
  if (compulsion) {
    anchors.push(
      makeAnchor({
        kind: "compulsion",
        id: compulsion.sourceId ?? compulsion.intent.id,
        label: `${compulsion.sourceKind} compulsion`,
        strength: compulsion.strength,
        pressure: compulsion.strength,
        obligation: Math.min(100, compulsion.remainingTicks * 8),
        public: compulsion.detectedByPersonIds.length > 0,
        tags: ["compulsion", compulsion.sourceKind]
      })
    );
  }

  return anchors.sort((left, right) => right.strength - left.strength || right.pressure - left.pressure || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

function factionRelation(world: World, firstFactionId: Id | undefined, secondFactionId: Id | undefined): number {
  if (!firstFactionId || !secondFactionId || firstFactionId === secondFactionId) {
    return 100;
  }
  const first = world.factions[firstFactionId];
  const second = world.factions[secondFactionId];
  if (!first || !second) {
    return 0;
  }
  return average([first.relations[secondFactionId] ?? 0, second.relations[firstFactionId] ?? first.relations[secondFactionId] ?? 0]);
}

function organizationForAnchor(world: World, anchor: LoyaltyAnchor): Organization | undefined {
  return anchor.kind === "organization" ? world.organizations?.[anchor.id] : undefined;
}

function tensionBetween(person: Person, world: World, first: LoyaltyAnchor, second: LoyaltyAnchor): TensionResult {
  const reasons: string[] = [];
  let tension = 0;

  if (first.kind === "compulsion" || second.kind === "compulsion") {
    const compulsion = first.kind === "compulsion" ? first : second;
    const other = first.kind === "compulsion" ? second : first;
    tension += compulsion.strength * 0.72 + other.strength * 0.16;
    reasons.push("compulsion contests chosen loyalties");
  }

  const firstOrganization = organizationForAnchor(world, first);
  const secondOrganization = organizationForAnchor(world, second);
  if (firstOrganization && second.kind === "faction") {
    const relation = factionRelation(world, firstOrganization.factionId, second.id);
    if (firstOrganization.factionId && firstOrganization.factionId !== second.id) {
      tension += Math.max(0, 45 - relation) * 0.7 + first.obligation * 0.14;
      reasons.push("organization faction differs from society");
    }
  }
  if (secondOrganization && first.kind === "faction") {
    const relation = factionRelation(world, secondOrganization.factionId, first.id);
    if (secondOrganization.factionId && secondOrganization.factionId !== first.id) {
      tension += Math.max(0, 45 - relation) * 0.7 + second.obligation * 0.14;
      reasons.push("organization faction differs from society");
    }
  }
  if (firstOrganization && secondOrganization && first.id !== second.id) {
    const relation = factionRelation(world, firstOrganization.factionId, secondOrganization.factionId);
    tension += Math.max(0, 35 - relation) * 0.55 + Math.min(first.obligation, second.obligation) * 0.12;
    if (relation < 35 || first.obligation + second.obligation > 115) {
      reasons.push("competing organization oaths");
    }
  }

  if ((first.kind === "family" && second.kind === "faction") || (first.kind === "faction" && second.kind === "family")) {
    const parentFactions = uniqueText(person.parentIds.map((id) => world.persons[id]?.factionId ?? "").filter(Boolean));
    const factionAnchor = first.kind === "faction" ? first : second;
    const opposingParent = parentFactions.find((id) => id !== factionAnchor.id && factionRelation(world, id, factionAnchor.id) < -10);
    if (opposingParent || person.adoptionStatus === "ward" || person.status.includes("war-ward")) {
      tension += 24 + (opposingParent ? Math.max(0, -factionRelation(world, opposingParent, factionAnchor.id)) * 0.28 : 0);
      reasons.push("family ties cross society pressure");
    }
  }

  if ((first.kind === "family" && second.kind === "organization") || (first.kind === "organization" && second.kind === "family")) {
    const organizationAnchor = first.kind === "organization" ? first : second;
    if (organizationAnchor.obligation >= 55 || organizationAnchor.pressure >= 25) {
      tension += organizationAnchor.obligation * 0.2 + organizationAnchor.pressure * 0.4;
      reasons.push("organization duty competes with family ties");
    }
  }

  if ((first.kind === "band" && second.kind === "faction") || (first.kind === "faction" && second.kind === "band")) {
    const band = world.bands[first.kind === "band" ? first.id : second.id];
    const factionAnchor = first.kind === "faction" ? first : second;
    const localFactionId = band ? world.settlements[band.locationId]?.factionId : undefined;
    if (band?.purpose === "rebellion" || band?.purpose === "raiding" || (localFactionId && localFactionId !== factionAnchor.id && factionRelation(world, localFactionId, factionAnchor.id) < 10)) {
      tension += (band?.purpose === "rebellion" ? 28 : band?.purpose === "raiding" ? 22 : 14) + Math.max(0, -factionRelation(world, localFactionId, factionAnchor.id)) * 0.25;
      reasons.push("band purpose cuts across society duty");
    }
  }

  if ((first.kind === "band" && second.kind === "organization") || (first.kind === "organization" && second.kind === "band")) {
    const organization = organizationForAnchor(world, first.kind === "organization" ? first : second);
    const band = world.bands[first.kind === "band" ? first.id : second.id];
    const localFactionId = band ? world.settlements[band.locationId]?.factionId : undefined;
    if (organization?.factionId && localFactionId && organization.factionId !== localFactionId && factionRelation(world, organization.factionId, localFactionId) < 20) {
      tension += 20 + Math.max(0, 20 - factionRelation(world, organization.factionId, localFactionId)) * 0.42;
      reasons.push("band work conflicts with organization allegiance");
    }
  }

  if ((first.kind === "culture" && second.kind === "faction") || (first.kind === "faction" && second.kind === "culture")) {
    const factionAnchor = first.kind === "faction" ? first : second;
    const faction = world.factions[factionAnchor.id];
    const cultureAnchor = first.kind === "culture" ? first : second;
    if (faction && faction.cultureId !== cultureAnchor.id) {
      tension += person.birthCultureId === cultureAnchor.id ? 18 : 10;
      reasons.push("culture and society expectations diverge");
    }
  }

  if (reasons.length === 0 && first.pressure + second.pressure >= 60 && Math.min(first.strength, second.strength) >= 42) {
    tension += (first.pressure + second.pressure) * 0.28;
    reasons.push("simultaneous obligations are under strain");
  }

  return { tension, reasons: uniqueText(reasons) };
}

export function severityForLoyaltyPressure(pressure: number): LoyaltyConflictSeverity {
  if (pressure < 12) {
    return "none";
  }
  if (pressure < 32) {
    return "low";
  }
  if (pressure < 56) {
    return "medium";
  }
  if (pressure < 78) {
    return "high";
  }
  return "severe";
}

function makeConflict(person: Person, first: LoyaltyAnchor, second: LoyaltyAnchor, tension: number, reasons: string[]): LoyaltyConflict {
  const pressure = rounded(tension * (0.45 + Math.min(first.strength, second.strength) / 180) + (first.pressure + second.pressure) * 0.18, 0, 100);
  return {
    id: `loyalty:${person.id}:${first.kind}:${first.id}:${second.kind}:${second.id}`,
    primary: first.strength >= second.strength ? first : second,
    competing: first.strength >= second.strength ? second : first,
    pressure,
    severity: severityForLoyaltyPressure(pressure),
    reasons
  };
}

export function deriveLoyaltyState(person: Person, world: World, options: LoyaltyDerivationOptions = {}): PersonLoyaltyState {
  const anchors = collectLoyaltyAnchors(person, world, options);
  const conflicts: LoyaltyConflict[] = [];
  for (let firstIndex = 0; firstIndex < anchors.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < anchors.length; secondIndex += 1) {
      const first = anchors[firstIndex];
      const second = anchors[secondIndex];
      if (first.kind === second.kind && first.id === second.id) {
        continue;
      }
      const tension = tensionBetween(person, world, first, second);
      if (tension.reasons.length === 0) {
        continue;
      }
      const conflict = makeConflict(person, first, second, tension.tension, tension.reasons);
      if (conflict.severity !== "none") {
        conflicts.push(conflict);
      }
    }
  }

  conflicts.sort((left, right) => right.pressure - left.pressure || left.id.localeCompare(right.id));
  const keptConflicts = conflicts.slice(0, options.maxConflicts ?? 6);
  const conflictPressures = keptConflicts.map((conflict) => conflict.pressure);
  const pressure = conflictPressures.length > 0 ? rounded(Math.max(...conflictPressures) * 0.7 + average(conflictPressures) * 0.3, 0, 100) : 0;
  const primaryAnchor = anchors[0];
  return {
    anchors,
    conflicts: keptConflicts,
    pressure,
    primaryAnchor,
    updatedTick: options.tick ?? person.loyalty?.updatedTick ?? 0,
    tags: uniqueText(["loyalty", primaryAnchor?.kind ?? "", pressure >= 56 ? "conflicted" : "", ...keptConflicts.flatMap((conflict) => conflict.reasons)]).slice(0, 10)
  };
}

export function deriveLoyaltyConflictPressure(person: Person, world: World, options: LoyaltyDerivationOptions = {}): number {
  return deriveLoyaltyState(person, world, options).pressure;
}

export function updatePersonLoyaltyState(person: Person, world: World, options: LoyaltyDerivationOptions = {}): PersonLoyaltyState {
  const state = deriveLoyaltyState(person, world, options);
  person.loyalty = state;
  return state;
}

export function tickPersonSocialEmotionalState(world: World, person: Person, options: Omit<EmotionalStateOptions & LoyaltyDerivationOptions, "previous"> = {}): SocialEmotionalTickResult {
  const tick = options.tick ?? world.tick;
  return {
    emotionalState: tickPersonEmotionalState(person, tick, options),
    loyalty: updatePersonLoyaltyState(person, world, { ...options, tick })
  };
}

export function tickSocialEmotionalStates(world: World, people: readonly Person[] = Object.values(world.persons), options: Omit<EmotionalStateOptions & LoyaltyDerivationOptions, "previous"> = {}): SocialEmotionalTickResult[] {
  const tick = options.tick ?? world.tick;
  return people.filter((person) => person.alive).map((person) => tickPersonSocialEmotionalState(world, person, { ...options, tick }));
}

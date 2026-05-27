import { clamp, makeId } from "../core/math";
import type {
  Id,
  ImplantedIntent,
  InfluenceSourceKind,
  Person,
  SocialIntent,
  SocialIntentKind,
  SocialMind,
  World
} from "../types";

export interface IntentPressureReason {
  key: string;
  label: string;
  score: number;
  tags: string[];
}

export interface IntentPressureSignal {
  kind: SocialIntentKind;
  score: number;
  secrecy: number;
  targetPersonId?: Id;
  targetFactionId?: Id;
  targetLocationId?: Id;
  text?: string;
  tags: string[];
  reasons: IntentPressureReason[];
}

export interface IntentProjectionOptions {
  visibleCount?: number;
  hiddenCount?: number;
  includeExistingSocial?: boolean;
  minVisibleScore?: number;
  minHiddenScore?: number;
}

export interface IntentProjection {
  personId: Id;
  tick: number;
  visibleIntents: SocialIntent[];
  hiddenIntents: SocialIntent[];
  signals: IntentPressureSignal[];
  dominantSignal?: IntentPressureSignal;
}

export interface IntentInfluenceOptions {
  sourcePersonId?: Id;
  sourceKind?: InfluenceSourceKind;
  strength?: number;
  secrecy?: number;
  durationTicks?: number;
  force?: boolean;
  tags?: string[];
  text?: string;
}

export interface IntentInfluenceResult {
  success: boolean;
  action: "implant" | "reveal";
  personId: Id;
  sourcePersonId?: Id;
  intent?: SocialIntent;
  margin: number;
  reason: string;
  tags: string[];
}

const intentText: Record<SocialIntentKind, string> = {
  survive: "stay alive",
  recover: "recover strength",
  protect: "protect companions",
  "gain-renown": "win public glory",
  "gain-wealth": "secure wealth",
  "learn-magic": "study magic",
  "master-craft": "master a craft",
  "seek-relic": "seek a relic",
  avenge: "settle an old hurt",
  romance: "build a household",
  "serve-society": "serve their society",
  "undermine-rival": "weaken a rival quietly",
  "hide-truth": "keep a secret buried",
  "obey-compulsion": "obey a foreign will"
};

const intentBaseTags: Record<SocialIntentKind, string[]> = {
  survive: ["self", "danger"],
  recover: ["health", "rest"],
  protect: ["relation", "society"],
  "gain-renown": ["renown", "ambition"],
  "gain-wealth": ["economy", "wealth"],
  "learn-magic": ["magic", "learning"],
  "master-craft": ["craft", "learning"],
  "seek-relic": ["relic", "mystery"],
  avenge: ["conflict", "grudge"],
  romance: ["relation", "family"],
  "serve-society": ["society", "duty"],
  "undermine-rival": ["conflict", "secret"],
  "hide-truth": ["secret", "deception"],
  "obey-compulsion": ["mind-control", "influence"]
};

const secretKinds = new Set<SocialIntentKind>(["avenge", "undermine-rival", "hide-truth", "obey-compulsion"]);

const injurySeverityWeight: Record<string, number> = {
  minor: 4,
  moderate: 9,
  severe: 16,
  critical: 24,
  maiming: 30
};

const scarSeverityWeight: Record<string, number> = {
  faint: 1,
  notable: 4,
  deep: 7,
  crippling: 13,
  legendary: 18
};

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function statusIncludes(person: Person, fragments: readonly string[]): boolean {
  return person.status.some((status) => fragments.some((fragment) => status.includes(fragment)));
}

function poolFraction(current: number, max: number): number {
  return max > 0 ? clamp(current / max, 0, 1) : 0;
}

function locationThreat(world: World, person: Person): number {
  const settlement = world.settlements[person.locationId];
  if (!settlement) {
    return 0;
  }
  const faction = world.factions[person.factionId];
  const warPressure = (faction?.activeWars.length ?? 0) * 10;
  return clamp(settlement.threat * 0.7 + settlement.unrest * 0.25 + warPressure, 0, 100);
}

function relationSummary(person: Person): { best?: Id; worst?: Id; bestValue: number; worstValue: number; positiveCount: number; negativeCount: number } {
  let best: Id | undefined;
  let worst: Id | undefined;
  let bestValue = -101;
  let worstValue = 101;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const [id, value] of Object.entries(person.relations)) {
    if (value > bestValue) {
      best = id;
      bestValue = value;
    }
    if (value < worstValue) {
      worst = id;
      worstValue = value;
    }
    if (value >= 35) {
      positiveCount += 1;
    }
    if (value <= -25) {
      negativeCount += 1;
    }
  }

  return {
    best,
    worst,
    bestValue: bestValue === -101 ? 0 : bestValue,
    worstValue: worstValue === 101 ? 0 : worstValue,
    positiveCount,
    negativeCount
  };
}

function injuryBurden(person: Person): number {
  return (person.injuries ?? []).reduce((sum, injury) => sum + injury.burden + injury.pain * 0.6 + (injurySeverityWeight[injury.severity] ?? 0), 0);
}

function scarBurden(person: Person): number {
  return (person.scars ?? []).reduce((sum, scar) => sum + scar.burden + (scarSeverityWeight[scar.severity] ?? 0), 0);
}

function augmentationStrain(person: Person): number {
  return (person.augmentations ?? []).reduce((sum, augmentation) => {
    const conditionFraction = poolFraction(augmentation.condition, augmentation.maxCondition);
    const lowPower = augmentation.active && augmentation.powered && augmentation.upkeep ? 8 : 0;
    const sideEffects = augmentation.sideEffects.reduce((effectSum, effect) => effectSum + effect.magnitude, 0);
    return sum + Math.max(0, 1 - conditionFraction) * 24 + lowPower + sideEffects;
  }, 0);
}

function addPressure(
  signals: Map<SocialIntentKind, IntentPressureSignal>,
  kind: SocialIntentKind,
  score: number,
  reason: Omit<IntentPressureReason, "score">,
  options: {
    secrecy?: number;
    targetPersonId?: Id;
    targetFactionId?: Id;
    targetLocationId?: Id;
    tags?: string[];
    text?: string;
  } = {}
): void {
  const roundedScore = Math.max(0, Number.isFinite(score) ? score : 0);
  if (roundedScore <= 0) {
    return;
  }

  const existing =
    signals.get(kind) ??
    ({
      kind,
      score: 0,
      secrecy: secretKinds.has(kind) ? 24 : 0,
      tags: [...intentBaseTags[kind]],
      reasons: []
    } satisfies IntentPressureSignal);

  existing.score += roundedScore;
  existing.secrecy = Math.max(existing.secrecy, options.secrecy ?? 0);
  existing.targetPersonId ??= options.targetPersonId;
  existing.targetFactionId ??= options.targetFactionId;
  existing.targetLocationId ??= options.targetLocationId;
  existing.text ??= options.text;
  existing.tags = unique([...existing.tags, ...(options.tags ?? []), ...reason.tags]);
  existing.reasons.push({
    key: reason.key,
    label: reason.label,
    score: rounded(roundedScore, 0, 999),
    tags: reason.tags
  });
  signals.set(kind, existing);
}

function addExistingSocialPressure(signals: Map<SocialIntentKind, IntentPressureSignal>, person: Person): void {
  const social = person.social;
  if (!social) {
    return;
  }

  const intents: { intent?: SocialIntent; weight: number; key: string; label: string }[] = [
    { intent: social.currentIntent, weight: 0.9, key: "social-current", label: "current social intent" },
    { intent: social.declaredIntent, weight: 0.35, key: "social-declared", label: "declared intent" },
    { intent: social.hiddenIntent, weight: 0.95, key: "social-hidden", label: "hidden social intent" },
    { intent: social.ambition, weight: 0.55, key: "social-ambition", label: "standing ambition" },
    ...(social.implantedIntents ?? []).map((implant) => ({
      intent: implant.intent,
      weight: 0.9,
      key: "social-implant",
      label: "implanted intent"
    }))
  ];

  for (const { intent, weight, key, label } of intents) {
    if (!intent) {
      continue;
    }
    addPressure(
      signals,
      intent.kind,
      intent.strength * weight,
      { key, label, tags: ["social"] },
      {
        secrecy: intent.secrecy,
        targetPersonId: intent.targetPersonId,
        targetFactionId: intent.targetFactionId,
        targetLocationId: intent.targetLocationId,
        tags: intent.tags,
        text: intent.text
      }
    );
  }
}

export function scoreIntentPressures(world: World, person: Person, options: Pick<IntentProjectionOptions, "includeExistingSocial"> = {}): IntentPressureSignal[] {
  const signals = new Map<SocialIntentKind, IntentPressureSignal>();
  const identity = person.identity;
  const traits = person.traits;
  const stats = person.stats.derived;
  const relations = relationSummary(person);
  const threat = locationThreat(world, person);
  const hpMissing = 1 - poolFraction(person.hp, person.maxHp);
  const manaMissing = 1 - poolFraction(person.mana, person.maxMana);
  const injuries = injuryBurden(person);
  const scars = scarBurden(person);
  const augmentation = augmentationStrain(person);
  const stress = person.emotionalState?.stress.stress ?? 0;
  const suspicion = person.social ? Math.max(0, ...Object.values(person.social.suspicionByPersonId)) : 0;
  const knownArtifactPressure = Object.values(world.story.artifacts).filter((artifact) => artifact.status !== "claimed").length;
  const activeCrisisPressure = Object.values(world.story.crises).filter((crisis) => crisis.status === "active").reduce((sum, crisis) => sum + crisis.severity, 0);
  const culture = world.cultures[person.cultureId];
  const hiddenMemberships = (person.memberships ?? []).filter((membership) => membership.status === "hidden").length;

  addPressure(signals, "survive", 12 + traits.caution * 0.18 + hpMissing * 42 + threat * 0.2 + Math.max(0, -identity.cravenBold) * 0.12, {
    key: "danger",
    label: "danger, caution, or low health",
    tags: ["danger", "health"]
  });
  addPressure(signals, "recover", hpMissing * 48 + person.fatigue * 0.28 + injuries * 0.8 + augmentation * 0.45 + stress * 0.14, {
    key: "condition",
    label: "wounds, fatigue, stress, or augmentation strain",
    tags: ["health", "body"]
  });
  addPressure(
    signals,
    "protect",
    traits.loyalty * 0.22 + traits.mercy * 0.15 + Math.max(0, identity.evilGood) * 0.12 + relations.positiveCount * 6 + threat * 0.22,
    { key: "bonds", label: "loyalty, mercy, nearby threat, or trusted bonds", tags: ["relation", "settlement"] },
    { targetPersonId: relations.best, targetFactionId: person.factionId }
  );
  addPressure(signals, "gain-renown", traits.ambition * 0.26 + traits.bravery * 0.16 + Math.max(0, identity.cravenBold) * 0.14 + Math.max(0, 60 - person.renown) * 0.12, {
    key: "ambition",
    label: "ambition, bravery, or hunger for a name",
    tags: ["renown"]
  });
  addPressure(signals, "gain-wealth", traits.greed * 0.34 + Math.max(0, -identity.materialistSpiritualist) * 0.18 + Math.max(0, 80 - person.gold) * 0.16, {
    key: "wealth",
    label: "greed, materialism, or low private wealth",
    tags: ["wealth", "economy"]
  });
  addPressure(signals, "learn-magic", stats.intelligence * 0.15 + stats.wisdom * 0.08 + person.skills.sorcery * 0.24 + person.skills.ward * 0.1 + Math.max(0, identity.mightMagic) * 0.2 + manaMissing * 8, {
    key: "arcane-affinity",
    label: "intelligence, wisdom, sorcery, warding, or magic identity",
    tags: ["magic", "learning"]
  });
  addPressure(signals, "master-craft", stats.intelligence * 0.11 + stats.wisdom * 0.13 + person.skills.survival * 0.08 + person.skills.medicine * 0.08 + (culture?.knownRecipeIds.length ?? 0) * 0.55, {
    key: "craft-affinity",
    label: "practical knowledge, wisdom, and cultural recipes",
    tags: ["craft", "culture"]
  });
  addPressure(
    signals,
    "seek-relic",
    traits.curiosity * 0.22 + Math.abs(identity.materialistSpiritualist) * 0.09 + Math.max(0, identity.mightMagic) * 0.08 + knownArtifactPressure * 5,
    { key: "legend-pressure", label: "curiosity, magic, and unresolved relic stories", tags: ["relic", "story"] },
    { targetLocationId: Object.values(world.story.artifacts).find((artifact) => artifact.status !== "claimed")?.locationId }
  );
  addPressure(
    signals,
    "avenge",
    traits.wrath * 0.3 + Math.max(0, -identity.vengefulForgiving) * 0.24 + Math.max(0, -relations.worstValue) * 0.2 + scars * 0.45,
    { key: "grudge", label: "wrath, hostile relations, vengefulness, or old scars", tags: ["grudge", "conflict"] },
    { secrecy: 42, targetPersonId: relations.worst }
  );
  addPressure(
    signals,
    "romance",
    (person.age >= 16 ? 10 : 0) + stats.charisma * 0.16 + traits.loyalty * 0.1 + traits.mercy * 0.08 + Math.max(0, relations.bestValue) * 0.14,
    { key: "attachment", label: "charisma, loyalty, mercy, or close attachment", tags: ["relation", "family"] },
    { targetPersonId: relations.best }
  );
  addPressure(
    signals,
    "serve-society",
    traits.loyalty * 0.28 + Math.max(0, -identity.authoritarianEgalitarian) * 0.18 + (culture?.cohesion ?? 0) * 0.12 + activeCrisisPressure * 0.14,
    { key: "duty", label: "loyalty, authority, culture cohesion, or crisis pressure", tags: ["society", "culture"] },
    { targetFactionId: person.factionId }
  );
  addPressure(
    signals,
    "undermine-rival",
    traits.ambition * 0.16 + traits.wrath * 0.16 + Math.max(0, -identity.corruptPure) * 0.15 + relations.negativeCount * 7 + suspicion * 0.18,
    { key: "rivalry", label: "ambition, wrath, corruption, enemies, or suspicion", tags: ["rival", "secret"] },
    { secrecy: 54, targetPersonId: relations.worst }
  );
  addPressure(
    signals,
    "hide-truth",
    Math.max(0, -identity.corruptPure) * 0.18 + Math.max(0, -identity.evilGood) * 0.12 + hiddenMemberships * 14 + (person.social?.deceptionHistory.length ?? 0) * 1.5,
    { key: "secret-load", label: "corruption, hidden ties, or existing deception history", tags: ["secret", "deception"] },
    { secrecy: 70 }
  );
  addPressure(
    signals,
    "obey-compulsion",
    (person.social?.compulsion?.strength ?? 0) * 1.1 + (person.social?.implantedIntents ?? []).reduce((sum, implant) => sum + implant.strength * 0.35, 0),
    { key: "foreign-will", label: "compulsion or implanted intent pressure", tags: ["mind-control", "influence"] },
    { secrecy: 85 }
  );

  if (statusIncludes(person, ["cursed", "haunted", "possessed", "compel", "mind"])) {
    addPressure(signals, "hide-truth", 18, { key: "occult-status", label: "occult or mental status pressure", tags: ["occult", "secret"] }, { secrecy: 78 });
    addPressure(signals, "recover", 14, { key: "occult-strain", label: "occult or mental condition needs relief", tags: ["occult", "health"] });
  }

  if (options.includeExistingSocial ?? true) {
    addExistingSocialPressure(signals, person);
  }

  return [...signals.values()]
    .map((signal) => ({
      ...signal,
      score: rounded(signal.score),
      secrecy: rounded(signal.secrecy),
      tags: unique(signal.tags),
      reasons: signal.reasons.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, 6)
    }))
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score || b.secrecy - a.secrecy || a.kind.localeCompare(b.kind));
}

function intentFromSignal(world: World, person: Person, signal: IntentPressureSignal, secrecyOverride?: number): SocialIntent {
  const secrecy = rounded(secrecyOverride ?? signal.secrecy);
  const strength = rounded(signal.score, 1, 100);
  return {
    id: makeId("intent", stableHash(`${person.id}:${world.tick}:${signal.kind}:${strength}:${secrecy}:${signal.targetPersonId ?? ""}:${signal.targetLocationId ?? ""}`)),
    kind: signal.kind,
    text: signal.text ?? intentText[signal.kind],
    targetPersonId: signal.targetPersonId,
    targetFactionId: signal.targetFactionId ?? person.factionId,
    targetLocationId: signal.targetLocationId ?? person.locationId,
    strength,
    secrecy,
    createdTick: world.tick,
    tags: unique([...intentBaseTags[signal.kind], ...signal.tags, ...signal.reasons.flatMap((reason) => reason.tags)])
  };
}

export function deriveIntentProjection(world: World, person: Person, options: IntentProjectionOptions = {}): IntentProjection {
  const visibleCount = clamp(Math.round(options.visibleCount ?? 3), 1, 3);
  const hiddenCount = clamp(Math.round(options.hiddenCount ?? 1), 0, 3);
  const minVisibleScore = options.minVisibleScore ?? 18;
  const minHiddenScore = options.minHiddenScore ?? 28;
  const signals = scoreIntentPressures(world, person, options);
  const visibleSignals = signals.filter((signal) => signal.score >= minVisibleScore && signal.secrecy < 56).slice(0, visibleCount);
  const fallbackVisibleSignals = visibleSignals.length > 0 ? visibleSignals : signals.slice(0, 1);
  const visibleKinds = new Set(fallbackVisibleSignals.map((signal) => signal.kind));
  const hiddenSignals = signals
    .filter((signal) => signal.score >= minHiddenScore && (signal.secrecy >= 45 || secretKinds.has(signal.kind)) && !visibleKinds.has(signal.kind))
    .slice(0, hiddenCount);

  return {
    personId: person.id,
    tick: world.tick,
    visibleIntents: fallbackVisibleSignals.map((signal) => intentFromSignal(world, person, signal, 0)),
    hiddenIntents: hiddenSignals.map((signal) => intentFromSignal(world, person, signal)),
    signals,
    dominantSignal: signals[0]
  };
}

function ensureDerivedSocialMind(world: World, person: Person): SocialMind {
  if (person.social) {
    person.social.suspicionByPersonId ??= {};
    person.social.trustByPersonId ??= {};
    person.social.deceptionHistory ??= [];
    person.social.implantedIntents ??= [];
    person.social.ambitions = person.social.ambitions?.length ? person.social.ambitions : [person.social.ambition ?? person.social.currentIntent ?? person.social.declaredIntent].filter(Boolean);
    person.social.ambition = person.social.ambition ?? person.social.ambitions[0] ?? person.social.currentIntent ?? person.social.declaredIntent;
    person.social.currentIntent = person.social.currentIntent ?? person.social.ambition;
    person.social.declaredIntent = person.social.declaredIntent ?? { ...person.social.currentIntent, secrecy: 0 };
    person.social.lastConversationTick ??= -999;
    return person.social;
  }

  const projection = deriveIntentProjection(world, person, { includeExistingSocial: false });
  const ambition = projection.visibleIntents[0] ?? intentFromSignal(world, person, {
    kind: "survive",
    score: 30,
    secrecy: 0,
    targetFactionId: person.factionId,
    targetLocationId: person.locationId,
    tags: ["fallback"],
    reasons: [{ key: "fallback", label: "fallback self-preservation", score: 30, tags: ["fallback"] }]
  });
  const hiddenIntent = projection.hiddenIntents[0];
  person.social = {
    ambitions: projection.visibleIntents.length ? projection.visibleIntents : [ambition],
    ambition,
    currentIntent: hiddenIntent && hiddenIntent.strength > ambition.strength ? hiddenIntent : ambition,
    declaredIntent: { ...ambition, id: makeId("intent", stableHash(`${person.id}:${world.tick}:declared:${ambition.kind}`)), secrecy: 0 },
    hiddenIntent,
    suspicionByPersonId: {},
    trustByPersonId: {},
    deceptionHistory: [],
    implantedIntents: [],
    lastConversationTick: -999
  };
  return person.social;
}

function signalForKind(world: World, person: Person, kind: SocialIntentKind): IntentPressureSignal | undefined {
  return scoreIntentPressures(world, person).find((signal) => signal.kind === kind);
}

export function implantDerivedIntent(
  world: World,
  person: Person,
  kindOrSignal: SocialIntentKind | IntentPressureSignal,
  options: IntentInfluenceOptions = {}
): IntentInfluenceResult {
  const signal = typeof kindOrSignal === "string" ? signalForKind(world, person, kindOrSignal) : kindOrSignal;
  if (!signal) {
    return {
      success: false,
      action: "implant",
      personId: person.id,
      sourcePersonId: options.sourcePersonId,
      margin: -100,
      reason: "no matching intent pressure",
      tags: ["intent", "implant", "missing-pressure"]
    };
  }

  const mind = ensureDerivedSocialMind(world, person);
  const resistance = person.stats.derived.wisdom * 0.28 + person.stats.derived.perception * 0.16 + person.stats.core.willpower * 0.34 + person.traits.caution * 0.12;
  const desiredStrength = rounded(options.strength ?? signal.score, 1, 100);
  const margin = rounded(signal.score + desiredStrength * 0.45 - resistance, -100, 100);
  const strongerCompulsion = mind.compulsion && mind.compulsion.strength > desiredStrength + 8;
  if (!options.force && (signal.score < 24 || strongerCompulsion)) {
    return {
      success: false,
      action: "implant",
      personId: person.id,
      sourcePersonId: options.sourcePersonId,
      margin,
      reason: strongerCompulsion ? "existing compulsion is stronger" : "intent pressure is too weak",
      tags: ["intent", "implant", "resisted"]
    };
  }

  const secrecy = rounded(options.secrecy ?? Math.max(52, signal.secrecy));
  const intent = {
    ...intentFromSignal(world, person, signal, secrecy),
    text: options.text ?? signal.text ?? intentText[signal.kind],
    strength: desiredStrength,
    tags: unique([...signal.tags, ...(options.tags ?? []), "implanted", "influence"])
  };
  const implant: ImplantedIntent = {
    id: makeId("implant", stableHash(`${person.id}:${options.sourcePersonId ?? "unknown"}:${world.tick}:${intent.kind}`)),
    sourcePersonId: options.sourcePersonId,
    sourceKind: options.sourceKind ?? "unknown",
    intent,
    strength: intent.strength,
    secrecy: intent.secrecy,
    remainingTicks: clamp(Math.round(options.durationTicks ?? 36), 1, 240),
    createdTick: world.tick,
    detectedByPersonIds: [],
    tags: intent.tags
  };

  const others = (mind.implantedIntents ?? []).filter((existing) => existing.intent.kind !== intent.kind || existing.sourcePersonId !== implant.sourcePersonId);
  mind.implantedIntents = [implant, ...others].slice(0, 6);
  if (!mind.compulsion && intent.strength >= mind.currentIntent.strength) {
    mind.hiddenIntent = intent;
    mind.currentIntent = intent;
  }

  return {
    success: true,
    action: "implant",
    personId: person.id,
    sourcePersonId: options.sourcePersonId,
    intent,
    margin,
    reason: "intent implanted into social mind",
    tags: ["intent", "implant", ...intent.tags]
  };
}

export function revealHiddenIntent(world: World, person: Person, options: IntentInfluenceOptions = {}): IntentInfluenceResult {
  const mind = ensureDerivedSocialMind(world, person);
  const derivedHidden = deriveIntentProjection(world, person).hiddenIntents[0];
  const hidden = mind.hiddenIntent ?? derivedHidden;
  if (!hidden) {
    return {
      success: false,
      action: "reveal",
      personId: person.id,
      sourcePersonId: options.sourcePersonId,
      margin: -100,
      reason: "no hidden intent to reveal",
      tags: ["intent", "reveal", "missing-hidden"]
    };
  }

  const revealPressure = (options.strength ?? 0) + person.stats.derived.charisma * 0.16 + person.stats.derived.wisdom * 0.12 + Math.max(0, person.morale) * 0.08;
  const margin = rounded(revealPressure - hidden.secrecy * 0.55, -100, 100);
  if (!options.force && margin < -12) {
    return {
      success: false,
      action: "reveal",
      personId: person.id,
      sourcePersonId: options.sourcePersonId,
      margin,
      reason: "hidden intent remains too guarded",
      tags: ["intent", "reveal", "guarded"]
    };
  }

  const revealed = {
    ...hidden,
    id: makeId("intent", stableHash(`${person.id}:${world.tick}:revealed:${hidden.kind}`)),
    secrecy: 0,
    tags: unique([...hidden.tags, ...(options.tags ?? []), "revealed"])
  };
  mind.declaredIntent = revealed;
  if (mind.currentIntent.kind === hidden.kind) {
    mind.currentIntent = { ...mind.currentIntent, secrecy: Math.min(mind.currentIntent.secrecy, 24) };
  }

  return {
    success: true,
    action: "reveal",
    personId: person.id,
    sourcePersonId: options.sourcePersonId,
    intent: revealed,
    margin,
    reason: "hidden intent revealed as declared intent",
    tags: ["intent", "reveal", ...revealed.tags]
  };
}

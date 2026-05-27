import { abilityLearningAffinity, abilityMeetsRequirements, getAbility } from "../abilities/compendium";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import { craftingRecipes, learnRecipe, recipeLearningAffinity, recipeMeetsRequirements } from "../economy/recipes";
import { applyMindCompulsion, ensureSocialMind } from "./social";
import type {
  AbilityId,
  AbilitySchool,
  AbilityStudy,
  CraftingRecipeId,
  DerivedStatKey,
  Id,
  ImplantedIntent,
  InfluenceCheckResult,
  InfluenceSourceKind,
  MindReadInsight,
  Person,
  RecipeStudy,
  SkillKey,
  SocialIntent,
  SocialIntentKind,
  World
} from "../types";

export interface TeachingOptions {
  intensity?: number;
  privateLesson?: boolean;
  sourceKind?: InfluenceSourceKind;
}

export interface MindReadOptions {
  focusSpent?: number;
  subtlety?: number;
}

export interface IntentImplantOptions {
  strength?: number;
  secrecy?: number;
  durationTicks?: number;
  sourceKind?: InfluenceSourceKind;
  targetFactionId?: Id;
  targetLocationId?: Id;
  tags?: string[];
  text?: string;
}

export interface CompulsionOptions {
  strength?: number;
  durationTicks?: number;
  sourceKind?: "spell" | "relic" | "curse" | "authority" | "unknown";
  sourceId?: Id;
}

export interface InfluenceTickResult {
  activeImplants: number;
  expiredImplants: number;
  compelled: number;
}

const schoolSkill: Record<AbilitySchool, SkillKey> = {
  martial: "blade",
  ward: "ward",
  sorcery: "sorcery",
  medicine: "medicine",
  survival: "survival",
  diplomacy: "diplomacy",
  command: "command",
  divine: "ward"
};

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
  romance: "seek closeness",
  "serve-society": "serve society",
  "undermine-rival": "weaken a rival",
  "hide-truth": "hide the truth",
  "obey-compulsion": "obey a foreign will"
};

function personLabel(person: Person): string {
  return `${person.name} ${person.familyName}`;
}

function statRequirementGap(person: Person, requirements: Partial<Record<DerivedStatKey, number>> | undefined): number {
  return Object.entries(requirements ?? {}).reduce((sum, [key, minimum]) => {
    return sum + Math.max(0, (minimum ?? 0) - person.stats.derived[key as DerivedStatKey]);
  }, 0);
}

function relationBias(first: Person, second: Person): number {
  return ((first.relations[second.id] ?? 0) + (second.relations[first.id] ?? 0)) * 0.08;
}

function remember(person: Person, world: World, label: string, weight: number, tags: string[]): void {
  person.memories.unshift({
    id: makeId("memory", world.tick * 1000 + world.events.length + person.memories.length + label.length),
    tick: world.tick,
    label,
    weight,
    tags
  });
  if (person.memories.length > 12) {
    person.memories.length = 12;
  }
}

function bumpAbilityStudy(learner: Person, abilityId: AbilityId, tick: number, exposureDelta: number, affinityDelta: number): AbilityStudy {
  learner.abilityStudy ??= {};
  const existing = learner.abilityStudy[abilityId];
  const study: AbilityStudy = existing ?? {
    abilityId,
    exposure: 0,
    attempts: 0,
    lastObservedTick: tick,
    lastAttemptTick: -1,
    affinity: 0
  };
  study.exposure = clamp(study.exposure + exposureDelta, 0, 200);
  study.affinity = clamp(Math.max(study.affinity, 0) + affinityDelta, 0, 160);
  study.lastObservedTick = tick;
  learner.abilityStudy[abilityId] = study;
  return study;
}

function bumpRecipeStudy(learner: Person, recipeId: CraftingRecipeId, tick: number, exposureDelta: number, affinityDelta: number): RecipeStudy {
  learner.recipeStudy ??= {};
  const existing = learner.recipeStudy[recipeId];
  const study: RecipeStudy = existing ?? {
    recipeId,
    exposure: 0,
    attempts: 0,
    lastObservedTick: tick,
    lastAttemptTick: -1,
    affinity: 0
  };
  study.exposure = clamp(study.exposure + exposureDelta, 0, 200);
  study.affinity = clamp(Math.max(study.affinity, 0) + affinityDelta, 0, 160);
  study.lastObservedTick = tick;
  learner.recipeStudy[recipeId] = study;
  return study;
}

function makeInfluenceResult(input: Omit<InfluenceCheckResult, "notes"> & { notes?: string[] }): InfluenceCheckResult {
  return {
    ...input,
    notes: input.notes ?? []
  };
}

export function teachAbility(
  world: World,
  teacher: Person,
  learner: Person,
  abilityId: AbilityId,
  rng: Rng,
  options: TeachingOptions = {}
): InfluenceCheckResult {
  const ability = getAbility(abilityId);
  if (!ability) {
    return makeInfluenceResult({ kind: "teach-ability", success: false, margin: -100, sourcePersonId: teacher.id, targetPersonId: learner.id, notes: ["unknown ability"] });
  }

  const skill = schoolSkill[ability.school];
  const teacherKnows = teacher.abilityIds.includes(abilityId) || (teacher.abilityStudy[abilityId]?.exposure ?? 0) >= 70;
  const teachingScore =
    teacher.skills[skill] * 0.46 +
    teacher.stats.derived.intelligence * 0.34 +
    teacher.stats.derived.wisdom * 0.22 +
    teacher.stats.derived.charisma * 0.28 +
    (teacherKnows ? 16 : -22);
  const learnerScore =
    learner.stats.derived.intelligence * 0.38 +
    learner.stats.derived.wisdom * 0.18 +
    learner.stats.derived.perception * 0.18 +
    learner.traits.curiosity * 0.12;
  const difficulty = ability.power * 2.2 + statRequirementGap(learner, ability.statRequirements) * 0.8 + Object.values(ability.requirements ?? {}).reduce((sum, value) => sum + value, 0) * 0.28;
  const margin = Math.round(teachingScore + learnerScore * 0.48 + relationBias(teacher, learner) + (options.intensity ?? 0) + rng.int(-8, 10) - difficulty);
  const success = margin >= 0;
  const exposureDelta = clamp(Math.round((success ? 8 : 3) + Math.max(0, margin) * 0.18 + (options.intensity ?? 0) * 0.22), 1, 44);
  const affinityDelta = clamp(Math.round(abilityLearningAffinity(learner, ability) * 0.08 + Math.max(0, margin) * 0.04), 0, 18);
  const study = bumpAbilityStudy(learner, abilityId, world.tick, exposureDelta, affinityDelta);
  const canLearn = abilityMeetsRequirements(learner.skills, ability, learner.stats);
  const learned = success && canLearn && !learner.abilityIds.includes(abilityId) && study.exposure >= clamp(52 + ability.power * 2, 48, 118);
  if (learned) {
    learner.abilityIds.push(abilityId);
  }

  remember(learner, world, `${personLabel(teacher)} taught ${ability.name}`, learned ? 5 : success ? 3 : 1, ["teaching", "ability", ability.school, ...(options.privateLesson ? ["private"] : [])]);
  if (success) {
    teacher.relations[learner.id] = clamp((teacher.relations[learner.id] ?? 0) + 1, -100, 100);
    learner.relations[teacher.id] = clamp((learner.relations[teacher.id] ?? 0) + 1, -100, 100);
  }

  return makeInfluenceResult({
    kind: "teach-ability",
    success,
    margin,
    sourcePersonId: teacher.id,
    targetPersonId: learner.id,
    exposureDelta,
    affinityDelta,
    learned,
    notes: [learned ? "ability learned" : success ? "ability study advanced" : "lesson left only a trace"]
  });
}

export function teachRecipe(
  world: World,
  teacher: Person,
  learner: Person,
  recipeId: CraftingRecipeId,
  rng: Rng,
  options: TeachingOptions = {}
): InfluenceCheckResult {
  const recipe = craftingRecipes[recipeId];
  if (!recipe) {
    return makeInfluenceResult({ kind: "teach-recipe", success: false, margin: -100, sourcePersonId: teacher.id, targetPersonId: learner.id, notes: ["unknown recipe"] });
  }

  const requiredSkills = Object.keys(recipe.requiredSkills ?? {}) as SkillKey[];
  const bestTeacherSkill = requiredSkills.length ? Math.max(...requiredSkills.map((key) => teacher.skills[key])) : teacher.skills.survival;
  const teacherKnows = teacher.recipeIds.includes(recipeId) || (teacher.recipeStudy[recipeId]?.exposure ?? 0) >= 70;
  const teachingScore =
    bestTeacherSkill * 0.52 +
    teacher.stats.derived.intelligence * 0.3 +
    teacher.stats.derived.wisdom * 0.22 +
    teacher.stats.derived.charisma * 0.18 +
    (teacherKnows ? 16 : -20);
  const learnerScore =
    learner.stats.derived.intelligence * 0.34 +
    learner.stats.derived.wisdom * 0.24 +
    learner.stats.derived.perception * 0.18 +
    learner.traits.curiosity * 0.1;
  const skillGap = Object.entries(recipe.requiredSkills ?? {}).reduce((sum, [key, minimum]) => sum + Math.max(0, (minimum ?? 0) - learner.skills[key as SkillKey]), 0);
  const difficulty = recipe.difficulty * 0.58 + skillGap * 0.52 + statRequirementGap(learner, recipe.requiredStats) * 0.64;
  const margin = Math.round(teachingScore + learnerScore * 0.46 + relationBias(teacher, learner) + (options.intensity ?? 0) + rng.int(-8, 10) - difficulty);
  const success = margin >= 0;
  const exposureDelta = clamp(Math.round((success ? 9 : 3) + Math.max(0, margin) * 0.2 + (options.intensity ?? 0) * 0.24), 1, 48);
  const affinityDelta = clamp(Math.round(recipeLearningAffinity(learner, recipe) * 0.08 + Math.max(0, margin) * 0.04), 0, 18);
  const study = bumpRecipeStudy(learner, recipeId, world.tick, exposureDelta, affinityDelta);
  const learned = success && !learner.recipeIds.includes(recipeId) && study.exposure >= clamp(54 + recipe.tier * 12, 54, 130) && recipeMeetsRequirements(learner, recipe);
  if (learned) {
    learnRecipe(learner, recipeId, rng, world.cultures[learner.cultureId]);
  }

  remember(learner, world, `${personLabel(teacher)} taught ${recipe.name}`, learned ? 5 : success ? 3 : 1, ["teaching", "recipe", ...(options.privateLesson ? ["private"] : [])]);
  return makeInfluenceResult({
    kind: "teach-recipe",
    success,
    margin,
    sourcePersonId: teacher.id,
    targetPersonId: learner.id,
    exposureDelta,
    affinityDelta,
    learned,
    notes: [learned ? "recipe learned" : success ? "recipe study advanced" : "lesson left only a trace"]
  });
}

export function readMind(world: World, reader: Person, target: Person, rng: Rng, options: MindReadOptions = {}): MindReadInsight {
  const targetMind = ensureSocialMind(target, rng, world.tick);
  const focusSpent = clamp(options.focusSpent ?? 0, 0, 30);
  const subtlety = clamp(options.subtlety ?? 0, -20, 30);
  const readerScore =
    reader.stats.derived.perception * 0.48 +
    reader.stats.derived.wisdom * 0.32 +
    reader.stats.derived.intelligence * 0.28 +
    reader.skills.sorcery * 0.2 +
    reader.skills.ward * 0.12 +
    focusSpent * 1.8 +
    rng.int(-10, 12);
  const targetScore =
    target.stats.derived.wisdom * 0.42 +
    target.stats.derived.perception * 0.16 +
    target.stats.core.willpower * 0.45 +
    target.traits.caution * 0.16 +
    (targetMind.compulsion?.strength ?? 0) * 0.18 +
    rng.int(-8, 10);
  const margin = Math.round(readerScore - targetScore);
  const clarity = clamp(Math.round(42 + margin + focusSpent * 1.4), 0, 100);
  const detected =
    margin < 16 - subtlety &&
    target.stats.derived.perception * 0.42 + target.stats.derived.wisdom * 0.36 + target.traits.caution * 0.18 + rng.int(-12, 16) > reader.stats.derived.charisma * 0.24 + subtlety + 34;
  if (detected) {
    targetMind.suspicionByPersonId[reader.id] = clamp((targetMind.suspicionByPersonId[reader.id] ?? 0) + 10 + Math.max(0, 16 - margin), 0, 100);
    target.relations[reader.id] = clamp((target.relations[reader.id] ?? 0) - 3, -100, 100);
    remember(target, world, `Felt ${reader.name} press against private thoughts`, 4, ["mind-read", "intrusion"]);
  }
  if (clarity >= 30) {
    remember(reader, world, `Read the surface intent of ${personLabel(target)}`, 2, ["mind-read", ...targetMind.currentIntent.tags]);
  }

  return {
    readerId: reader.id,
    targetId: target.id,
    tick: world.tick,
    clarity,
    margin,
    detected,
    surfaceIntent: clarity >= 20 ? targetMind.currentIntent : targetMind.declaredIntent,
    hiddenIntent: clarity >= 58 ? targetMind.hiddenIntent : undefined,
    compulsion: clarity >= 66 ? targetMind.compulsion : undefined,
    implantedIntentIds: clarity >= 50 ? (targetMind.implantedIntents ?? []).map((intent) => intent.id) : [],
    notes: [
      clarity >= 66 ? "deep reading" : clarity >= 50 ? "hidden pressure sensed" : clarity >= 30 ? "surface intent read" : "unclear impressions",
      detected ? "target noticed intrusion" : "intrusion stayed quiet"
    ]
  };
}

function makeImplantedSocialIntent(target: Person, kind: SocialIntentKind, world: World, strength: number, secrecy: number, options: IntentImplantOptions): SocialIntent {
  return {
    id: makeId("intent", world.tick * 1000 + target.id.length + kind.length + Math.round(strength)),
    kind,
    text: options.text ?? intentText[kind],
    targetFactionId: options.targetFactionId ?? target.factionId,
    targetLocationId: options.targetLocationId ?? target.locationId,
    strength: clamp(Math.round(strength), 1, 100),
    secrecy: clamp(Math.round(secrecy), 0, 100),
    createdTick: world.tick,
    tags: [...new Set(["implanted", "influence", ...(options.tags ?? [])])]
  };
}

export function implantIntent(
  world: World,
  source: Person,
  target: Person,
  kind: SocialIntentKind,
  rng: Rng,
  options: IntentImplantOptions = {}
): InfluenceCheckResult {
  const sourceMind = ensureSocialMind(source, rng, world.tick);
  const targetMind = ensureSocialMind(target, rng, world.tick);
  const desiredStrength = clamp(options.strength ?? 44 + source.stats.derived.charisma * 0.18 + source.stats.derived.intelligence * 0.12, 5, 100);
  const secrecy = clamp(options.secrecy ?? 54 + source.skills.diplomacy * 0.12, 0, 100);
  const influenceScore =
    source.stats.derived.charisma * 0.48 +
    source.stats.derived.intelligence * 0.26 +
    source.stats.derived.wisdom * 0.16 +
    Math.max(source.skills.diplomacy, source.skills.sorcery, source.skills.command) * 0.26 +
    desiredStrength * 0.42 +
    rng.int(-10, 12);
  const resistanceScore =
    target.stats.derived.wisdom * 0.42 +
    target.stats.derived.perception * 0.18 +
    target.stats.core.willpower * 0.44 +
    target.traits.caution * 0.14 +
    rng.int(-8, 12);
  const margin = Math.round(influenceScore - resistanceScore);
  const success = margin >= 0;
  const detected = margin < 18 && target.stats.derived.perception + target.stats.derived.wisdom * 0.7 + rng.int(-20, 12) > source.stats.derived.charisma + secrecy * 0.25;
  if (success) {
    const intent = makeImplantedSocialIntent(target, kind, world, desiredStrength + Math.max(0, margin) * 0.18, secrecy, options);
    const implant: ImplantedIntent = {
      id: makeId("implant", world.tick * 1000 + target.id.length + source.id.length + kind.length),
      sourcePersonId: source.id,
      sourceKind: options.sourceKind ?? "conversation",
      intent,
      strength: intent.strength,
      secrecy: intent.secrecy,
      remainingTicks: Math.max(1, Math.round(options.durationTicks ?? 36)),
      createdTick: world.tick,
      detectedByPersonIds: detected ? [target.id] : [],
      tags: intent.tags
    };
    targetMind.implantedIntents = [implant, ...(targetMind.implantedIntents ?? [])].slice(0, 6);
    if (!targetMind.compulsion && implant.strength >= targetMind.currentIntent.strength) {
      targetMind.hiddenIntent = intent;
      targetMind.currentIntent = intent;
    }
    remember(target, world, `A planted idea urges them to ${intent.text}`, detected ? -2 : 0, ["implanted-intent", kind]);
  }
  if (detected) {
    targetMind.suspicionByPersonId[source.id] = clamp((targetMind.suspicionByPersonId[source.id] ?? 0) + 8 + Math.max(0, 18 - margin), 0, 100);
  }
  sourceMind.lastConversationTick = world.tick;

  return makeInfluenceResult({
    kind: "implant-intent",
    success,
    margin,
    sourcePersonId: source.id,
    targetPersonId: target.id,
    detected,
    notes: [success ? "intent implanted" : "implant resisted", detected ? "target sensed influence" : "influence hidden"]
  });
}

export function attemptMindCompulsion(world: World, source: Person, target: Person, rng: Rng, options: CompulsionOptions = {}): InfluenceCheckResult {
  const sourceScore =
    source.stats.derived.charisma * 0.36 +
    source.stats.derived.intelligence * 0.3 +
    source.stats.derived.wisdom * 0.2 +
    Math.max(source.skills.sorcery, source.skills.command, source.skills.ward) * 0.34 +
    (options.strength ?? 0) +
    rng.int(-12, 14);
  const resistanceScore = target.stats.derived.wisdom * 0.48 + target.stats.core.willpower * 0.52 + target.traits.loyalty * 0.12 + target.traits.caution * 0.1 + rng.int(-10, 12);
  const margin = Math.round(sourceScore - resistanceScore);
  const success = margin >= 0;
  const detected = margin < 20;
  if (success) {
    applyMindCompulsion(target, rng, world.tick, options.sourceKind ?? "unknown", options.sourceId ?? source.id, options.durationTicks ?? 18);
    const mind = ensureSocialMind(target, rng, world.tick);
    if (mind.compulsion) {
      mind.compulsion.strength = clamp(mind.compulsion.strength + Math.max(0, margin) * 0.18 + (options.strength ?? 0) * 0.2, 10, 100);
      mind.compulsion.detectedByPersonIds = detected ? [...new Set([...mind.compulsion.detectedByPersonIds, target.id])] : mind.compulsion.detectedByPersonIds;
    }
    remember(target, world, `${personLabel(source)} forced a command into their intent`, detected ? -4 : -1, ["mind-control", "compulsion"]);
  } else if (detected) {
    const mind = ensureSocialMind(target, rng, world.tick);
    mind.suspicionByPersonId[source.id] = clamp((mind.suspicionByPersonId[source.id] ?? 0) + 12, 0, 100);
  }

  return makeInfluenceResult({
    kind: "compel",
    success,
    margin,
    sourcePersonId: source.id,
    targetPersonId: target.id,
    detected,
    notes: [success ? "compulsion applied" : "compulsion resisted", detected ? "pressure was noticeable" : "pressure was hidden"]
  });
}

export function tickInfluenceState(world: World, rng: Rng, people: Iterable<Person> = Object.values(world.persons)): InfluenceTickResult {
  let activeImplants = 0;
  let expiredImplants = 0;
  let compelled = 0;
  for (const person of people) {
    if (!person.alive) {
      continue;
    }
    const mind = ensureSocialMind(person, rng, world.tick);
    if (mind.compulsion) {
      compelled += 1;
    }
    const implants = mind.implantedIntents ?? [];
    for (const implant of implants) {
      implant.remainingTicks -= 1;
    }
    const stillActive = implants.filter((implant) => implant.remainingTicks > 0);
    expiredImplants += implants.length - stillActive.length;
    activeImplants += stillActive.length;
    mind.implantedIntents = stillActive;
    const strongest = stillActive.sort((a, b) => b.strength - a.strength)[0];
    if (strongest && !mind.compulsion && strongest.strength > mind.currentIntent.strength) {
      mind.hiddenIntent = strongest.intent;
      mind.currentIntent = strongest.intent;
    }
  }
  return { activeImplants, expiredImplants, compelled };
}

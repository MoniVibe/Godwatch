import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  AbilityDefinition,
  AbilityEffect,
  AbilityId,
  AbilitySchool,
  AbilityStudy,
  DerivedStatKey,
  IdentityAxes,
  Person,
  SkillBlock,
  StatBlock
} from "../types";

const schoolSkill: Record<AbilitySchool, keyof SkillBlock> = {
  martial: "blade",
  ward: "ward",
  sorcery: "sorcery",
  medicine: "medicine",
  survival: "survival",
  diplomacy: "diplomacy",
  command: "command",
  divine: "ward"
};

const schoolStat: Record<AbilitySchool, DerivedStatKey> = {
  martial: "strength",
  ward: "endurance",
  sorcery: "intelligence",
  medicine: "wisdom",
  survival: "perception",
  diplomacy: "charisma",
  command: "charisma",
  divine: "wisdom"
};

export const abilityCompendium: Record<AbilityId, AbilityDefinition> = {
  "rough-strike": {
    id: "rough-strike",
    name: "Rough Strike",
    kind: "strike",
    target: "enemy",
    effect: "damage",
    school: "martial",
    manaCost: 0,
    power: 5,
    aoe: 1,
    tags: ["might", "basic", "melee"],
    description: "A practical weapon attack known by anyone who has survived enough trouble."
  },
  "guarded-cut": {
    id: "guarded-cut",
    name: "Guarded Cut",
    kind: "strike",
    target: "enemy",
    effect: "damage",
    school: "martial",
    manaCost: 0,
    power: 11,
    aoe: 1,
    tags: ["might", "melee", "guard"],
    description: "A measured blade action that keeps the fighter covered while pressing damage.",
    requirements: { blade: 24 },
    statRequirements: { dexterity: 28 }
  },
  "cleaving-blow": {
    id: "cleaving-blow",
    name: "Cleaving Blow",
    kind: "strike",
    target: "cluster",
    effect: "damage",
    school: "martial",
    manaCost: 0,
    power: 12,
    aoe: 2,
    tags: ["might", "melee", "aoe", "cleave", "practical"],
    description: "A heavy practical cut that carries through a close press of enemies.",
    requirements: { blade: 32 },
    statRequirements: { strength: 35 }
  },
  "whirlwind-cut": {
    id: "whirlwind-cut",
    name: "Whirlwind Cut",
    kind: "strike",
    target: "cluster",
    effect: "damage",
    school: "martial",
    manaCost: 0,
    power: 16,
    aoe: 3,
    tags: ["might", "melee", "aoe", "cleave", "practical"],
    description: "Footwork and blade pressure turned into a short, dangerous circle.",
    requirements: { blade: 42 },
    statRequirements: { dexterity: 42 }
  },
  "shield-wall": {
    id: "shield-wall",
    name: "Shield Wall",
    kind: "passive",
    target: "party",
    effect: "guard",
    school: "ward",
    manaCost: 0,
    power: 10,
    aoe: 0,
    tags: ["might", "guard", "party", "passive"],
    description: "The bearer naturally anchors nearby allies and softens incoming blows.",
    requirements: { ward: 24 },
    statRequirements: { endurance: 30 }
  },
  "ember-arc": {
    id: "ember-arc",
    name: "Ember Arc",
    kind: "spell",
    target: "cluster",
    effect: "damage",
    school: "sorcery",
    manaCost: 10,
    power: 15,
    aoe: 3,
    tags: ["magic", "aoe", "fire"],
    description: "A sweeping flame pattern for clustered enemies.",
    requirements: { sorcery: 32 },
    statRequirements: { intelligence: 34 }
  },
  "hex-of-ash": {
    id: "hex-of-ash",
    name: "Hex of Ash",
    kind: "spell",
    target: "enemy",
    effect: "debuff",
    school: "sorcery",
    manaCost: 7,
    power: 11,
    aoe: 1,
    tags: ["magic", "debuff", "corrupt"],
    description: "A spiteful curse that weakens an enemy's next attacks.",
    requirements: { sorcery: 28 },
    statRequirements: { intelligence: 30 }
  },
  "wither-mark": {
    id: "wither-mark",
    name: "Wither Mark",
    kind: "spell",
    target: "enemy",
    effect: "damage",
    school: "sorcery",
    manaCost: 6,
    power: 10,
    aoe: 1,
    tags: ["magic", "debuff", "dot"],
    description: "A lingering mark that turns pain into pressure.",
    requirements: { sorcery: 24 },
    statRequirements: { intelligence: 28 }
  },
  "field-triage": {
    id: "field-triage",
    name: "Field Triage",
    kind: "support",
    target: "ally",
    effect: "heal",
    school: "medicine",
    manaCost: 0,
    power: 9,
    aoe: 1,
    tags: ["heal", "mundane"],
    description: "Bandages, splints, bitter herbs, and fast hands under pressure.",
    requirements: { medicine: 18 },
    statRequirements: { wisdom: 24 }
  },
  "mending-rite": {
    id: "mending-rite",
    name: "Mending Rite",
    kind: "spell",
    target: "ally",
    effect: "heal",
    school: "medicine",
    manaCost: 8,
    power: 14,
    aoe: 1,
    tags: ["heal", "magic", "pure"],
    description: "A disciplined healing rite that spends mana to close the worst damage.",
    requirements: { medicine: 30 },
    statRequirements: { wisdom: 32 }
  },
  "warding-sigil": {
    id: "warding-sigil",
    name: "Warding Sigil",
    kind: "spell",
    target: "party",
    effect: "guard",
    school: "ward",
    manaCost: 9,
    power: 13,
    aoe: 0,
    tags: ["magic", "guard", "party", "pure"],
    description: "A short-lived protective working that turns panic into a held line.",
    requirements: { ward: 30 },
    statRequirements: { wisdom: 30 }
  },
  "fleet-step": {
    id: "fleet-step",
    name: "Fleet Step",
    kind: "spell",
    target: "self",
    effect: "mobility",
    school: "ward",
    manaCost: 5,
    power: 9,
    aoe: 0,
    tags: ["magic", "mobility", "practical"],
    description: "A compact body ward that turns a stumble into a sudden burst of motion.",
    requirements: { ward: 22 },
    statRequirements: { dexterity: 30 }
  },
  pathfinder: {
    id: "pathfinder",
    name: "Pathfinder",
    kind: "passive",
    target: "party",
    effect: "travel",
    school: "survival",
    manaCost: 0,
    power: 11,
    aoe: 0,
    tags: ["travel", "survival", "passive"],
    description: "Reads terrain, spoor, clouds, and bad roads before the band pays the cost.",
    requirements: { survival: 26 },
    statRequirements: { perception: 30 }
  },
  "commanding-presence": {
    id: "commanding-presence",
    name: "Commanding Presence",
    kind: "passive",
    target: "party",
    effect: "buff",
    school: "command",
    manaCost: 0,
    power: 10,
    aoe: 0,
    tags: ["leader", "party", "passive"],
    description: "People fight cleaner when this person is still upright.",
    requirements: { command: 32 },
    statRequirements: { charisma: 31 }
  },
  "battle-cry": {
    id: "battle-cry",
    name: "Battle Cry",
    kind: "tactic",
    target: "party",
    effect: "buff",
    school: "command",
    manaCost: 0,
    power: 10,
    aoe: 0,
    tags: ["might", "battlecry", "aura", "party", "practical"],
    description: "A battlefield shout that makes nearby allies feel less alone.",
    requirements: { command: 22 },
    statRequirements: { charisma: 26 }
  },
  "mercy-oath": {
    id: "mercy-oath",
    name: "Mercy Oath",
    kind: "passive",
    target: "ally",
    effect: "heal",
    school: "divine",
    manaCost: 0,
    power: 8,
    aoe: 0,
    tags: ["forgiving", "pure", "passive"],
    description: "A habit of restraint that makes saving someone feel more natural than finishing a foe.",
    requirements: { medicine: 16 },
    statRequirements: { wisdom: 28 }
  },
  "blood-price": {
    id: "blood-price",
    name: "Blood Price",
    kind: "passive",
    target: "self",
    effect: "damage",
    school: "martial",
    manaCost: 0,
    power: 8,
    aoe: 0,
    tags: ["vengeful", "corrupt", "passive"],
    description: "Old injury turns into focus when an enemy finally comes close.",
    requirements: { blade: 20 },
    statRequirements: { strength: 30 }
  },
  "grave-command": {
    id: "grave-command",
    name: "Grave Command",
    kind: "spell",
    target: "enemy",
    effect: "debuff",
    school: "sorcery",
    manaCost: 9,
    power: 14,
    aoe: 1,
    tags: ["magic", "corrupt", "death", "debuff", "vengeful"],
    description: "A cold command that makes living nerves remember the obedience of dead things.",
    requirements: { sorcery: 34 },
    statRequirements: { intelligence: 36 }
  },
  "banner-of-order": {
    id: "banner-of-order",
    name: "Banner of Order",
    kind: "tactic",
    target: "party",
    effect: "guard",
    school: "command",
    manaCost: 0,
    power: 9,
    aoe: 0,
    tags: ["authoritarian", "party", "guard"],
    description: "A rigid command pattern that protects the band by narrowing everyone's choices.",
    requirements: { command: 24 },
    statRequirements: { charisma: 28 }
  },
  "free-company-oath": {
    id: "free-company-oath",
    name: "Free Company Oath",
    kind: "passive",
    target: "party",
    effect: "social",
    school: "diplomacy",
    manaCost: 0,
    power: 9,
    aoe: 0,
    tags: ["egalitarian", "party", "passive"],
    description: "A shared compact that makes members argue more, desert less, and recover trust faster.",
    requirements: { diplomacy: 24 },
    statRequirements: { charisma: 29 }
  }
};

export const abilityList = Object.values(abilityCompendium);
const maxKnownAbilities = 12;

export function getAbility(id: AbilityId): AbilityDefinition | undefined {
  return abilityCompendium[id];
}

function statValue(stats: StatBlock | undefined, key: DerivedStatKey): number {
  return stats?.derived[key] ?? 50;
}

export function abilityMeetsRequirements(skills: SkillBlock, ability: AbilityDefinition, stats?: StatBlock): boolean {
  const skillsPass = Object.entries(ability.requirements ?? {}).every(([key, minimum]) => skills[key as keyof SkillBlock] >= (minimum ?? 0));
  const statsPass = Object.entries(ability.statRequirements ?? {}).every(
    ([key, minimum]) => statValue(stats, key as DerivedStatKey) >= (minimum ?? 0)
  );
  return skillsPass && statsPass;
}

function identityAffinity(identity: IdentityAxes, ability: AbilityDefinition): number {
  let score = 0;
  if (ability.tags.includes("magic")) score += identity.mightMagic * 0.16;
  if (ability.tags.includes("might")) score -= identity.mightMagic * 0.12;
  if (ability.tags.includes("forgiving")) score += identity.vengefulForgiving * 0.18;
  if (ability.tags.includes("vengeful")) score -= identity.vengefulForgiving * 0.18;
  if (ability.tags.includes("authoritarian")) score -= identity.authoritarianEgalitarian * 0.16;
  if (ability.tags.includes("egalitarian")) score += identity.authoritarianEgalitarian * 0.16;
  if (ability.tags.includes("pure")) score += identity.corruptPure * 0.12;
  if (ability.tags.includes("corrupt")) score -= identity.corruptPure * 0.12;
  if (ability.tags.includes("practical")) score -= Math.max(0, -identity.mightMagic) * 0.08;
  if (ability.tags.includes("death")) score -= identity.evilGood * 0.12;
  return score;
}

function roleAffinity(role: Person["role"], ability: AbilityDefinition): number {
  if (role === "fighter" && (ability.school === "martial" || ability.school === "ward")) return 10;
  if (role === "mage" && ability.school === "sorcery") return 12;
  if (role === "healer" && ability.effect === "heal") return 12;
  if (role === "scout" && ability.school === "survival") return 12;
  if (role === "leader" && (ability.school === "command" || ability.tags.includes("party"))) return 12;
  return 0;
}

function abilityUseScore(person: Person, ability: AbilityDefinition): number {
  const primarySkill = person.skills[schoolSkill[ability.school]];
  const primaryStat = statValue(person.stats, schoolStat[ability.school]);
  const passiveBonus = ability.kind === "passive" || ability.kind === "tactic" ? 4 : 0;
  return (
    ability.power +
    primarySkill * 0.22 +
    primaryStat * 0.18 +
    roleAffinity(person.role, ability) +
    identityAffinity(person.identity, ability) +
    passiveBonus
  );
}

export function abilityLearningAffinity(person: Person, ability: AbilityDefinition): number {
  let score = abilityUseScore(person, ability) * 0.42 + person.traits.curiosity * 0.16 + person.stats.derived.perception * 0.12;
  if (ability.kind === "passive" || ability.kind === "tactic") {
    score += Math.max(0, -person.identity.mightMagic) * 0.22;
    score += person.skills.command * 0.05;
  }
  if (ability.kind === "spell") {
    score += Math.max(0, person.identity.mightMagic) * 0.2;
    score += person.skills.sorcery * 0.08 + person.skills.ward * 0.04;
  }
  if (ability.tags.includes("practical") || ability.tags.includes("mobility") || ability.tags.includes("cleave")) {
    score += Math.max(0, -person.identity.mightMagic) * 0.18;
    score += person.stats.derived.dexterity * 0.06;
  }
  if (ability.effect === "heal" || ability.tags.includes("pure") || ability.tags.includes("forgiving")) {
    score += person.identity.evilGood * 0.16 + person.identity.corruptPure * 0.14 + person.identity.vengefulForgiving * 0.08;
  }
  if (ability.tags.includes("corrupt") || ability.tags.includes("death") || ability.tags.includes("vengeful")) {
    score -= person.identity.evilGood * 0.18 + person.identity.corruptPure * 0.16 + person.identity.vengefulForgiving * 0.08;
  }
  if (ability.school === "diplomacy" || ability.school === "command") {
    score += person.stats.derived.charisma * 0.12;
  }
  return Math.round(score);
}

function pushKnown(ids: AbilityId[], id: AbilityId, skills: SkillBlock, stats: StatBlock): void {
  const ability = abilityCompendium[id];
  if (ability && !ids.includes(id) && abilityMeetsRequirements(skills, ability, stats)) {
    ids.push(id);
  }
}

export function startingAbilityIds(role: Person["role"], skills: SkillBlock, identity: IdentityAxes, stats: StatBlock, rng: Rng): AbilityId[] {
  const ids: AbilityId[] = [];
  pushKnown(ids, "rough-strike", skills, stats);

  if (role === "leader") {
    pushKnown(ids, "commanding-presence", skills, stats);
    pushKnown(ids, "battle-cry", skills, stats);
    pushKnown(ids, identity.authoritarianEgalitarian < 0 ? "banner-of-order" : "free-company-oath", skills, stats);
    pushKnown(ids, "guarded-cut", skills, stats);
  }
  if (role === "fighter") {
    pushKnown(ids, "guarded-cut", skills, stats);
    pushKnown(ids, "cleaving-blow", skills, stats);
    pushKnown(ids, "shield-wall", skills, stats);
  }
  if (role === "healer") {
    pushKnown(ids, "field-triage", skills, stats);
    pushKnown(ids, "mending-rite", skills, stats);
    pushKnown(ids, "mercy-oath", skills, stats);
  }
  if (role === "mage") {
    pushKnown(ids, "ember-arc", skills, stats);
    pushKnown(ids, "hex-of-ash", skills, stats);
    pushKnown(ids, "wither-mark", skills, stats);
    pushKnown(ids, "grave-command", skills, stats);
  }
  if (role === "scout") {
    pushKnown(ids, "pathfinder", skills, stats);
    pushKnown(ids, "fleet-step", skills, stats);
    pushKnown(ids, "guarded-cut", skills, stats);
  }

  if (identity.mightMagic > 28) {
    pushKnown(ids, "ember-arc", skills, stats);
    pushKnown(ids, "wither-mark", skills, stats);
  } else if (identity.mightMagic < -28) {
    pushKnown(ids, "guarded-cut", skills, stats);
    pushKnown(ids, "cleaving-blow", skills, stats);
    pushKnown(ids, "shield-wall", skills, stats);
  }
  if (identity.vengefulForgiving > 34) pushKnown(ids, "mercy-oath", skills, stats);
  if (identity.vengefulForgiving < -34) pushKnown(ids, "blood-price", skills, stats);
  if (identity.authoritarianEgalitarian > 34) pushKnown(ids, "free-company-oath", skills, stats);
  if (identity.authoritarianEgalitarian < -34) pushKnown(ids, "banner-of-order", skills, stats);
  if (identity.corruptPure > 34) pushKnown(ids, "warding-sigil", skills, stats);
  if (identity.corruptPure < -34) pushKnown(ids, "hex-of-ash", skills, stats);

  const candidates = abilityList.filter((ability) => !ids.includes(ability.id) && abilityMeetsRequirements(skills, ability, stats));
  if (ids.length < 4 && candidates.length > 0 && rng.chance(0.42)) {
    const picked = rng.weighted(
      candidates.map((ability) => ({
        value: ability.id,
        weight: Math.max(1, ability.power + identityAffinity(identity, ability) + roleAffinity(role, ability))
      }))
    );
    ids.push(picked);
  }

  return ids.slice(0, 6);
}

export function ensureAbilityIds(person: Person, rng: Rng): AbilityId[] {
  const known = new Set<AbilityId>((person.abilityIds ?? []).filter((id) => Boolean(abilityCompendium[id])));
  const baseline = startingAbilityIds(person.role, person.skills, person.identity, person.stats, rng);
  const minimumAdds = known.size === 0 ? baseline : baseline.slice(0, 3);
  for (const id of minimumAdds) {
    known.add(id);
  }
  person.abilityIds = [...known].slice(0, maxKnownAbilities);
  person.abilityStudy ??= {};
  return person.abilityIds;
}

export function knownAbilities(person: Person): AbilityDefinition[] {
  return (person.abilityIds?.length ? person.abilityIds : ["rough-strike"])
    .map((id) => abilityCompendium[id])
    .filter((ability): ability is AbilityDefinition => Boolean(ability));
}

export function bestKnownAbility(
  person: Person,
  predicate: (ability: AbilityDefinition) => boolean
): AbilityDefinition | undefined {
  return knownAbilities(person)
    .filter(predicate)
    .sort((a, b) => abilityUseScore(person, b) - abilityUseScore(person, a))[0];
}

export function passivePowerBonus(person: Person): number {
  return knownAbilities(person)
    .filter((ability) => ability.kind === "passive" || ability.kind === "tactic")
    .reduce((sum, ability) => sum + ability.power * 0.32 + Math.max(0, identityAffinity(person.identity, ability)) * 0.08, 0);
}

export function partyAbilityBonus(members: Person[], effect: AbilityEffect): number {
  return members.reduce(
    (sum, member) =>
      sum +
      knownAbilities(member)
        .filter((ability) => ability.effect === effect && (ability.kind === "passive" || ability.kind === "tactic"))
        .reduce((memberSum, ability) => memberSum + ability.power, 0),
    0
  );
}

export function learnEligibleAbility(person: Person, rng: Rng): AbilityDefinition | undefined {
  ensureAbilityIds(person, rng);
  if (person.abilityIds.length >= maxKnownAbilities) {
    return undefined;
  }
  const candidates = abilityList.filter(
    (ability) => !person.abilityIds.includes(ability.id) && abilityMeetsRequirements(person.skills, ability, person.stats)
  );
  if (candidates.length === 0) {
    return undefined;
  }
  const learned = rng.weighted(
    candidates.map((ability) => ({
      value: ability,
      weight: Math.max(1, abilityUseScore(person, ability) + abilityLearningAffinity(person, ability) * 0.4)
    }))
  );
  person.abilityIds = [...person.abilityIds, learned.id].slice(0, maxKnownAbilities);
  return learned;
}

function requirementGap(person: Person, ability: AbilityDefinition): number {
  const skillGap = Object.entries(ability.requirements ?? {}).reduce(
    (sum, [key, minimum]) => sum + Math.max(0, (minimum ?? 0) - person.skills[key as keyof SkillBlock]),
    0
  );
  const statGap = Object.entries(ability.statRequirements ?? {}).reduce(
    (sum, [key, minimum]) => sum + Math.max(0, (minimum ?? 0) - statValue(person.stats, key as DerivedStatKey)),
    0
  );
  return skillGap + statGap;
}

export function observeAbilityUse(person: Person, abilityId: AbilityId, tick: number, rng: Rng): AbilityStudy | undefined {
  const ability = abilityCompendium[abilityId];
  if (!ability || person.abilityIds?.includes(abilityId)) {
    return undefined;
  }

  person.abilityStudy ??= {};
  const perception = person.stats.derived.perception;
  const intelligence = person.stats.derived.intelligence;
  const primarySkill = person.skills[schoolSkill[ability.school]];
  const noticed = perception + intelligence * 0.36 + primarySkill * 0.22 + rng.int(-24, 18);
  if (noticed < 42 && rng.chance(0.62)) {
    return undefined;
  }

  const study =
    person.abilityStudy[abilityId] ??
    ({
      abilityId,
      exposure: 0,
      attempts: 0,
      lastObservedTick: tick,
      lastAttemptTick: -1,
      affinity: abilityLearningAffinity(person, ability)
    } satisfies AbilityStudy);
  const clarity = clamp(4 + perception * 0.06 + intelligence * 0.05 + Math.max(0, primarySkill - 20) * 0.04 + rng.int(0, 5), 2, 18);
  study.exposure = clamp(study.exposure + clarity, 0, 160);
  study.lastObservedTick = tick;
  study.affinity = abilityLearningAffinity(person, ability);
  person.abilityStudy[abilityId] = study;
  return study;
}

export function attemptObservedAbilityLearning(person: Person, rng: Rng, tick: number): AbilityDefinition | undefined {
  ensureAbilityIds(person, rng);
  if (person.abilityIds.length >= maxKnownAbilities) {
    return undefined;
  }

  const candidates = Object.values(person.abilityStudy ?? {})
    .map((study) => ({ study, ability: abilityCompendium[study.abilityId] }))
    .filter(
      (entry): entry is { study: AbilityStudy; ability: AbilityDefinition } =>
        Boolean(entry.ability) && !person.abilityIds.includes(entry.study.abilityId) && entry.study.exposure >= 18
    );
  if (candidates.length === 0) {
    return undefined;
  }

  const chosen = rng.weighted(
    candidates.map((entry) => ({
      value: entry,
      weight: Math.max(1, entry.study.exposure + entry.study.affinity * 0.72 - requirementGap(person, entry.ability) * 0.9)
    }))
  );
  const difficulty = 58 + chosen.ability.power * 1.6 + chosen.ability.manaCost * 1.4 + requirementGap(person, chosen.ability) * 1.8;
  const aptitude =
    chosen.study.exposure * 0.82 +
    chosen.study.affinity * 0.36 +
    person.stats.derived.intelligence * 0.22 +
    person.stats.derived.wisdom * 0.08 +
    person.skills[schoolSkill[chosen.ability.school]] * 0.18 +
    chosen.study.attempts * 5 +
    rng.int(-18, 28);

  chosen.study.attempts += 1;
  chosen.study.lastAttemptTick = tick;
  chosen.study.exposure = clamp(chosen.study.exposure + 3, 0, 180);

  if (aptitude < difficulty) {
    return undefined;
  }

  person.abilityIds = [...new Set([...person.abilityIds, chosen.ability.id])].slice(0, maxKnownAbilities);
  delete person.abilityStudy[chosen.ability.id];
  return chosen.ability;
}

export function studiedAbilities(person: Person): { ability: AbilityDefinition; study: AbilityStudy }[] {
  return Object.values(person.abilityStudy ?? {})
    .map((study) => ({ study, ability: abilityCompendium[study.abilityId] }))
    .filter((entry): entry is { ability: AbilityDefinition; study: AbilityStudy } => Boolean(entry.ability))
    .sort((a, b) => b.study.exposure + b.study.affinity * 0.25 - (a.study.exposure + a.study.affinity * 0.25));
}

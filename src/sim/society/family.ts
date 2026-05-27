import { event } from "../chronicle/events";
import { abilityCompendium, attemptObservedAbilityLearning } from "../abilities/compendium";
import { attemptObservedRecipeLearning, craftingRecipes, ensureRecipeKnowledge, recipeLearningAffinity } from "../economy/recipes";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import { identityAxisKeys } from "../individuals/identity";
import { addMemory, createPerson, skillKeys, strongestSkill, traitKeys, validAncestry } from "../individuals/people";
import { ensureSocialMind } from "../individuals/social";
import { coreStatKeys, makeStats } from "../individuals/stats";
import type {
  AbilityDefinition,
  AbilityId,
  AbilitySchool,
  AbilityStudy,
  CraftingRecipeId,
  IdentityAxisKey,
  Id,
  Person,
  RecipeStudy,
  SkillKey,
  World
} from "../types";
import { cultureEffects, cultureForPerson, cultureForSociety, hybridCultureForParents } from "./culture";

const populationSoftCap = 120;
const daysPerYear = 24;

function nextPersonId(world: World, rng: Rng): string {
  let attempt = 0;
  let id = "";
  do {
    id = makeId("person", Object.keys(world.persons).length + world.tick * 10 + rng.int(0, 999) + attempt);
    attempt += 1;
  } while (world.persons[id]);
  return id;
}

function averageParentValue(first: number, second: number, noise: number, min = 0, max = 100): number {
  return clamp(Math.round((first + second) / 2 + noise), min, max);
}

function adultCandidates(world: World, settlementId: string, societyId: string): Person[] {
  return Object.values(world.persons).filter(
    (person) =>
      person.alive &&
      person.locationId === settlementId &&
      person.factionId === societyId &&
      person.age >= 18 &&
      person.age <= 48 &&
      !person.status.includes("child")
  );
}

function skillForSchool(school: AbilitySchool): SkillKey {
  if (school === "martial") return "blade";
  if (school === "divine") return "ward";
  return school;
}

function studyAffinity(person: Person, ability: AbilityDefinition): number {
  let score =
    (person.stats.derived.intelligence - 50) * 0.28 +
    (person.stats.derived.wisdom - 50) * 0.18 +
    person.skills[skillForSchool(ability.school)] * 0.18;
  if (ability.tags.includes("magic")) score += person.identity.mightMagic * 0.18;
  if (ability.tags.includes("might")) score -= person.identity.mightMagic * 0.12;
  if (ability.tags.includes("pure")) score += person.identity.corruptPure * 0.1;
  if (ability.tags.includes("corrupt")) score -= person.identity.corruptPure * 0.12;
  if (ability.tags.includes("healing") || ability.effect === "heal") score += person.identity.evilGood * 0.12;
  if (ability.tags.includes("death")) score -= person.identity.evilGood * 0.14;
  return clamp(Math.round(score), -80, 120);
}

function inheritedStudies(child: Person, parents: Person[], rng: Rng): Record<AbilityId, AbilityStudy> {
  const studies: Record<AbilityId, AbilityStudy> = {};
  const parentAbilities = parents.flatMap((parent) => [
    ...(parent.abilityIds ?? []),
    ...Object.keys(parent.abilityStudy ?? {}).filter((abilityId) => (parent.abilityStudy[abilityId]?.exposure ?? 0) > 22)
  ]);
  const unique = [...new Set(parentAbilities)].filter((abilityId) => abilityCompendium[abilityId] && !child.abilityIds.includes(abilityId));
  for (const abilityId of unique.slice(0, 6)) {
    const ability = abilityCompendium[abilityId];
    if (!ability || !rng.chance(0.54)) continue;
    studies[abilityId] = {
      abilityId,
      exposure: rng.int(8, 24),
      attempts: 0,
      lastObservedTick: -1,
      lastAttemptTick: -1,
      affinity: studyAffinity(child, ability)
    };
    if (Object.keys(studies).length >= 3) break;
  }
  return studies;
}

function inheritedRecipeStudies(child: Person, parents: Person[], rng: Rng): Record<CraftingRecipeId, RecipeStudy> {
  const studies: Record<CraftingRecipeId, RecipeStudy> = {};
  const parentRecipes = parents.flatMap((parent) => [
    ...(parent.recipeIds ?? []),
    ...Object.keys(parent.recipeStudy ?? {}).filter((recipeId) => (parent.recipeStudy[recipeId]?.exposure ?? 0) > 24)
  ]);
  const unique = [...new Set(parentRecipes)].filter((recipeId) => craftingRecipes[recipeId] && !child.recipeIds.includes(recipeId));
  for (const recipeId of unique.slice(0, 6)) {
    const recipe = craftingRecipes[recipeId];
    if (!recipe || !rng.chance(0.48)) continue;
    studies[recipeId] = {
      recipeId,
      exposure: rng.int(7, 22),
      attempts: 0,
      lastObservedTick: -1,
      lastAttemptTick: -1,
      affinity: recipeLearningAffinity(child, recipe)
    };
    if (Object.keys(studies).length >= 3) break;
  }
  return studies;
}

function makeChild(world: World, parentA: Person, parentB: Person, rng: Rng): Person {
  const child = createPerson(rng, nextPersonId(world, rng), parentA.factionId, parentA.locationId, "commoner");
  const parentCultures = [parentA.cultureId, parentB.cultureId].filter(Boolean);
  const culture =
    parentA.cultureId && parentB.cultureId && parentA.cultureId !== parentB.cultureId
      ? hybridCultureForParents(world, parentA, parentB, rng, parentA.factionId)
      : cultureForPerson(world, parentA) ?? cultureForPerson(world, parentB);
  child.age = 0;
  child.familyName = rng.chance(0.58) ? parentA.familyName : parentB.familyName;
  child.title = "";
  child.parentIds = [parentA.id, parentB.id];
  child.childIds = [];
  child.generation = Math.max(parentA.generation ?? 0, parentB.generation ?? 0) + 1;
  child.cultureId = culture?.id ?? parentA.cultureId ?? parentB.cultureId;
  child.birthCultureId = child.cultureId;
  child.heritageCultureIds = [...new Set([child.cultureId, ...parentCultures, ...(parentA.heritageCultureIds ?? []), ...(parentB.heritageCultureIds ?? [])].filter(Boolean))];
  child.cultureBlend = parentA.cultureId !== parentB.cultureId ? 50 : 0;
  child.adoptionStatus = "birth-family";
  child.guardianIds = [];
  child.ancestryLineage = [...new Set([validAncestry(parentA.ancestry), validAncestry(parentB.ancestry), ...(parentA.ancestryLineage ?? []), ...(parentB.ancestryLineage ?? [])])];
  child.ancestry = rng.chance(0.5) ? validAncestry(parentA.ancestry) : validAncestry(parentB.ancestry);
  child.status = ["child"];
  child.renown = 0;
  child.gold = 0;
  child.fatigue = 0;
  child.morale = rng.int(52, 82);
  child.relations = {
    [parentA.id]: rng.int(18, 48),
    [parentB.id]: rng.int(18, 48)
  };

  for (const key of traitKeys) {
    child.traits[key] = averageParentValue(parentA.traits[key], parentB.traits[key], rng.int(-10, 10));
  }
  for (const key of skillKeys) {
    const inherited = (parentA.skills[key] + parentB.skills[key]) * 0.11;
    child.skills[key] = clamp(Math.round(inherited + rng.int(0, 5)), 0, 28);
  }
  for (const key of coreStatKeys) {
    child.stats.core[key] = averageParentValue(parentA.stats.core[key], parentB.stats.core[key], rng.int(-8, 8), 1, 100);
  }
  for (const key of identityAxisKeys) {
    const cultureBias = culture?.values[key as IdentityAxisKey] ?? 0;
    child.identity[key] = clamp(Math.round(((parentA.identity[key] + parentB.identity[key]) / 2) * 0.56 + cultureBias * 0.34 + rng.int(-16, 16)), -100, 100);
  }
  child.stats = makeStats(child.stats.core, child.traits, child.skills);
  child.maxHp = clamp(Math.round(28 + child.stats.derived.endurance * 0.42 + rng.int(0, 8)), 24, 84);
  child.hp = child.maxHp;
  child.maxMana = clamp(Math.round(4 + child.stats.derived.wisdom * 0.12 + child.stats.derived.intelligence * 0.08), 4, 32);
  child.mana = child.maxMana;
  child.abilityIds = child.abilityIds.slice(0, 1);
  child.abilityStudy = inheritedStudies(child, [parentA, parentB], rng);
  child.recipeIds = [];
  child.recipeStudy = inheritedRecipeStudies(child, [parentA, parentB], rng);
  ensureSocialMind(child, rng, world.tick);
  addMemory(child, world, `Born to ${parentA.name} ${parentA.familyName} and ${parentB.name} ${parentB.familyName}`, 10, ["family", "birth"]);
  return child;
}

export function ensureLineage(world: World): void {
  for (const society of Object.values(world.factions)) {
    society.cultureId ??= "";
  }
  for (const person of Object.values(world.persons)) {
    person.status ??= [];
    person.relations ??= {};
    person.parentIds = (person.parentIds ?? []).filter((id) => Boolean(world.persons[id]));
    person.childIds = (person.childIds ?? []).filter((id) => Boolean(world.persons[id]));
    person.generation ??= 0;
    person.cultureId ||= world.factions[person.factionId]?.cultureId ?? "";
    person.birthCultureId ||= person.cultureId;
    person.heritageCultureIds = [...new Set([...(person.heritageCultureIds ?? []), person.birthCultureId, person.cultureId].filter(Boolean))];
    person.cultureBlend = Number.isFinite(person.cultureBlend) ? clamp(person.cultureBlend, 0, 100) : 0;
    person.adoptionStatus ??= "birth-family";
    person.guardianIds = (person.guardianIds ?? []).filter((id) => Boolean(world.persons[id]));
    person.ancestry = validAncestry(person.ancestry);
    person.ancestryLineage = [...new Set([person.ancestry, ...(person.ancestryLineage ?? []).map(validAncestry)])];
    person.recipeIds ??= [];
    person.recipeStudy ??= {};
    if (person.age < 16 && !person.status.includes("child")) {
      person.status = [...person.status, "child"];
    }
  }

  for (const person of Object.values(world.persons)) {
    for (const parentId of person.parentIds) {
      const parent = world.persons[parentId];
      if (parent && !parent.childIds.includes(person.id)) {
        parent.childIds.push(person.id);
      }
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (const person of Object.values(world.persons)) {
      if (person.parentIds.length > 0) {
        person.generation = Math.max(...person.parentIds.map((id) => world.persons[id]?.generation ?? 0)) + 1;
      }
    }
  }
}

function livingParents(world: World, child: Person): Person[] {
  return child.parentIds.map((id) => world.persons[id]).filter((person): person is Person => Boolean(person?.alive));
}

function guardianCandidates(world: World, child: Person, factionId?: Id, settlementId?: Id | null): Person[] {
  const targetFactionId = factionId ?? child.factionId;
  const targetSettlementId = settlementId === undefined ? child.locationId : settlementId;
  return Object.values(world.persons)
    .filter(
      (person) =>
        person.alive &&
        person.age >= 18 &&
        person.id !== child.id &&
        !person.status.includes("child") &&
        (!targetFactionId || person.factionId === targetFactionId) &&
        (!targetSettlementId || person.locationId === targetSettlementId)
    )
    .sort((a, b) => b.stats.derived.wisdom + b.stats.derived.charisma + b.renown * 0.2 - (a.stats.derived.wisdom + a.stats.derived.charisma + a.renown * 0.2));
}

function placeWithGuardian(world: World, child: Person, guardian: Person, rng: Rng, reason: string): void {
  child.guardianIds = [...new Set([...(child.guardianIds ?? []), guardian.id])].slice(0, 3);
  child.fosterCultureId = guardian.cultureId;
  child.heritageCultureIds = [...new Set([...(child.heritageCultureIds ?? []), child.birthCultureId, child.cultureId, guardian.cultureId].filter(Boolean))];
  child.adoptionStatus = child.adoptionStatus === "orphan" ? "ward" : child.adoptionStatus;
  child.status = [...new Set([...child.status, "ward"])];
  child.factionId = guardian.factionId;
  child.locationId = guardian.locationId;
  child.relations[guardian.id] = clamp((child.relations[guardian.id] ?? 0) + rng.int(12, 34), -100, 100);
  guardian.relations[child.id] = clamp((guardian.relations[child.id] ?? 0) + rng.int(8, 28), -100, 100);
  addMemory(child, world, `Became ward of ${guardian.name} ${guardian.familyName}: ${reason}`, 8, ["family", "ward", "foster"]);
  addMemory(guardian, world, `Took ${child.name} ${child.familyName} as a ward`, 5, ["family", "ward", "foster"]);
}

function updateFosterCulture(world: World, child: Person, guardian: Person, rng: Rng): void {
  const fosterCulture = child.fosterCultureId ? world.cultures[child.fosterCultureId] : undefined;
  if (!fosterCulture) {
    return;
  }
  const effects = cultureEffects(fosterCulture);
  const attachment = Math.max(0, child.relations[guardian.id] ?? 0);
  const pressure = 1 + (effects.learning ?? 0) * 0.18 + fosterCulture.tradition * 0.012 + guardian.stats.derived.charisma * 0.014 + attachment * 0.012;
  const resistance = child.age < 7 ? 0.3 : child.traits.loyalty * 0.006 + child.stats.derived.wisdom * 0.004;
  child.cultureBlend = clamp(child.cultureBlend + pressure - resistance + rng.int(0, 1), 0, 100);

  if (child.cultureId !== fosterCulture.id && child.cultureBlend >= 72 && rng.chance(0.16)) {
    child.cultureId = fosterCulture.id;
    child.adoptionStatus = "adopted";
    child.status = [...new Set([...child.status.filter((status) => status !== "orphan"), "adopted"])];
    addMemory(child, world, `Adopted ${fosterCulture.name} as daily custom`, 7, ["family", "foster", "culture"]);
    event(world, "relation", "low", `${child.name} ${child.familyName} adopts ${fosterCulture.name} after years of fostering.`, [child.id, guardian.id], [child.factionId], child.locationId);
    return;
  }

  if (child.cultureId !== fosterCulture.id && child.cultureBlend >= 38 && child.cultureBlend < 72 && rng.chance(0.08)) {
    const hybrid = hybridCultureForParents(world, child, guardian, rng, child.factionId);
    if (hybrid) {
      child.cultureId = hybrid.id;
      child.status = [...new Set([...child.status, "hybrid-culture"])];
      addMemory(child, world, `Balanced birth and foster custom into ${hybrid.name}`, 8, ["family", "foster", "hybrid-culture"]);
    }
  }
}

export function createWardFromConquest(world: World, child: Person, conquerorFactionId: Id, settlementId: Id, rng: Rng): boolean {
  const guardians = guardianCandidates(world, child, conquerorFactionId, settlementId);
  const fallbackGuardians = guardians.length ? guardians : guardianCandidates(world, child, conquerorFactionId, null);
  if (fallbackGuardians.length === 0) {
    return false;
  }
  const guardian = rng.weighted(
    fallbackGuardians.slice(0, 8).map((person) => ({
      value: person,
      weight: 4 + person.stats.derived.wisdom * 0.04 + person.stats.derived.charisma * 0.05 + Math.max(0, person.renown) * 0.04
    }))
  );
  child.adoptionStatus = "ward";
  child.status = [...new Set([...child.status.filter((status) => status !== "orphan"), "ward", "war-ward"])];
  placeWithGuardian(world, child, guardian, rng, `taken in after the conquest of ${world.settlements[settlementId]?.name ?? "their home"}`);
  return true;
}

export function updateOrphansAndWards(world: World, rng: Rng): void {
  const children = Object.values(world.persons).filter((person) => person.alive && person.age < 16);
  for (const child of children) {
    const parents = livingParents(world, child);
    if (parents.length === 0 && child.parentIds.length > 0 && child.adoptionStatus === "birth-family") {
      child.adoptionStatus = "orphan";
      child.status = [...new Set([...child.status, "orphan"])];
      addMemory(child, world, "Lost their birth household", -8, ["family", "orphan"]);
      event(world, "relation", "medium", `${child.name} ${child.familyName} is left without a living birth household.`, [child.id], [child.factionId], child.locationId);
    }

    const guardian = child.guardianIds.map((id) => world.persons[id]).find((person): person is Person => Boolean(person?.alive));
    if ((child.adoptionStatus === "orphan" || child.adoptionStatus === "ward") && !guardian) {
      const candidates = guardianCandidates(world, child);
      if (candidates.length > 0 && rng.chance(0.34)) {
        const chosen = rng.pick(candidates.slice(0, 5));
        placeWithGuardian(world, child, chosen, rng, "local household obligation");
        event(world, "relation", "low", `${chosen.name} ${chosen.familyName} takes ${child.name} ${child.familyName} as a ward.`, [chosen.id, child.id], [chosen.factionId], child.locationId);
      }
    } else if (guardian && child.fosterCultureId) {
      updateFosterCulture(world, child, guardian, rng);
    }
  }
}

export function advanceAges(world: World): void {
  if (world.day <= 1 || world.day % daysPerYear !== 0) {
    return;
  }

  for (const person of Object.values(world.persons)) {
    if (!person.alive) continue;
    person.age += 1;
    if (person.age === 16) {
      person.status = person.status.filter((status) => status !== "child");
      const bestSkill = strongestSkill(person);
      if (person.role === "commoner" && person.skills[bestSkill] >= 24) {
        person.role =
          bestSkill === "sorcery"
            ? "mage"
            : bestSkill === "medicine" || bestSkill === "ward"
              ? "healer"
              : bestSkill === "survival"
                ? "scout"
                : bestSkill === "diplomacy" || bestSkill === "command"
                  ? "leader"
                  : "fighter";
      }
      addMemory(person, world, "Came of age under the eyes of their society", 5, ["family", "coming-of-age"]);
      event(world, "relation", "medium", `${person.name} ${person.familyName} comes of age in ${world.factions[person.factionId]?.name ?? "their society"}.`, [person.id], [person.factionId], person.locationId);
    }
  }
}

export function maybeCreateChild(world: World, rng: Rng): Person | undefined {
  ensureLineage(world);
  if (Object.keys(world.persons).length >= populationSoftCap) {
    return undefined;
  }

  const options = Object.values(world.settlements)
    .map((settlement) => {
      const culture = cultureForSociety(world, settlement.factionId);
      const effects = cultureEffects(culture);
      const adults = adultCandidates(world, settlement.id, settlement.factionId);
      const chance = clamp(
        0.008 + adults.length * 0.0012 + settlement.prosperity * 0.00012 + (effects.birthRate ?? 0) * 0.003 - settlement.threat * 0.00008,
        0,
        0.09
      );
      return { settlement, adults, chance };
    })
    .filter((option) => option.adults.length >= 2 && option.chance > 0);

  if (options.length === 0) {
    return undefined;
  }

  const totalChance = clamp(options.reduce((sum, option) => sum + option.chance, 0), 0, 0.62);
  if (!rng.chance(totalChance)) {
    return undefined;
  }

  const option = rng.weighted(options.map((entry) => ({ value: entry, weight: entry.chance * 1000 })));
  const parentA = rng.pick(option.adults);
  const parentB = rng.weighted(
    option.adults
      .filter((candidate) => candidate.id !== parentA.id)
      .map((candidate) => ({
        value: candidate,
        weight:
          8 +
          Math.max(0, parentA.relations[candidate.id] ?? 0) * 0.3 +
          (candidate.stats.derived.charisma + candidate.stats.derived.wisdom) * 0.03
      }))
  );
  const child = makeChild(world, parentA, parentB, rng);
  world.persons[child.id] = child;
  parentA.childIds = [...new Set([...parentA.childIds, child.id])];
  parentB.childIds = [...new Set([...parentB.childIds, child.id])];
  parentA.relations[child.id] = rng.int(28, 62);
  parentB.relations[child.id] = rng.int(28, 62);
  addMemory(parentA, world, `${child.name} ${child.familyName} is born`, 8, ["family", "child"]);
  addMemory(parentB, world, `${child.name} ${child.familyName} is born`, 8, ["family", "child"]);
  event(
    world,
    "relation",
    "medium",
    `${child.name} ${child.familyName} is born to ${parentA.name} ${parentA.familyName} and ${parentB.name} ${parentB.familyName} in ${option.settlement.name}.`,
    [child.id, parentA.id, parentB.id],
    [child.factionId],
    child.locationId
  );
  return child;
}

export function educateChildren(world: World, rng: Rng): void {
  const children = Object.values(world.persons).filter((person) => person.alive && person.age < 16);
  for (const child of children) {
    const culture = cultureForPerson(world, child);
    const effects = cultureEffects(culture);
    const parentMentors = child.parentIds.map((id) => world.persons[id]).filter((person): person is Person => Boolean(person?.alive));
    const guardianMentors = (child.guardianIds ?? []).map((id) => world.persons[id]).filter((person): person is Person => Boolean(person?.alive));
    const localMentors = Object.values(world.persons).filter(
      (person) => person.alive && person.age >= 16 && person.locationId === child.locationId && person.factionId === child.factionId
    );
    const mentors = parentMentors.length > 0 ? parentMentors : guardianMentors.length > 0 ? guardianMentors : localMentors;
    if (mentors.length === 0 || !rng.chance(0.26 + (effects.learning ?? 0) * 0.018)) {
      continue;
    }

    const mentor = rng.weighted(
      mentors.map((person) => ({
        value: person,
        weight: 4 + person.stats.derived.wisdom * 0.04 + person.stats.derived.charisma * 0.04 + (child.parentIds.includes(person.id) ? 5 : 0)
      }))
    );
    const skill = rng.chance(0.68) ? strongestSkill(mentor) : rng.pick(skillKeys);
    const skillGain = child.age < 7 ? rng.int(0, 1) : rng.int(1, 3);
    child.skills[skill as SkillKey] = clamp(child.skills[skill as SkillKey] + skillGain, 0, 72);
    child.stats = makeStats(child.stats.core, child.traits, child.skills);
    ensureRecipeKnowledge(child, rng, culture);

    const mentorAbility = rng.pick([...(mentor.abilityIds ?? []), ...Object.keys(mentor.abilityStudy ?? {})].length ? [...(mentor.abilityIds ?? []), ...Object.keys(mentor.abilityStudy ?? {})] : [""]);
    const ability = abilityCompendium[mentorAbility];
    if (ability && !child.abilityIds.includes(ability.id) && rng.chance(0.5 + (effects.learning ?? 0) * 0.02)) {
      const study =
        child.abilityStudy[ability.id] ??
        ({
          abilityId: ability.id,
          exposure: 0,
          attempts: 0,
          lastObservedTick: world.tick,
          lastAttemptTick: -1,
          affinity: studyAffinity(child, ability)
        } satisfies AbilityStudy);
      study.exposure = clamp(study.exposure + rng.int(3, 9) + (effects.learning ?? 0), 0, 160);
      study.lastObservedTick = world.tick;
      study.affinity = studyAffinity(child, ability);
      child.abilityStudy[ability.id] = study;
    }

    const mentorRecipe = rng.pick([...(mentor.recipeIds ?? []), ...Object.keys(mentor.recipeStudy ?? {})].length ? [...(mentor.recipeIds ?? []), ...Object.keys(mentor.recipeStudy ?? {})] : [""]);
    const recipe = craftingRecipes[mentorRecipe];
    if (recipe && !child.recipeIds.includes(recipe.id) && rng.chance(0.46 + (effects.learning ?? 0) * 0.018)) {
      const study =
        child.recipeStudy[recipe.id] ??
        ({
          recipeId: recipe.id,
          exposure: 0,
          attempts: 0,
          lastObservedTick: world.tick,
          lastAttemptTick: -1,
          affinity: recipeLearningAffinity(child, recipe)
        } satisfies RecipeStudy);
      study.exposure = clamp(study.exposure + rng.int(3, 8) + (effects.learning ?? 0), 0, 220);
      study.lastObservedTick = world.tick;
      study.affinity = recipeLearningAffinity(child, recipe);
      child.recipeStudy[recipe.id] = study;
    }

    if (child.age >= 10 && rng.chance(0.16 + (effects.learning ?? 0) * 0.01)) {
      const learned = attemptObservedAbilityLearning(child, rng, world.tick);
      if (learned) {
        addMemory(child, world, `Learned ${learned.name} from household and culture`, 6, ["family", "ability", "culture"]);
        event(world, "relation", "low", `${child.name} ${child.familyName} learns ${learned.name} from family teaching.`, [child.id], [child.factionId], child.locationId);
      }
      const learnedRecipe = attemptObservedRecipeLearning(child, rng, world.tick, culture);
      if (learnedRecipe) {
        addMemory(child, world, `Learned ${learnedRecipe.name} from household and culture`, 6, ["family", "recipe", "culture"]);
        event(world, "relation", "low", `${child.name} ${child.familyName} learns ${learnedRecipe.name} from family teaching.`, [child.id], [child.factionId], child.locationId);
      }
    }
  }
}

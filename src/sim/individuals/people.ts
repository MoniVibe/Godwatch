import { familyNames, givenNames } from "../data/content";
import { event } from "../chronicle/events";
import { makeItem, autoEquip, ensureItem, itemEffectBonus } from "../economy/items";
import { clamp, makeId } from "../core/math";
import { passivePowerBonus, startingAbilityIds } from "../abilities/compendium";
import { randomIdentityAxes } from "./identity";
import { makeStats, randomArchetype, randomCoreStats } from "./stats";
import type { Rng } from "../core/rng";
import type { AncestryKey, Band, Memory, Person, SkillBlock, TraitBlock, World } from "../types";

export const traitKeys = ["bravery", "caution", "greed", "mercy", "curiosity", "ambition", "loyalty", "wrath"] as const;
export const skillKeys = ["blade", "ward", "sorcery", "medicine", "survival", "diplomacy", "command"] as const;
const ancestryKeys: AncestryKey[] = ["human", "elder", "deepborn", "skyborn", "ashkin"];

export function livingMembers(world: World, band: Band): Person[] {
  return band.memberIds.map((id) => world.persons[id]).filter((person) => person?.alive);
}

export function ensureBandLeader(world: World, band: Band): Person | undefined {
  const currentLeader = world.persons[band.leaderId];
  if (currentLeader?.alive) {
    return currentLeader;
  }

  const successor = livingMembers(world, band).sort((a, b) => b.skills.command + b.renown * 0.4 - (a.skills.command + a.renown * 0.4))[0];
  if (!successor) {
    return undefined;
  }

  const previousName = currentLeader ? `${currentLeader.name} ${currentLeader.familyName}` : "their leader";
  band.leaderId = successor.id;
  successor.role = "leader";
  successor.renown += 2;
  band.cohesion = clamp(band.cohesion - 14, 0, 100);
  band.goal = `mourning ${previousName}`;
  event(
    world,
    "relation",
    "high",
    `${successor.name} ${successor.familyName} takes command of ${band.name} after ${previousName} falls.`,
    [successor.id],
    [successor.factionId],
    band.locationId
  );
  return successor;
}

export function strongestSkill(person: Person): keyof SkillBlock {
  return skillKeys.reduce((best, key) => (person.skills[key] > person.skills[best] ? key : best), "blade");
}

export function randomTraits(rng: Rng): TraitBlock {
  const traits = {} as TraitBlock;
  for (const key of traitKeys) {
    traits[key] = rng.int(25, 75);
  }
  return traits;
}

export function randomSkills(rng: Rng, role: Person["role"]): SkillBlock {
  const skills = {} as SkillBlock;
  for (const key of skillKeys) {
    skills[key] = rng.int(8, 35);
  }

  if (role === "leader") {
    skills.command += rng.int(18, 32);
    skills.blade += rng.int(8, 18);
  }
  if (role === "fighter") {
    skills.blade += rng.int(18, 34);
    skills.ward += rng.int(8, 20);
  }
  if (role === "healer") {
    skills.medicine += rng.int(24, 38);
    skills.ward += rng.int(8, 18);
  }
  if (role === "mage") {
    skills.sorcery += rng.int(24, 40);
    skills.medicine += rng.int(4, 12);
  }
  if (role === "scout") {
    skills.survival += rng.int(22, 36);
    skills.blade += rng.int(8, 16);
  }

  return skills;
}

export function randomAncestry(rng: Rng): AncestryKey {
  return rng.weighted<AncestryKey>([
    { value: "human", weight: 68 },
    { value: "elder", weight: 8 },
    { value: "deepborn", weight: 8 },
    { value: "skyborn", weight: 7 },
    { value: "ashkin", weight: 9 }
  ]);
}

export function validAncestry(value: string | undefined): AncestryKey {
  return ancestryKeys.includes(value as AncestryKey) ? (value as AncestryKey) : "human";
}

export function makeMemory(world: World, label: string, weight: number, tags: string[], index: number): Memory {
  return {
    id: makeId("memory", world.tick * 1000 + world.events.length + label.length + tags.length + index),
    tick: world.tick,
    label,
    weight,
    tags
  };
}

export function addMemory(person: Person, world: World, label: string, weight: number, tags: string[]): void {
  person.memories.unshift(makeMemory(world, label, weight, tags, person.memories.length));
  if (person.memories.length > 12) {
    person.memories.length = 12;
  }
}

export function adjustTrait(person: Person, key: keyof TraitBlock, delta: number): void {
  person.traits[key] = clamp(person.traits[key] + delta, 0, 100);
}

export function createPerson(rng: Rng, id: string, factionId: string, locationId: string, role: Person["role"]): Person {
  const name = rng.pick(givenNames);
  const familyName = rng.pick(familyNames);
  const traits = randomTraits(rng);
  const skills = randomSkills(rng, role);
  const archetype = randomArchetype(rng, role);
  const stats = makeStats(randomCoreStats(rng, role, archetype), traits, skills);
  const maxHp =
    rng.int(44, 72) +
    Math.round(stats.derived.endurance * 0.72 + stats.derived.strength * 0.18) +
    (role === "fighter" || role === "leader" ? rng.int(10, 24) : 0);
  const maxMana =
    role === "mage" || role === "healer"
      ? rng.int(18, 42) + Math.round(stats.derived.intelligence * 0.35 + stats.derived.wisdom * 0.26)
      : rng.int(4, 18) + Math.round(stats.derived.wisdom * 0.12);
  const identity = randomIdentityAxes(rng, role, traits, skills);
  const abilityIds = startingAbilityIds(role, skills, identity, stats, rng);
  const ancestry = randomAncestry(rng);
  const inventory = [makeItem(rng, "supply"), makeItem(rng, role === "mage" ? "trinket" : "weapon")];
  if (role !== "commoner") {
    inventory.push(makeItem(rng, "consumable"));
  }
  const person: Person = {
    id,
    name,
    familyName,
    age: rng.int(17, 54),
    title: role === "leader" ? rng.pick(["the Keen", "the Weathered", "the Unproven", "the Vowed"]) : "",
    factionId,
    cultureId: "",
    birthCultureId: "",
    heritageCultureIds: [],
    cultureBlend: 0,
    adoptionStatus: "birth-family",
    guardianIds: [],
    ancestry,
    ancestryLineage: [ancestry],
    locationId,
    parentIds: [],
    childIds: [],
    generation: 0,
    alive: true,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    fatigue: rng.int(0, 24),
    morale: rng.int(48, 76),
    renown: role === "leader" ? rng.int(12, 34) : rng.int(0, 14),
    gold: rng.int(2, 24),
    role,
    archetype,
    stats,
    traits,
    skills,
    identity,
    abilityIds,
    abilityStudy: {},
    recipeIds: [],
    recipeStudy: {},
    inventory,
    equipment: {},
    relations: {},
    memories: [],
    status: []
  };
  for (const item of inventory) {
    autoEquip(person, item);
  }
  return person;
}

export function personPower(person: Person): number {
  const weaponItem = person.equipment.weapon ? ensureItem(person.equipment.weapon) : undefined;
  const armorItem = person.equipment.armor ? ensureItem(person.equipment.armor) : undefined;
  const trinketItem = person.equipment.trinket ? ensureItem(person.equipment.trinket) : undefined;
  const weapon = weaponItem?.power ?? 0;
  const armor = armorItem?.power ?? 0;
  const trinket = trinketItem?.power ?? 0;
  const itemEffects =
    itemEffectBonus(weaponItem, "skill", "blade") +
    itemEffectBonus(armorItem, "stat", "endurance") +
    itemEffectBonus(trinketItem, "stat") +
    itemEffectBonus(trinketItem, "ability") * 2;
  const sentientMood = [weaponItem, armorItem, trinketItem].reduce((sum, item) => sum + (item?.sentience ? item.sentience.loyalty * 0.05 + item.sentience.mood * 0.04 : 0), 0);
  const blessing = person.status.includes("blessed") ? 8 : 0;
  const wounds = person.hp / person.maxHp < 0.35 ? -10 : 0;
  const passive = passivePowerBonus(person);
  const stats = person.stats?.derived;
  const statPower = stats
    ? stats.strength * 0.16 +
      stats.dexterity * 0.14 +
      stats.endurance * 0.08 +
      stats.intelligence * 0.12 +
      stats.wisdom * 0.1 +
      stats.perception * 0.06 +
      stats.charisma * 0.04
    : 0;
  return (
    person.skills.blade * 0.7 +
    person.skills.sorcery * 0.55 +
    person.skills.ward * 0.35 +
    person.skills.command * 0.25 +
    weapon * 5 +
    armor * 2 +
    trinket * 2 +
    person.morale * 0.12 -
    person.fatigue * 0.18 +
    blessing +
    wounds +
    passive +
    statPower +
    itemEffects +
    sentientMood
  );
}

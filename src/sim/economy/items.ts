import { itemRoots } from "../data/content";
import { biomeAtSettlement } from "../environment/planet";
import { clamp, makeId } from "../core/math";
import { craftingRecipes, makeItemProvenance } from "./recipes";
import type { Rng } from "../core/rng";
import type {
  CraftingRecipeDefinition,
  CraftingRecipeId,
  Id,
  Item,
  ItemDesire,
  ItemEffect,
  ItemKind,
  ItemMaterial,
  ItemQuality,
  ItemTechLevel,
  ItemTechVariant,
  Person,
  SkillKey,
  World
} from "../types";

export const itemQualityRank: Record<ItemQuality, number> = {
  crude: 0,
  common: 1,
  sturdy: 2,
  fine: 3,
  masterwork: 4,
  enchanted: 5,
  legendary: 6
};

const qualityPowerBonus: Record<ItemQuality, number> = {
  crude: -1,
  common: 0,
  sturdy: 1,
  fine: 2,
  masterwork: 4,
  enchanted: 5,
  legendary: 8
};

const qualityByRank: ItemQuality[] = ["crude", "common", "sturdy", "fine", "masterwork", "enchanted", "legendary"];

const qualityDurability: Record<ItemQuality, number> = {
  crude: 18,
  common: 34,
  sturdy: 52,
  fine: 68,
  masterwork: 88,
  enchanted: 78,
  legendary: 110
};

export const itemMaterialRank: Record<ItemMaterial, number> = {
  wood: 0,
  bone: 0,
  leather: 0,
  bronze: 1,
  iron: 2,
  steel: 3,
  blackwood: 3,
  "moon-iron": 4,
  "relic-glass": 4,
  "storm-quartz": 4,
  "green-amber": 4,
  "saint-ash": 4,
  auramite: 5,
  "living-iron": 5
};

export const itemTechRank: Record<ItemTechLevel, number> = {
  stone: 0,
  bronze: 1,
  iron: 2,
  steel: 3,
  alchemical: 4,
  runic: 5,
  aetheric: 6,
  precursor: 7
};

const materialPowerBonus: Record<ItemMaterial, number> = {
  wood: -1,
  bone: -1,
  leather: -1,
  bronze: 0,
  iron: 1,
  steel: 2,
  blackwood: 2,
  "moon-iron": 3,
  "relic-glass": 3,
  "storm-quartz": 3,
  "green-amber": 2,
  "saint-ash": 2,
  auramite: 5,
  "living-iron": 4
};

const materialDurabilityBonus: Record<ItemMaterial, number> = {
  wood: 4,
  bone: 6,
  leather: 8,
  bronze: 12,
  iron: 20,
  steel: 30,
  blackwood: 34,
  "moon-iron": 42,
  "relic-glass": 24,
  "storm-quartz": 28,
  "green-amber": 22,
  "saint-ash": 18,
  auramite: 56,
  "living-iron": 48
};

const techPowerBonus: Record<ItemTechLevel, number> = {
  stone: -2,
  bronze: -1,
  iron: 0,
  steel: 1,
  alchemical: 2,
  runic: 3,
  aetheric: 4,
  precursor: 6
};

const techVariantPowerBonus: Record<ItemTechVariant, number> = {
  handmade: 0,
  cast: 0,
  forged: 1,
  tempered: 2,
  laminated: 2,
  "rune-bound": 3,
  clockwork: 3,
  vibro: 5,
  "aether-woven": 4,
  soulforged: 6
};

const sentienceNames = ["Ashen Choir", "Old Witness", "Red Counsel", "Cold Oath", "Ninefold Eye", "Hungry Saint", "Mirror Voice"];

function chooseQuality(kind: ItemKind, tier: number, rng: Rng): ItemQuality {
  const relicBias = kind === "relic" ? 2 : 0;
  return rng.weighted<ItemQuality>([
    { value: "crude", weight: Math.max(0, 5 - tier * 2 - relicBias) },
    { value: "common", weight: Math.max(2, 10 - tier) },
    { value: "sturdy", weight: 5 + tier },
    { value: "fine", weight: 2 + tier * 1.4 },
    { value: "masterwork", weight: Math.max(0, tier - 1) * 1.4 + relicBias },
    { value: "enchanted", weight: Math.max(0, tier - 2) + relicBias * 1.6 + (kind === "trinket" ? 1 : 0) },
    { value: "legendary", weight: Math.max(0, tier - 4) * 0.45 + (kind === "relic" ? 0.45 + tier * 0.08 : 0) }
  ]);
}

function materialFromResource(resource: string | undefined): ItemMaterial | undefined {
  if (!resource) return undefined;
  const lower = resource.toLowerCase();
  if (lower.includes("auramite")) return "auramite";
  if (lower.includes("moon") || lower.includes("silver")) return "moon-iron";
  if (lower.includes("storm quartz") || lower.includes("quartz")) return "storm-quartz";
  if (lower.includes("relic glass") || lower.includes("glass")) return "relic-glass";
  if (lower.includes("green amber") || lower.includes("amber")) return "green-amber";
  if (lower.includes("saint ash") || lower.includes("ash")) return "saint-ash";
  if (lower.includes("iron") || lower.includes("copper")) return lower.includes("copper") ? "bronze" : "iron";
  if (lower.includes("ironwood") || lower.includes("blackpine") || lower.includes("wood")) return "blackwood";
  if (lower.includes("wool") || lower.includes("leather") || lower.includes("hide")) return "leather";
  if (lower.includes("bone") || lower.includes("horn")) return "bone";
  return undefined;
}

function chooseMaterial(kind: ItemKind, tier: number, rng: Rng, resource?: string): ItemMaterial {
  const hinted = materialFromResource(resource);
  if (hinted && rng.chance(0.72)) {
    return hinted;
  }
  if (kind === "consumable" || kind === "supply") {
    return rng.weighted<ItemMaterial>([
      { value: "wood", weight: 4 },
      { value: "leather", weight: 3 },
      { value: "bone", weight: 2 },
      { value: "saint-ash", weight: tier > 2 ? 1 : 0 },
      { value: "green-amber", weight: tier > 3 ? 1 : 0 }
    ]);
  }
  return rng.weighted<ItemMaterial>([
    { value: "wood", weight: kind === "weapon" || kind === "trinket" ? 3 : 1 },
    { value: "bone", weight: 2 },
    { value: "leather", weight: kind === "armor" ? 4 : 1 },
    { value: "bronze", weight: Math.max(1, 5 - tier) },
    { value: "iron", weight: 7 },
    { value: "steel", weight: 3 + tier },
    { value: "blackwood", weight: kind === "weapon" || kind === "trinket" ? 2 + tier * 0.4 : 1 },
    { value: "moon-iron", weight: Math.max(0, tier - 1) },
    { value: "relic-glass", weight: kind === "relic" ? 3 + tier : Math.max(0, tier - 2) },
    { value: "storm-quartz", weight: kind === "trinket" || kind === "relic" ? 2 + tier : Math.max(0, tier - 2) },
    { value: "green-amber", weight: kind === "trinket" ? 2 + tier : 1 },
    { value: "saint-ash", weight: kind === "relic" ? 2 + tier : Math.max(0, tier - 2) },
    { value: "auramite", weight: Math.max(0, tier - 4) * 0.7 + (kind === "relic" ? 0.4 : 0) },
    { value: "living-iron", weight: Math.max(0, tier - 4) * 0.55 + (kind === "relic" ? 0.6 : 0) }
  ]);
}

function chooseTechLevel(kind: ItemKind, quality: ItemQuality, material: ItemMaterial, tier: number, rng: Rng): ItemTechLevel {
  const rareMaterial = itemMaterialRank[material] >= 4;
  return rng.weighted<ItemTechLevel>([
    { value: "stone", weight: quality === "crude" ? 2 : 0 },
    { value: "bronze", weight: Math.max(0, 4 - tier) },
    { value: "iron", weight: 6 },
    { value: "steel", weight: 3 + tier },
    { value: "alchemical", weight: Math.max(0, tier - 1) + (kind === "consumable" ? 3 : 0) },
    { value: "runic", weight: Math.max(0, tier - 2) + (quality === "enchanted" || rareMaterial ? 2 : 0) },
    { value: "aetheric", weight: Math.max(0, tier - 3) + (quality === "legendary" ? 2 : 0) },
    { value: "precursor", weight: Math.max(0, tier - 5) * 0.8 + (kind === "relic" && rareMaterial ? 0.8 : 0) }
  ]);
}

function chooseTechVariant(kind: ItemKind, techLevel: ItemTechLevel, quality: ItemQuality, rng: Rng): ItemTechVariant {
  if (techLevel === "stone") return "handmade";
  if (techLevel === "bronze") return rng.pick(["cast", "handmade"] as const);
  if (techLevel === "iron") return rng.pick(["forged", "tempered", "handmade"] as const);
  if (techLevel === "steel") return rng.pick(["forged", "tempered", "laminated"] as const);
  if (techLevel === "alchemical") return kind === "armor" ? rng.pick(["laminated", "aether-woven"] as const) : rng.pick(["tempered", "clockwork"] as const);
  if (techLevel === "runic") return rng.pick(["rune-bound", "tempered", "soulforged"] as const);
  if (techLevel === "aetheric") return rng.pick(["aether-woven", "clockwork", "vibro"] as const);
  return quality === "legendary" || kind === "weapon" ? rng.pick(["vibro", "soulforged"] as const) : rng.pick(["clockwork", "aether-woven"] as const);
}

function qualityAtLeast(quality: ItemQuality, floor: ItemQuality): ItemQuality {
  return qualityByRank[Math.max(itemQualityRank[quality], itemQualityRank[floor])] ?? floor;
}

function qualityPrefix(quality: ItemQuality): string {
  if (quality === "common") {
    return "";
  }
  return `${quality} `;
}

function valueFor(kind: ItemKind, quality: ItemQuality, material: ItemMaterial, techLevel: ItemTechLevel, techVariant: ItemTechVariant, power: number): number {
  const kindValue = kind === "relic" ? 18 : kind === "trinket" ? 8 : kind === "weapon" || kind === "armor" ? 6 : 3;
  return Math.max(1, Math.round(kindValue + power * (2 + itemQualityRank[quality] * 0.9 + itemMaterialRank[material] * 0.55 + itemTechRank[techLevel] * 0.45 + techVariantPowerBonus[techVariant] * 0.18)));
}

function itemName(kind: ItemKind, quality: ItemQuality, material: ItemMaterial, techVariant: ItemTechVariant, root: string): string {
  const qualityText = qualityPrefix(quality);
  const variantText = ["handmade", "cast", "forged"].includes(techVariant) ? "" : `${techVariant} `;
  const cleanRoot = root.replace(/\b(moon-iron|blackwood|silvered|boiled leather|ringmail|lamellar)\s+/gi, "");
  if (kind === "consumable" || kind === "supply") {
    return `${qualityText}${material} ${cleanRoot}`;
  }
  if (kind === "relic") {
    return `the ${qualityText}${material} ${variantText}${cleanRoot}`;
  }
  return `${qualityText}${material} ${variantText}${cleanRoot}`;
}

function itemDesireFor(kind: ItemKind, tags: string[], rng: Rng): ItemDesire {
  if (tags.some((tag) => ["blooded", "hungry", "corrupt", "vengeful"].includes(tag)) || kind === "weapon") {
    return rng.pick(["bloodshed", "dominion", "secrets"] as const);
  }
  if (tags.some((tag) => ["holy", "merciful", "pure"].includes(tag))) {
    return rng.pick(["mercy", "protection", "order"] as const);
  }
  if (kind === "armor") {
    return rng.pick(["protection", "order", "dominion"] as const);
  }
  if (kind === "trinket") {
    return rng.pick(["secrets", "travel", "wealth"] as const);
  }
  return rng.pick(["secrets", "dominion", "wealth", "bloodshed"] as const);
}

function makeEffects(kind: ItemKind, quality: ItemQuality, material: ItemMaterial, techLevel: ItemTechLevel, techVariant: ItemTechVariant, power: number, tags: string[], rng: Rng): ItemEffect[] {
  const rank = itemQualityRank[quality];
  const techRank = itemTechRank[techLevel];
  const effects: ItemEffect[] = [];
  if (rank <= 1 && quality !== "crude") {
    return effects;
  }

  if (kind === "weapon") {
    effects.push({ kind: "skill", target: "blade", magnitude: Math.max(1, Math.floor(power * 0.45)), tags: ["weapon"] });
    if (rank >= 4 || tags.includes("blooded")) {
      effects.push({ kind: "status", target: "enemy", magnitude: Math.max(1, Math.floor(power * 0.25)), chance: 0.18, status: "bleeding", tags: ["on-hit"] });
    }
  } else if (kind === "armor") {
    effects.push({ kind: "resistance", target: "physical", magnitude: Math.max(1, Math.floor(power * 0.6)), tags: ["armor"] });
    if (rank >= 3) {
      effects.push({ kind: "stat", target: "endurance", magnitude: Math.max(1, Math.floor(power * 0.25)), tags: ["armor"] });
    }
  } else if (kind === "trinket" || kind === "relic") {
    effects.push({ kind: "stat", target: rng.pick(["wisdom", "charisma", "intelligence", "perception"] as const), magnitude: Math.max(1, Math.floor(power * 0.28)), tags: ["focus"] });
    if (rank >= 5 || kind === "relic") {
      effects.push({ kind: "ability", target: "bearer", magnitude: 1, abilityId: rng.pick(["warding-sigil", "fleet-step", "battle-cry", "mending-rite"] as const), tags: ["grant"] });
    }
  } else if (kind === "supply") {
    effects.push({ kind: "travel", target: "party", magnitude: Math.max(1, Math.floor(power * 0.35)), tags: ["supply"] });
  } else if (kind === "consumable") {
    effects.push({ kind: "status", target: "self", magnitude: power, chance: 1, status: tags.includes("holy") ? "warded" : "braced", tags: ["consumable"] });
  }

  if (tags.includes("holy")) {
    effects.push({ kind: "resistance", target: "curse", magnitude: Math.max(1, Math.floor(power * 0.3)), tags: ["holy"] });
  }
  if (tags.includes("restless")) {
    effects.push({ kind: "status", target: "bearer", magnitude: 1, chance: 0.08, status: "haunted", tags: ["restless"] });
  }
  if (material === "auramite") {
    effects.push({ kind: "power", target: "aura", magnitude: Math.max(2, Math.floor(power * 0.35)), tags: ["auramite", "aura"] });
  } else if (material === "living-iron") {
    effects.push({ kind: "status", target: "bearer", magnitude: 1, chance: 0.12, status: "hungry-iron", tags: ["living-iron"] });
  } else if (material === "storm-quartz") {
    effects.push({ kind: "skill", target: "sorcery", magnitude: Math.max(1, Math.floor(power * 0.25)), tags: ["storm-quartz"] });
  } else if (material === "relic-glass") {
    effects.push({ kind: "stat", target: "perception", magnitude: Math.max(1, Math.floor(power * 0.22)), tags: ["relic-glass"] });
  } else if (material === "moon-iron") {
    effects.push({ kind: "resistance", target: "curse", magnitude: Math.max(1, Math.floor(power * 0.24)), tags: ["moon-iron"] });
  }
  if (techVariant === "vibro") {
    effects.push({ kind: "status", target: "enemy", magnitude: Math.max(2, Math.floor(power * 0.32)), chance: 0.24, status: "bleeding", tags: ["vibro", "on-hit"] });
  } else if (techVariant === "clockwork") {
    effects.push({ kind: "power", target: "precision", magnitude: Math.max(1, Math.floor(power * 0.25)), tags: ["clockwork"] });
  } else if (techVariant === "aether-woven") {
    effects.push({ kind: "travel", target: "party", magnitude: Math.max(1, Math.floor(power * 0.2)), tags: ["aether"] });
  } else if (techVariant === "soulforged") {
    effects.push({ kind: "stat", target: "willpower", magnitude: Math.max(1, Math.floor(power * 0.28)), tags: ["soul"] });
  }
  if (techRank >= 6 && (kind === "weapon" || kind === "relic")) {
    effects.push({ kind: "ability", target: "bearer", magnitude: 1, abilityId: rng.pick(["ember-arc", "fleet-step", "hex-of-ash"] as const), tags: ["advanced"] });
  }
  return effects.slice(0, quality === "legendary" ? 4 : quality === "enchanted" ? 3 : 2);
}

function maybeSentience(kind: ItemKind, quality: ItemQuality, material: ItemMaterial, techLevel: ItemTechLevel, techVariant: ItemTechVariant, tags: string[], rng: Rng): Item["sentience"] {
  const advancedPressure = itemMaterialRank[material] >= 5 || itemTechRank[techLevel] >= 6 || techVariant === "soulforged";
  const chance = quality === "legendary" ? 0.96 : kind === "relic" && quality === "enchanted" ? 0.42 : kind === "relic" ? 0.18 : advancedPressure ? 0.12 : 0.02;
  if (!rng.chance(chance)) {
    return undefined;
  }
  const desire = itemDesireFor(kind, tags, rng);
  return {
    name: rng.pick(sentienceNames),
    desire,
    willpower: rng.int(28, 86) + itemQualityRank[quality] * 4,
    intelligence: rng.int(16, 78) + (quality === "legendary" ? 14 : 0),
    loyalty: rng.int(-18, 28),
    hunger: desire === "bloodshed" || desire === "dominion" ? rng.int(28, 72) : rng.int(8, 46),
    mood: rng.int(-18, 22),
    lastAppeasedTick: 0,
    memories: []
  };
}

export function ensureItem(item: Item, rng?: Rng): Item {
  const quality = item.quality ?? (item.kind === "relic" ? "enchanted" : "common");
  item.quality = quality;
  item.material ??= item.kind === "armor" ? "leather" : item.kind === "relic" ? "relic-glass" : item.kind === "supply" || item.kind === "consumable" ? "wood" : "iron";
  item.techLevel ??= item.kind === "relic" ? "runic" : item.material === "wood" || item.material === "bone" ? "stone" : "iron";
  item.techVariant ??= item.techLevel === "stone" ? "handmade" : item.techLevel === "runic" ? "rune-bound" : "forged";
  item.maxDurability = Number.isFinite(item.maxDurability)
    ? item.maxDurability
    : qualityDurability[quality] + materialDurabilityBonus[item.material] + Math.max(0, item.power) * 3;
  item.durability = Number.isFinite(item.durability) ? clamp(item.durability, 0, item.maxDurability) : item.maxDurability;
  item.value = Number.isFinite(item.value) ? item.value : valueFor(item.kind, quality, item.material, item.techLevel, item.techVariant, item.power);
  item.effects ??= rng ? makeEffects(item.kind, quality, item.material, item.techLevel, item.techVariant, item.power, item.tags ?? [], rng) : [];
  item.tags = [...new Set([...(item.tags ?? []), quality, item.material, item.techLevel, item.techVariant])];
  item.provenance ??= makeItemProvenance(item);
  item.provenance.ingredients ??= [];
  item.provenance.methods ??= [];
  item.provenance.createdTick ??= 0;
  if (!item.sentience && rng && (quality === "legendary" || item.kind === "relic")) {
    item.sentience = maybeSentience(item.kind, quality, item.material, item.techLevel, item.techVariant, item.tags, rng);
  }
  if (item.sentience) {
    item.sentience.memories ??= [];
    item.sentience.lastAppeasedTick ??= 0;
  }
  return item;
}

export function makeItem(rng: Rng, kind?: ItemKind, tier = 1): Item {
  const actualKind = kind ?? rng.pick(["weapon", "armor", "trinket", "consumable", "relic", "supply"] as const);
  const quality = chooseQuality(actualKind, tier, rng);
  const material = chooseMaterial(actualKind, tier, rng);
  const techLevel = chooseTechLevel(actualKind, quality, material, tier, rng);
  const techVariant = chooseTechVariant(actualKind, techLevel, quality, rng);
  const root = rng.pick(itemRoots[actualKind]);
  const tags: string[] = [actualKind, quality, material, techLevel, techVariant];
  if (rng.chance(0.15 + tier * 0.03 + itemQualityRank[quality] * 0.03)) {
    tags.push(rng.pick(["holy", "old", "blooded", "precise", "restless", "merciful"]));
  }
  const power = Math.max(1, rng.int(1, 4) + tier + qualityPowerBonus[quality] + materialPowerBonus[material] + techPowerBonus[techLevel] + techVariantPowerBonus[techVariant] + (actualKind === "relic" ? 2 : 0));
  const maxDurability =
    actualKind === "consumable" ? 1 : qualityDurability[quality] + materialDurabilityBonus[material] + power * 3 + itemTechRank[techLevel] * 3 + rng.int(-4, 8);
  const item: Item = {
    id: makeId("item", rng.int(100000, 999999)),
    name: itemName(actualKind, quality, material, techVariant, root),
    kind: actualKind,
    quality,
    material,
    techLevel,
    techVariant,
    power,
    value: valueFor(actualKind, quality, material, techLevel, techVariant, power),
    durability: maxDurability,
    maxDurability,
    tags,
    effects: [],
    cursed: actualKind === "relic" && rng.chance(0.18 + itemQualityRank[quality] * 0.02)
  };
  item.provenance = makeItemProvenance(item);
  item.effects = makeEffects(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.power, item.tags, rng);
  item.sentience = maybeSentience(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.tags, rng);
  return item;
}

function craftedQuality(kind: ItemKind, recipe: CraftingRecipeDefinition, crafter: Person, rng: Rng): ItemQuality {
  const base = qualityAtLeast(chooseQuality(kind, recipe.tier, rng), recipe.qualityFloor);
  const recipeSkills = Object.keys(recipe.requiredSkills ?? {}) as SkillKey[];
  const bestSkill = recipeSkills.length ? Math.max(...recipeSkills.map((key) => crafter.skills[key])) : crafter.skills.survival;
  const aptitude = bestSkill + crafter.stats.derived.dexterity * 0.3 + crafter.stats.derived.intelligence * 0.24 + crafter.stats.derived.wisdom * 0.16;
  const upgradeChance = clamp((aptitude - recipe.difficulty * 0.58) / 180, 0.02, 0.44);
  const upgradedRank = itemQualityRank[base] + (rng.chance(upgradeChance) ? 1 : 0) + (rng.chance(upgradeChance * 0.32) ? 1 : 0);
  return qualityByRank[clamp(upgradedRank, itemQualityRank[base], itemQualityRank.legendary)] ?? base;
}

function craftedKind(recipe: CraftingRecipeDefinition, rng: Rng): ItemKind {
  if (recipe.outputKind) {
    return recipe.outputKind;
  }
  if (recipe.tags.includes("alchemy")) {
    return rng.pick(["trinket", "consumable", "supply"] as const);
  }
  if (recipe.tags.includes("holy") || recipe.tags.includes("relic")) {
    return rng.pick(["relic", "trinket", "armor"] as const);
  }
  if (recipe.tags.includes("weapon")) {
    return rng.pick(["weapon", "armor"] as const);
  }
  return rng.pick(["weapon", "armor", "trinket", "supply"] as const);
}

export function makeRecipeItem(world: World, crafter: Person, recipeId: CraftingRecipeId, rng: Rng, settlementId?: Id, featureId?: Id): Item | undefined {
  const recipe = craftingRecipes[recipeId];
  if (!recipe) {
    return undefined;
  }
  const kind = craftedKind(recipe, rng);
  const quality = craftedQuality(kind, recipe, crafter, rng);
  const material = recipe.outputMaterial ?? chooseMaterial(kind, recipe.tier, rng);
  const techLevel = recipe.outputTechLevel ?? chooseTechLevel(kind, quality, material, recipe.tier, rng);
  const techVariant = recipe.outputTechVariant ?? chooseTechVariant(kind, techLevel, quality, rng);
  const root = rng.pick(itemRoots[kind]);
  const tags = [...new Set([kind, quality, material, techLevel, techVariant, recipe.id, ...recipe.tags])];
  const power = Math.max(
    1,
    rng.int(1, 4) +
      recipe.tier +
      qualityPowerBonus[quality] +
      materialPowerBonus[material] +
      techPowerBonus[techLevel] +
      techVariantPowerBonus[techVariant] +
      Math.floor((crafter.skills.survival + crafter.stats.derived.intelligence) / 48) +
      (kind === "relic" ? 2 : 0)
  );
  const maxDurability =
    kind === "consumable" ? 1 : qualityDurability[quality] + materialDurabilityBonus[material] + power * 3 + itemTechRank[techLevel] * 3 + rng.int(2, 14);
  const item: Item = {
    id: makeId("item", world.tick * 1000 + rng.int(100000, 999999)),
    name: itemName(kind, quality, material, techVariant, root),
    kind,
    quality,
    material,
    techLevel,
    techVariant,
    power,
    value: valueFor(kind, quality, material, techLevel, techVariant, power) + recipe.tier * 8,
    durability: maxDurability,
    maxDurability,
    tags,
    effects: [],
    cursed: recipe.id === "soulforging" || (kind === "relic" && rng.chance(0.12 + recipe.tier * 0.02))
  };
  const settlement = settlementId ? world.settlements[settlementId] : undefined;
  const feature = featureId ? world.planet.features[featureId] : undefined;
  item.provenance = makeItemProvenance(item, {
    creatorPersonId: crafter.id,
    creatorName: `${crafter.name} ${crafter.familyName}`,
    cultureId: crafter.cultureId,
    settlementId,
    settlementName: settlement?.name,
    featureId,
    featureName: feature?.name,
    createdTick: world.tick,
    resource: recipe.ingredients[0]
  });
  item.effects = makeEffects(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.power, item.tags, rng);
  item.sentience = maybeSentience(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.tags, rng);
  return ensureItem(item, rng);
}

export function makeBiomeLoot(world: World, settlementId: Id, rng: Rng, tier = 1): Item {
  const biome = biomeAtSettlement(world, settlementId);
  const settlement = world.settlements[settlementId];
  const localResources = settlement?.resources.length ? settlement.resources : biome.resources;
  const resource = rng.pick(localResources);
  const ecologyTag = settlement ? rng.pick([...(settlement.flora ?? []), ...(settlement.fauna ?? []), resource]) : resource;
  const localName = rng.pick(biome.loot);
  const kind = rng.weighted<ItemKind>([
    { value: "weapon", weight: 2 + tier },
    { value: "armor", weight: 2 },
    { value: "trinket", weight: 4 },
    { value: "consumable", weight: 4 },
    { value: "relic", weight: Math.max(1, tier - 1) },
    { value: "supply", weight: 3 }
  ]);
  const material = chooseMaterial(kind, tier, rng, resource);
  const quality = chooseQuality(kind, tier, rng);
  const techLevel = chooseTechLevel(kind, quality, material, tier, rng);
  const techVariant = chooseTechVariant(kind, techLevel, quality, rng);
  const item = makeItem(rng, kind, tier);
  item.quality = quality;
  item.material = material;
  item.techLevel = techLevel;
  item.techVariant = techVariant;
  item.name = kind === "relic" ? `${itemName(kind, quality, material, techVariant, localName)} of ${biome.name}` : itemName(kind, quality, material, techVariant, localName);
  const flavorTags = item.tags.filter((tag) => ["holy", "old", "blooded", "precise", "restless", "merciful"].includes(tag));
  item.tags = [...new Set([kind, quality, material, techLevel, techVariant, ...flavorTags, biome.id, resource, ecologyTag, settlement?.elevationBand ?? "low"])];
  item.power = Math.max(1, item.power + materialPowerBonus[material] + techPowerBonus[techLevel] + techVariantPowerBonus[techVariant] + (kind === "relic" ? 1 : 0));
  item.maxDurability = kind === "consumable" ? 1 : qualityDurability[quality] + materialDurabilityBonus[material] + item.power * 3 + itemTechRank[techLevel] * 3;
  item.durability = item.maxDurability;
  item.value = valueFor(kind, item.quality, item.material, item.techLevel, item.techVariant, item.power);
  item.effects = makeEffects(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.power, item.tags, rng);
  item.provenance = makeItemProvenance(item, {
    settlementId,
    settlementName: settlement?.name,
    createdTick: world.tick,
    resource
  });
  item.sentience = item.sentience ?? maybeSentience(item.kind, item.quality, item.material, item.techLevel, item.techVariant, item.tags, rng);
  ensureItem(item, rng);
  return item;
}

export function itemEffectBonus(item: Item | undefined, kind: ItemEffect["kind"], target?: string): number {
  if (!item) {
    return 0;
  }
  return (item.effects ?? [])
    .filter((effect) => effect.kind === kind && (!target || effect.target === target))
    .reduce((sum, effect) => sum + effect.magnitude, 0);
}

function equipmentScore(item: Item): number {
  return (
    item.power +
    itemQualityRank[item.quality] * 1.5 +
    itemMaterialRank[item.material] * 1.2 +
    itemTechRank[item.techLevel] * 0.9 +
    itemEffectBonus(item, "stat") +
    itemEffectBonus(item, "skill") +
    itemEffectBonus(item, "resistance")
  );
}

export function autoEquip(person: Person, item: Item): boolean {
  ensureItem(item);
  if (item.kind === "weapon") {
    if (!person.equipment.weapon || equipmentScore(item) > equipmentScore(ensureItem(person.equipment.weapon))) {
      person.equipment.weapon = item;
      return true;
    }
  }
  if (item.kind === "armor") {
    if (!person.equipment.armor || equipmentScore(item) > equipmentScore(ensureItem(person.equipment.armor))) {
      person.equipment.armor = item;
      return true;
    }
  }
  if (item.kind === "trinket" || item.kind === "relic") {
    if (!person.equipment.trinket || equipmentScore(item) > equipmentScore(ensureItem(person.equipment.trinket))) {
      person.equipment.trinket = item;
      return true;
    }
  }
  return false;
}

export function useConsumable(person: Person, kind: ItemKind): Item | undefined {
  const index = person.inventory.findIndex((item) => item.kind === kind);
  if (index === -1) {
    return undefined;
  }
  return person.inventory.splice(index, 1)[0];
}

export function rememberItem(item: Item, tick: number, label: string, weight: number, tags: string[]): void {
  if (!item.sentience) {
    return;
  }
  item.sentience.memories.unshift({
    id: makeId("item-memory", tick * 100 + item.sentience.memories.length),
    tick,
    label,
    weight,
    tags
  });
  item.sentience.memories = item.sentience.memories.slice(0, 8);
}

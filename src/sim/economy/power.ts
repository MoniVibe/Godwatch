import { clamp } from "../core/math";
import { itemMaterialRank, itemQualityRank, itemTechRank } from "./items";
import type {
  Item,
  ItemKind,
  ItemMaterial,
  ItemPowerCell,
  ItemQuality,
  ItemTechLevel,
  ItemTechVariant,
  MaterialItemAdjustments,
  MaterialProfile,
  MaterialPropertyKey,
  Person,
  PersonResourceState,
  PowerChannel,
  ResourcePool,
  ResourcePoolKey
} from "../types";

export interface AlloyIngredient {
  material: ItemMaterial;
  ratio: number;
  purity?: number;
}

export interface ResourceTickResult {
  focusRecovered: number;
  energyRecovered: number;
  chargeRecovered: number;
  itemChargeRecovered: number;
  itemChargeDrained: number;
}

const materialPropertyKeys: MaterialPropertyKey[] = ["hardness", "sharpness", "conductivity", "resonance", "purity", "volatility"];

export const baseMaterialProfiles: Record<ItemMaterial, MaterialProfile> = {
  wood: { hardness: 18, sharpness: 12, conductivity: 12, resonance: 22, purity: 52, volatility: 18, tags: ["organic", "burnable"] },
  bone: { hardness: 28, sharpness: 24, conductivity: 8, resonance: 34, purity: 48, volatility: 22, tags: ["organic", "ritual"] },
  leather: { hardness: 16, sharpness: 6, conductivity: 6, resonance: 14, purity: 46, volatility: 14, tags: ["organic", "flexible"] },
  bronze: { hardness: 42, sharpness: 38, conductivity: 58, resonance: 28, purity: 54, volatility: 18, tags: ["metal", "alloy"] },
  iron: { hardness: 58, sharpness: 52, conductivity: 42, resonance: 32, purity: 56, volatility: 18, tags: ["metal", "ferrous"] },
  steel: { hardness: 72, sharpness: 68, conductivity: 38, resonance: 35, purity: 62, volatility: 16, tags: ["metal", "alloy", "ferrous"] },
  blackwood: { hardness: 54, sharpness: 36, conductivity: 20, resonance: 48, purity: 60, volatility: 20, tags: ["organic", "fey", "resonant"] },
  "moon-iron": { hardness: 66, sharpness: 58, conductivity: 48, resonance: 72, purity: 76, volatility: 22, tags: ["metal", "lunar", "ward"] },
  "relic-glass": { hardness: 48, sharpness: 74, conductivity: 64, resonance: 82, purity: 70, volatility: 34, tags: ["crystal", "memory", "fragile"] },
  "storm-quartz": { hardness: 62, sharpness: 44, conductivity: 88, resonance: 86, purity: 68, volatility: 48, tags: ["crystal", "storm", "battery"] },
  "green-amber": { hardness: 34, sharpness: 18, conductivity: 52, resonance: 64, purity: 58, volatility: 42, tags: ["organic", "alchemy", "battery"] },
  "saint-ash": { hardness: 22, sharpness: 12, conductivity: 26, resonance: 78, purity: 92, volatility: 20, tags: ["holy", "ash", "ward"] },
  auramite: { hardness: 82, sharpness: 68, conductivity: 86, resonance: 92, purity: 82, volatility: 36, tags: ["metal", "aether", "battery"] },
  "living-iron": { hardness: 78, sharpness: 62, conductivity: 56, resonance: 74, purity: 38, volatility: 66, tags: ["metal", "hungry", "alive"] }
};

const qualityPurityBonus: Record<ItemQuality, number> = {
  crude: -22,
  common: -8,
  sturdy: 0,
  fine: 8,
  masterwork: 16,
  enchanted: 20,
  legendary: 28
};

const techConductivityBonus: Record<ItemTechLevel, number> = {
  stone: -8,
  bronze: 0,
  iron: 2,
  steel: 4,
  alchemical: 12,
  runic: 14,
  aetheric: 22,
  precursor: 30
};

const variantModifiers: Record<ItemTechVariant, Partial<Record<MaterialPropertyKey, number>> & { tags: string[] }> = {
  handmade: { purity: -4, tags: ["handmade"] },
  cast: { hardness: -3, conductivity: 4, tags: ["cast"] },
  forged: { hardness: 5, sharpness: 3, tags: ["forged"] },
  tempered: { hardness: 9, sharpness: 8, volatility: -4, tags: ["tempered"] },
  laminated: { hardness: 7, resonance: 4, volatility: -2, tags: ["laminated"] },
  "rune-bound": { resonance: 16, purity: 8, conductivity: 5, tags: ["runic"] },
  clockwork: { conductivity: 14, sharpness: 2, volatility: 4, tags: ["clockwork"] },
  vibro: { sharpness: 18, conductivity: 12, volatility: 8, tags: ["vibro"] },
  "aether-woven": { resonance: 18, conductivity: 16, hardness: -2, tags: ["aether"] },
  soulforged: { resonance: 22, purity: -10, volatility: 16, tags: ["soul"] }
};

function cloneProfile(profile: MaterialProfile): MaterialProfile {
  return { ...profile, tags: [...profile.tags] };
}

function applyProfileDelta(profile: MaterialProfile, key: MaterialPropertyKey, delta: number): void {
  profile[key] = clamp(Math.round(profile[key] + delta), 0, 100);
}

function makePool(current: number, max: number, regenPerTick: number, tags: string[]): ResourcePool {
  const safeMax = Math.max(1, Math.round(max));
  return {
    current: clamp(Math.round(current), 0, safeMax),
    max: safeMax,
    regenPerTick: Math.max(0, regenPerTick),
    tags
  };
}

function channelForItem(item: Item, profile: MaterialProfile): PowerChannel {
  if (item.techLevel === "aetheric" || item.techLevel === "precursor" || profile.tags.includes("aether")) return "aether";
  if (item.techVariant === "clockwork" || item.techVariant === "vibro") return "mechanical";
  if (item.techLevel === "alchemical" || profile.tags.includes("alchemy")) return "chemical";
  if (item.tags.includes("holy") || profile.tags.includes("holy")) return "divine";
  if (item.techLevel === "runic" || profile.resonance >= 74) return "mana";
  return "body";
}

function normalizeResourceState(person: Person, state: PersonResourceState, tick: number): PersonResourceState {
  state.focus = state.focus ?? makePool(0, 1, 0, ["focus"]);
  state.energy = state.energy ?? makePool(0, 1, 0, ["energy"]);
  state.charge = state.charge ?? makePool(0, 1, 0, ["charge"]);
  state.battery ??= makePool(0, Math.max(1, Math.round((person.stats.derived.intelligence + person.stats.derived.endurance) * 0.12)), 0.02, ["battery"]);
  state.lastUpdatedTick = Number.isFinite(state.lastUpdatedTick) ? state.lastUpdatedTick : tick;
  return state;
}

export function materialProfileFor(material: ItemMaterial, purity = 0): MaterialProfile {
  const profile = cloneProfile(baseMaterialProfiles[material]);
  if (purity !== 0) {
    applyProfileDelta(profile, "purity", purity);
    applyProfileDelta(profile, "volatility", -purity * 0.18);
  }
  return profile;
}

export function deriveAlloyProfile(ingredients: AlloyIngredient[], tags: string[] = []): MaterialProfile {
  const usable = ingredients.filter((ingredient) => ingredient.ratio > 0);
  const totalRatio = usable.reduce((sum, ingredient) => sum + ingredient.ratio, 0);
  if (usable.length === 0 || totalRatio <= 0) {
    return materialProfileFor("iron");
  }

  const profile: MaterialProfile = { hardness: 0, sharpness: 0, conductivity: 0, resonance: 0, purity: 0, volatility: 0, tags: ["alloy", ...tags] };
  for (const ingredient of usable) {
    const weight = ingredient.ratio / totalRatio;
    const source = materialProfileFor(ingredient.material, ingredient.purity ?? 0);
    for (const key of materialPropertyKeys) {
      profile[key] += source[key] * weight;
    }
    profile.tags.push(ingredient.material, ...source.tags);
  }
  for (const key of materialPropertyKeys) {
    profile[key] = clamp(Math.round(profile[key]), 0, 100);
  }
  const metalCount = usable.filter((ingredient) => baseMaterialProfiles[ingredient.material].tags.includes("metal")).length;
  if (metalCount >= 2) {
    applyProfileDelta(profile, "hardness", 5);
    applyProfileDelta(profile, "sharpness", 4);
  }
  profile.tags = [...new Set(profile.tags)];
  return profile;
}

export function techVariantProfile(variant: ItemTechVariant): Partial<Record<MaterialPropertyKey, number>> & { tags: string[] } {
  return { ...variantModifiers[variant], tags: [...variantModifiers[variant].tags] };
}

export function deriveItemMaterialProfile(item: Item): MaterialProfile {
  const profile = materialProfileFor(item.material, qualityPurityBonus[item.quality] ?? 0);
  applyProfileDelta(profile, "conductivity", techConductivityBonus[item.techLevel] ?? 0);
  applyProfileDelta(profile, "resonance", Math.max(0, itemTechRank[item.techLevel] - 3) * 4);
  const modifiers = variantModifiers[item.techVariant];
  for (const key of materialPropertyKeys) {
    const delta = modifiers[key];
    if (delta !== undefined) {
      applyProfileDelta(profile, key, delta);
    }
  }
  profile.tags = [...new Set([...profile.tags, ...modifiers.tags, item.material, item.techLevel, item.techVariant])];
  return profile;
}

export function ensureItemMaterialProfile(item: Item): MaterialProfile {
  item.materialProfile = deriveItemMaterialProfile(item);
  return item.materialProfile;
}

export function deriveMaterialItemAdjustments(item: Item, profile: MaterialProfile = deriveItemMaterialProfile(item)): MaterialItemAdjustments {
  const weaponBias = item.kind === "weapon" ? profile.sharpness * 0.05 + profile.hardness * 0.025 : 0;
  const armorBias = item.kind === "armor" ? profile.hardness * 0.07 + Math.max(0, profile.purity - profile.volatility) * 0.025 : 0;
  const focusBias = item.kind === "trinket" || item.kind === "relic" ? profile.resonance * 0.06 + profile.conductivity * 0.035 : 0;
  const powerDelta = Math.round((weaponBias + armorBias + focusBias + itemMaterialRank[item.material] * 0.5 + itemTechRank[item.techLevel] * 0.35) / 3);
  const durabilityDelta = Math.round(profile.hardness * 0.42 + profile.purity * 0.16 - profile.volatility * 0.22 - (item.kind === "consumable" ? 30 : 0));
  const valueMultiplier = clamp(1 + (profile.purity + profile.resonance + profile.conductivity - profile.volatility) / 360, 0.5, 2.2);
  const effectTags = [
    profile.hardness >= 70 ? "hard" : undefined,
    profile.sharpness >= 70 ? "sharp" : undefined,
    profile.conductivity >= 70 ? "conductive" : undefined,
    profile.resonance >= 70 ? "resonant" : undefined,
    profile.purity >= 80 ? "pure" : undefined,
    profile.volatility >= 55 ? "volatile" : undefined
  ].filter((tag): tag is string => Boolean(tag));
  return { powerDelta, durabilityDelta, valueMultiplier, effectTags };
}

export function ensurePersonResources(person: Person, tick = 0): PersonResourceState {
  const focusMax = 10 + person.stats.derived.wisdom * 0.22 + person.stats.derived.intelligence * 0.22 + person.stats.core.willpower * 0.18;
  const energyMax = 12 + person.stats.derived.endurance * 0.34 + person.stats.derived.strength * 0.16 + Math.max(0, 80 - person.fatigue) * 0.08;
  const chargeMax = 4 + person.skills.sorcery * 0.12 + person.skills.ward * 0.1 + person.stats.derived.perception * 0.08;
  person.resources ??= {
    focus: makePool(focusMax, focusMax, 0.18 + person.stats.derived.wisdom / 520, ["focus", "mental"]),
    energy: makePool(energyMax, energyMax, 0.24 + person.stats.derived.endurance / 430, ["energy", "stamina"]),
    charge: makePool(chargeMax * 0.45, chargeMax, 0.06 + Math.max(person.skills.sorcery, person.skills.ward) / 800, ["charge", "mana"]),
    battery: makePool(0, Math.max(1, Math.round((person.stats.derived.intelligence + person.stats.derived.endurance) * 0.12)), 0.02, ["battery"]),
    lastUpdatedTick: tick
  };
  return normalizeResourceState(person, person.resources, tick);
}

export function spendPersonResource(person: Person, key: ResourcePoolKey, amount: number): boolean {
  const resources = ensurePersonResources(person);
  const pool = key === "battery" ? resources.battery : resources[key];
  if (!pool || pool.current < amount) {
    return false;
  }
  pool.current = clamp(pool.current - amount, 0, pool.max);
  return true;
}

export function recoverPersonResources(person: Person, ticks = 1, currentTick = 0): PersonResourceState {
  const resources = ensurePersonResources(person, currentTick);
  const fatiguePenalty = clamp(1 - person.fatigue / 160, 0.35, 1);
  const pools: ResourcePool[] = [resources.focus, resources.energy, resources.charge, ...(resources.battery ? [resources.battery] : [])];
  for (const pool of pools) {
    pool.current = clamp(pool.current + pool.regenPerTick * Math.max(0, ticks) * fatiguePenalty, 0, pool.max);
  }
  resources.lastUpdatedTick = currentTick;
  return resources;
}

export function ensureItemPowerCell(item: Item): ItemPowerCell {
  const profile = item.materialProfile ?? ensureItemMaterialProfile(item);
  const techRank = itemTechRank[item.techLevel];
  const capacity = Math.max(1, Math.round(item.power * 6 + techRank * 10 + profile.conductivity * 0.24 + profile.resonance * 0.18 + itemQualityRank[item.quality] * 3));
  const channel = channelForItem(item, profile);
  item.powerCell ??= {
    channel,
    charge: capacity,
    capacity,
    drainPerUse: Math.max(1, Math.round(1 + item.power * 0.18 + (item.kind === "armor" ? 1 : 0))),
    rechargePerTick: channel === "body" ? 0 : Math.max(0.05, (profile.conductivity + profile.resonance - profile.volatility) / 900),
    stable: profile.volatility <= profile.purity + 8,
    tags: [...new Set(["power-cell", channel, ...(profile.tags.includes("battery") ? ["battery"] : [])])]
  };
  item.powerCell.capacity = Math.max(item.powerCell.capacity, capacity);
  item.powerCell.charge = clamp(item.powerCell.charge, 0, item.powerCell.capacity);
  return item.powerCell;
}

export function spendItemCharge(item: Item, amount?: number): boolean {
  const cell = ensureItemPowerCell(item);
  const drain = amount ?? cell.drainPerUse;
  if (cell.charge < drain) {
    return false;
  }
  cell.charge = clamp(cell.charge - drain, 0, cell.capacity);
  return true;
}

export function rechargeItem(item: Item, amount?: number): number {
  const cell = ensureItemPowerCell(item);
  const before = cell.charge;
  cell.charge = clamp(cell.charge + (amount ?? cell.rechargePerTick), 0, cell.capacity);
  return cell.charge - before;
}

export function itemNeedsPowerCell(item: Item): boolean {
  return item.powerCell !== undefined || item.techLevel === "aetheric" || item.techLevel === "precursor" || ["clockwork", "vibro", "aether-woven"].includes(item.techVariant);
}

function itemEquippedKind(item: Item, kind: ItemKind): boolean {
  return item.kind === kind;
}

export function tickPowerResources(person: Person, items: Item[] = Object.values(person.equipment).filter((item): item is Item => Boolean(item)), currentTick = 0): ResourceTickResult {
  const before = ensurePersonResources(person, currentTick);
  const beforeFocus = before.focus.current;
  const beforeEnergy = before.energy.current;
  const beforeCharge = before.charge.current;
  recoverPersonResources(person, Math.max(1, currentTick - before.lastUpdatedTick), currentTick);

  let itemChargeRecovered = 0;
  let itemChargeDrained = 0;
  for (const item of items) {
    if (!itemNeedsPowerCell(item)) {
      continue;
    }
    const cell = ensureItemPowerCell(item);
    const recovered = rechargeItem(item);
    itemChargeRecovered += recovered;
    if (itemEquippedKind(item, "armor") && item.tags.includes("power-armor")) {
      const drain = Math.max(0.1, cell.drainPerUse * 0.2);
      if (cell.charge >= drain) {
        cell.charge = clamp(cell.charge - drain, 0, cell.capacity);
        itemChargeDrained += drain;
      } else {
        spendPersonResource(person, "energy", drain);
        itemChargeDrained += drain;
      }
    }
  }

  const after = ensurePersonResources(person, currentTick);
  return {
    focusRecovered: after.focus.current - beforeFocus,
    energyRecovered: after.energy.current - beforeEnergy,
    chargeRecovered: after.charge.current - beforeCharge,
    itemChargeRecovered,
    itemChargeDrained
  };
}

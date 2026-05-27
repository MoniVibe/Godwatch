import { event } from "../chronicle/events";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  AncestryKey,
  CulturePracticeDefinition,
  CulturePracticeId,
  CraftingRecipeId,
  CultureState,
  Faction as Society,
  FactionKind,
  Id,
  Person,
  QuestKind,
  Settlement,
  World
} from "../types";

export const culturePracticeDefinitions: Record<CulturePracticeId, CulturePracticeDefinition> = {
  "oral-lineages": {
    id: "oral-lineages",
    name: "Oral Lineages",
    domain: "lore",
    tier: 1,
    cost: 42,
    requires: [],
    tags: ["family", "memory", "children"],
    description: "Families preserve names, grudges, routes, and small truths across generations.",
    effects: { learning: 2, stability: 1, birthRate: 1 }
  },
  "muster-drills": {
    id: "muster-drills",
    name: "Muster Drills",
    domain: "warfare",
    tier: 1,
    cost: 48,
    requires: [],
    tags: ["training", "warfare"],
    description: "Common signals and drills make fighters easier to raise and harder to scatter.",
    effects: { defense: 2, learning: 1 }
  },
  "road-wardens": {
    id: "road-wardens",
    name: "Road Wardens",
    domain: "survival",
    tier: 1,
    cost: 46,
    requires: [],
    tags: ["travel", "scouting"],
    description: "Named wardens keep paths, ford lore, weather signs, and warning cairns alive.",
    effects: { travel: 2, prosperity: 1, learning: 1 }
  },
  "field-surgery": {
    id: "field-surgery",
    name: "Field Surgery",
    domain: "medicine",
    tier: 1,
    cost: 52,
    requires: [],
    tags: ["medicine", "healing"],
    description: "Battlefield care becomes a taught practice rather than a lucky mercy.",
    effects: { medicine: 3, stability: 1 }
  },
  "scribe-circles": {
    id: "scribe-circles",
    name: "Scribe Circles",
    domain: "lore",
    tier: 2,
    cost: 76,
    requires: ["oral-lineages"],
    tags: ["record", "research", "children"],
    description: "Records turn memory into reference and make deeper study possible.",
    effects: { learning: 4, stability: 1 }
  },
  "apprentice-guilds": {
    id: "apprentice-guilds",
    name: "Apprentice Guilds",
    domain: "craft",
    tier: 2,
    cost: 78,
    requires: ["oral-lineages"],
    tags: ["children", "craft", "production"],
    description: "Children and young adults are placed into structured teaching chains.",
    effects: { learning: 3, prosperity: 2 }
  },
  "charter-courts": {
    id: "charter-courts",
    name: "Charter Courts",
    domain: "governance",
    tier: 2,
    cost: 82,
    requires: ["scribe-circles"],
    tags: ["law", "settlement"],
    description: "Disputes are resolved by remembered precedent instead of immediate power.",
    effects: { stability: 4, prosperity: 1 }
  },
  "ward-letters": {
    id: "ward-letters",
    name: "Ward Letters",
    domain: "sorcery",
    tier: 2,
    cost: 84,
    requires: ["scribe-circles"],
    tags: ["magic", "research"],
    description: "Magical forms become notations that can be compared, criticized, and refined.",
    effects: { magic: 4, learning: 2 }
  },
  "grain-ledgers": {
    id: "grain-ledgers",
    name: "Grain Ledgers",
    domain: "commerce",
    tier: 2,
    cost: 74,
    requires: ["road-wardens"],
    tags: ["stores", "trade"],
    description: "Food, tithes, and trade stops are counted before scarcity turns political.",
    effects: { prosperity: 4, stability: 1, birthRate: 1 }
  },
  "sanctuary-houses": {
    id: "sanctuary-houses",
    name: "Sanctuary Houses",
    domain: "medicine",
    tier: 3,
    cost: 116,
    requires: ["field-surgery", "grain-ledgers"],
    tags: ["health", "children"],
    description: "Dedicated houses care for the sick, pregnant, orphaned, and war-wounded.",
    effects: { medicine: 5, birthRate: 2, stability: 2 }
  },
  "signal-banners": {
    id: "signal-banners",
    name: "Signal Banners",
    domain: "warfare",
    tier: 3,
    cost: 108,
    requires: ["muster-drills", "scribe-circles"],
    tags: ["battlecry", "coordination"],
    description: "Doctrine becomes visible at distance, letting bands coordinate under fear.",
    effects: { defense: 4, learning: 2 }
  },
  "star-road-maps": {
    id: "star-road-maps",
    name: "Star Road Maps",
    domain: "survival",
    tier: 3,
    cost: 118,
    requires: ["road-wardens", "ward-letters"],
    tags: ["travel", "magic", "scouting"],
    description: "Road, sky, and ward lore are unified into a living travel science.",
    effects: { travel: 5, magic: 1, prosperity: 2 }
  }
};

const practiceList = Object.values(culturePracticeDefinitions);

const cultureNames: Record<FactionKind, string[]> = {
  barony: ["Crown Toll", "Oathfield", "Banner Hearth"],
  freehold: ["Open Hearth", "Common Ford", "Green Moot"],
  guild: ["Ledger Bell", "Brass Measure", "Ink Road"],
  cult: ["Veiled Choir", "Ash Prayer", "Sainted Vein"],
  clan: ["Stone Kin", "Red Antler", "River Blood"]
};

function cultureValueBias(kind: FactionKind): CultureState["values"] {
  if (kind === "barony") return { authoritarianEgalitarian: -34, warlikePeaceful: -8, materialistSpiritualist: -4 };
  if (kind === "freehold") return { authoritarianEgalitarian: 34, evilGood: 12, warlikePeaceful: 10 };
  if (kind === "guild") return { materialistSpiritualist: -26, authoritarianEgalitarian: 8, corruptPure: -4 };
  if (kind === "cult") return { materialistSpiritualist: 36, corruptPure: -12, mightMagic: 22 };
  return { vengefulForgiving: -12, cravenBold: 16, warlikePeaceful: -14 };
}

function ancestryWeights(kind: FactionKind): Partial<Record<AncestryKey, number>> {
  if (kind === "barony") return { human: 76, elder: 8, ashkin: 8, deepborn: 4, skyborn: 4 };
  if (kind === "freehold") return { human: 58, elder: 16, skyborn: 12, ashkin: 8, deepborn: 6 };
  if (kind === "guild") return { human: 54, deepborn: 22, ashkin: 10, elder: 8, skyborn: 6 };
  if (kind === "cult") return { human: 46, ashkin: 22, elder: 14, skyborn: 10, deepborn: 8 };
  return { human: 50, deepborn: 18, ashkin: 14, elder: 10, skyborn: 8 };
}

function initialPractices(kind: FactionKind): CulturePracticeId[] {
  if (kind === "barony") return ["oral-lineages", "muster-drills"];
  if (kind === "freehold") return ["oral-lineages", "road-wardens"];
  if (kind === "guild") return ["oral-lineages"];
  if (kind === "cult") return ["oral-lineages", "field-surgery"];
  return ["oral-lineages", "muster-drills"];
}

function initialRecipeIds(kind: FactionKind): CraftingRecipeId[] {
  if (kind === "barony") return ["hearth-forging", "tempered-steel-arms"];
  if (kind === "guild") return ["hearth-forging", "green-amber-alchemy"];
  if (kind === "cult") return ["hearth-forging", "saint-ash-consecration"];
  if (kind === "clan") return ["hearth-forging", "tempered-steel-arms"];
  return ["hearth-forging"];
}

function practiceRecipeUnlocks(practiceId: CulturePracticeId, kind: FactionKind): CraftingRecipeId[] {
  if (practiceId === "apprentice-guilds") return kind === "guild" ? ["tempered-steel-arms", "storm-quartz-focusing"] : ["tempered-steel-arms"];
  if (practiceId === "ward-letters") return kind === "cult" ? ["moon-iron-warding", "saint-ash-consecration"] : ["moon-iron-warding"];
  if (practiceId === "star-road-maps") return ["aether-weaving"];
  if (practiceId === "sanctuary-houses") return ["saint-ash-consecration"];
  return [];
}

export function createCulture(rng: Rng, society: Society): CultureState {
  const completedPracticeIds = initialPractices(society.kind);
  const culture: CultureState = {
    id: makeId("culture", Number(society.id.replace(/\D/g, "")) || rng.int(1000, 9999)),
    name: `${rng.pick(cultureNames[society.kind])} ${society.kind === "cult" ? "Rite" : society.kind === "guild" ? "Compact" : "Tradition"}`,
    societyId: society.id,
    level: 1 + completedPracticeIds.length,
    cohesion: rng.int(36, 76),
    tradition: rng.int(34, 82),
    values: cultureValueBias(society.kind),
    completedPracticeIds,
    knownRecipeIds: initialRecipeIds(society.kind),
    parentCultureIds: [],
    ancestryWeights: ancestryWeights(society.kind),
    research: {
      practiceId: "road-wardens",
      progress: rng.int(0, 20)
    }
  };
  culture.research.practiceId = chooseNextPractice(culture, society, rng)?.id ?? "road-wardens";
  return culture;
}

export function ensureCultures(world: World, rng: Rng): void {
  world.cultures ??= {};
  for (const society of Object.values(world.factions)) {
    if (!society.cultureId || !world.cultures[society.cultureId]) {
      const culture = createCulture(rng, society);
      world.cultures[culture.id] = culture;
      society.cultureId = culture.id;
    }
    const culture = world.cultures[society.cultureId];
    if (culture) {
      culture.knownRecipeIds = [...new Set([...(culture.knownRecipeIds ?? []), ...initialRecipeIds(society.kind)])];
      culture.parentCultureIds ??= [];
      culture.ancestryWeights ??= ancestryWeights(society.kind);
    }
  }
  for (const person of Object.values(world.persons)) {
    const society = world.factions[person.factionId];
    person.cultureId ||= society?.cultureId ?? "";
    person.birthCultureId ||= person.cultureId;
    person.heritageCultureIds = [...new Set([...(person.heritageCultureIds ?? []), person.birthCultureId || person.cultureId].filter(Boolean))];
  }
}

export function cultureForSociety(world: World, societyId: Id): CultureState | undefined {
  const society = world.factions[societyId];
  return society ? world.cultures[society.cultureId] : undefined;
}

export function cultureForPerson(world: World, person: Person): CultureState | undefined {
  return world.cultures[person.cultureId] ?? cultureForSociety(world, person.factionId);
}

export function hybridCultureForParents(world: World, first: Person, second: Person, rng: Rng, societyId = first.factionId): CultureState | undefined {
  const firstCulture = cultureForPerson(world, first);
  const secondCulture = cultureForPerson(world, second);
  if (!firstCulture || !secondCulture) {
    return firstCulture ?? secondCulture;
  }
  if (firstCulture.id === secondCulture.id) {
    return firstCulture;
  }

  const parentIds = [firstCulture.id, secondCulture.id].sort();
  const existing = Object.values(world.cultures).find(
    (culture) => (culture.parentCultureIds ?? []).length === 2 && [...culture.parentCultureIds].sort().join("|") === parentIds.join("|")
  );
  if (existing) {
    return existing;
  }

  const values: CultureState["values"] = {};
  for (const key of new Set([...Object.keys(firstCulture.values), ...Object.keys(secondCulture.values)])) {
    const axis = key as keyof CultureState["values"];
    values[axis] = clamp(Math.round(((firstCulture.values[axis] ?? 0) + (secondCulture.values[axis] ?? 0)) / 2 + rng.int(-6, 6)), -100, 100);
  }

  const ancestry: Partial<Record<AncestryKey, number>> = {};
  for (const key of new Set([...Object.keys(firstCulture.ancestryWeights ?? {}), ...Object.keys(secondCulture.ancestryWeights ?? {})])) {
    const ancestryKey = key as AncestryKey;
    ancestry[ancestryKey] = Math.round(((firstCulture.ancestryWeights?.[ancestryKey] ?? 0) + (secondCulture.ancestryWeights?.[ancestryKey] ?? 0)) / 2);
  }

  const culture: CultureState = {
    id: makeId("culture", world.tick * 100 + Object.keys(world.cultures).length + rng.int(0, 999)),
    name: `${firstCulture.name.split(" ")[0]}-${secondCulture.name.split(" ")[0]} Bridge Custom`,
    societyId,
    level: Math.max(1, Math.floor((firstCulture.level + secondCulture.level) / 2)),
    cohesion: clamp(Math.round((firstCulture.cohesion + secondCulture.cohesion) / 2) - rng.int(4, 12), 0, 100),
    tradition: clamp(Math.round((firstCulture.tradition + secondCulture.tradition) / 2) - rng.int(2, 8), 0, 100),
    values,
    completedPracticeIds: [...new Set([...firstCulture.completedPracticeIds, ...secondCulture.completedPracticeIds])].slice(0, 5),
    knownRecipeIds: [...new Set([...(firstCulture.knownRecipeIds ?? []), ...(secondCulture.knownRecipeIds ?? [])])].slice(0, 7),
    parentCultureIds: parentIds,
    ancestryWeights: ancestry,
    research: {
      practiceId: firstCulture.research.practiceId,
      progress: 0
    }
  };
  world.cultures[culture.id] = culture;
  event(world, "world", "medium", `${culture.name} emerges between ${firstCulture.name} and ${secondCulture.name}.`, [], [societyId]);
  return culture;
}

export function hasPractice(culture: CultureState | undefined, practiceId: CulturePracticeId): boolean {
  return Boolean(culture?.completedPracticeIds.includes(practiceId));
}

export function cultureEffects(culture: CultureState | undefined): CulturePracticeDefinition["effects"] {
  const totals: CulturePracticeDefinition["effects"] = {};
  for (const practiceId of culture?.completedPracticeIds ?? []) {
    const practice = culturePracticeDefinitions[practiceId];
    if (!practice) continue;
    for (const [key, value] of Object.entries(practice.effects)) {
      const effectKey = key as keyof CulturePracticeDefinition["effects"];
      totals[effectKey] = (totals[effectKey] ?? 0) + (value ?? 0);
    }
  }
  return totals;
}

export function cultureQuestBias(culture: CultureState | undefined, kind: QuestKind): number {
  const effects = cultureEffects(culture);
  if (kind === "defense") return ((effects.defense ?? 0) + (effects.stability ?? 0)) * 0.9;
  if (kind === "delve") return ((effects.magic ?? 0) + (effects.learning ?? 0)) * 0.85;
  if (kind === "hunt") return ((effects.travel ?? 0) + (effects.defense ?? 0)) * 0.8;
  if (kind === "escort") return ((effects.travel ?? 0) + (effects.prosperity ?? 0)) * 0.85;
  return ((effects.stability ?? 0) + (effects.prosperity ?? 0)) * 0.8;
}

export function cultureLearningBonus(culture: CultureState | undefined): number {
  const effects = cultureEffects(culture);
  return (effects.learning ?? 0) + (hasPractice(culture, "apprentice-guilds") ? 3 : 0) + (hasPractice(culture, "scribe-circles") ? 2 : 0);
}

export function chooseNextPractice(culture: CultureState, society: Society, rng: Rng): CulturePracticeDefinition | undefined {
  const available = practiceList.filter(
    (practice) =>
      !culture.completedPracticeIds.includes(practice.id) &&
      practice.requires.every((required) => culture.completedPracticeIds.includes(required)) &&
      practice.tier <= culture.level + 1
  );
  if (available.length === 0) {
    return undefined;
  }
  return rng.weighted(
    available.map((practice) => ({
      value: practice,
      weight:
        1 +
        (practice.domain === "warfare" ? society.military * 0.05 : 0) +
        (practice.domain === "sorcery" ? society.magic * 0.06 : 0) +
        (practice.domain === "commerce" || practice.domain === "craft" ? society.wealth * 0.05 : 0) +
        (practice.domain === "governance" || practice.domain === "lore" ? society.stability * 0.04 : 0) +
        (practice.domain === "medicine" ? culture.tradition * 0.03 : 0) +
        (practice.domain === "survival" ? culture.cohesion * 0.03 : 0)
    }))
  );
}

export function updateCultures(world: World, rng: Rng): void {
  ensureCultures(world, rng);
  if (world.tick % 3 !== 0) {
    return;
  }
  for (const culture of Object.values(world.cultures)) {
    const society = world.factions[culture.societyId];
    if (!society) continue;
    const practice = culturePracticeDefinitions[culture.research.practiceId] ?? chooseNextPractice(culture, society, rng);
    if (!practice) continue;

    const settlements = Object.values(world.settlements).filter((settlement) => settlement.factionId === society.id);
    const population = settlements.reduce((sum, settlement) => sum + settlement.population, 0);
    const progress =
      5 +
      culture.level * 0.65 +
      society.wealth * 0.035 +
      society.stability * 0.03 +
      society.magic * (practice.domain === "sorcery" ? 0.07 : 0.015) +
      population / 2800 +
      rng.int(0, 4);
    culture.research.progress = clamp(culture.research.progress + progress, 0, practice.cost);
    culture.cohesion = clamp(culture.cohesion + rng.int(-1, 1), 0, 100);

    if (culture.research.progress < practice.cost) {
      continue;
    }

    culture.completedPracticeIds = [...new Set([...culture.completedPracticeIds, practice.id])];
    const newRecipeIds = practiceRecipeUnlocks(practice.id, society.kind).filter((recipeId) => !(culture.knownRecipeIds ?? []).includes(recipeId));
    culture.knownRecipeIds = [...new Set([...(culture.knownRecipeIds ?? []), ...newRecipeIds])];
    culture.level = Math.max(culture.level, 1 + Math.floor(culture.completedPracticeIds.length / 2));
    culture.tradition = clamp(culture.tradition + rng.int(1, 4), 0, 100);
    const next = chooseNextPractice(culture, society, rng);
    culture.research = {
      practiceId: next?.id ?? practice.id,
      progress: 0
    };
    const recipeLine = newRecipeIds.length ? ` Recipe lore spreads: ${newRecipeIds.map((id) => id.replace(/-/g, " ")).join(", ")}.` : "";
    event(world, "world", "medium", `${culture.name} develops ${practice.name}; ${society.name} changes how it teaches and governs.${recipeLine}`, [], [society.id]);
  }
}

export function applySettlementCulture(world: World, settlement: Settlement, rng: Rng): void {
  const culture = cultureForSociety(world, settlement.factionId);
  const effects = cultureEffects(culture);
  settlement.prosperity = clamp(settlement.prosperity + Math.floor((effects.prosperity ?? 0) / 3), 0, 100);
  settlement.defense = clamp(settlement.defense + Math.floor((effects.defense ?? 0) / 4), 0, 100);
  settlement.threat = clamp(settlement.threat - Math.floor(((effects.defense ?? 0) + (effects.travel ?? 0)) / 5), 0, 100);
  if (rng.chance((effects.stability ?? 0) / 70)) {
    settlement.unrest = clamp(settlement.unrest - 1, 0, 100);
  }
}

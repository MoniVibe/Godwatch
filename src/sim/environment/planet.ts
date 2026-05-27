import { biomeProfiles, regions } from "../data/content";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import type {
  BiomeKey,
  BiomeProfile,
  ElevationBand,
  Id,
  MediumLayer,
  MediumRegion,
  PlanetMedium,
  Settlement,
  TerrainKind,
  TopographyKind,
  TravelRoute,
  WorldFeature,
  WorldFeatureKind,
  World
} from "../types";

export interface ElevationEcology {
  flora: string[];
  fauna: string[];
  resources: string[];
  threats: string[];
}

export const terrainTravelCost: Record<TerrainKind, number> = {
  plains: 1,
  forest: 1.22,
  marsh: 1.45,
  hills: 1.32,
  riverlands: 1.12,
  ruins: 1.58
};

export const terrainHazard: Record<TerrainKind, number> = {
  plains: 5,
  forest: 14,
  marsh: 19,
  hills: 15,
  riverlands: 9,
  ruins: 24
};

export const terrainColor: Record<TerrainKind, string> = {
  plains: "#7d8f5b",
  forest: "#4f7a53",
  marsh: "#617a6b",
  hills: "#9a7c55",
  riverlands: "#5d8b91",
  ruins: "#8f7f8f"
};

export const topographyTravelCost: Record<TopographyKind, number> = {
  basin: 0.06,
  lowland: 0,
  wetland: 0.28,
  valley: 0.04,
  rolling: 0.12,
  highland: 0.28,
  ridge: 0.44,
  plateau: 0.22,
  cliff: 0.62,
  mountain: 0.78
};

export const topographyHazard: Record<TopographyKind, number> = {
  basin: 5,
  lowland: 1,
  wetland: 16,
  valley: 3,
  rolling: 5,
  highland: 12,
  ridge: 18,
  plateau: 10,
  cliff: 25,
  mountain: 31
};

export const topographyPassDifficulty: Record<TopographyKind, number> = {
  basin: 6,
  lowland: 2,
  wetland: 20,
  valley: 5,
  rolling: 9,
  highland: 22,
  ridge: 36,
  plateau: 24,
  cliff: 48,
  mountain: 62
};

export const elevationBandTravelCost: Record<ElevationBand, number> = {
  low: 0,
  middle: 0.06,
  high: 0.18,
  alpine: 0.38
};

export const elevationBandHazard: Record<ElevationBand, number> = {
  low: 0,
  middle: 4,
  high: 10,
  alpine: 22
};

export const elevationBandLabels: Record<ElevationBand, string> = {
  low: "low",
  middle: "middle",
  high: "high",
  alpine: "alpine"
};

const topographyElevationRange: Record<TopographyKind, [number, number]> = {
  basin: [0, 260],
  lowland: [35, 420],
  wetland: [0, 230],
  valley: [120, 780],
  rolling: [180, 920],
  highland: [650, 1700],
  ridge: [880, 2350],
  plateau: [720, 1900],
  cliff: [420, 2300],
  mountain: [1450, 3700]
};

const biomeElevationShift: Record<BiomeKey, number> = {
  sunmeadow: 20,
  blackpine: 120,
  sableFen: -70,
  oldRoad: 80,
  brokenUplands: 430,
  lowMarch: -60
};

const topographyWeightsByTerrain: Record<TerrainKind, { value: TopographyKind; weight: number }[]> = {
  plains: [
    { value: "lowland", weight: 5 },
    { value: "rolling", weight: 4 },
    { value: "valley", weight: 2 },
    { value: "basin", weight: 1 }
  ],
  forest: [
    { value: "valley", weight: 3 },
    { value: "rolling", weight: 4 },
    { value: "highland", weight: 3 },
    { value: "ridge", weight: 1 }
  ],
  marsh: [
    { value: "wetland", weight: 5 },
    { value: "basin", weight: 4 },
    { value: "lowland", weight: 2 },
    { value: "valley", weight: 1 }
  ],
  hills: [
    { value: "highland", weight: 4 },
    { value: "ridge", weight: 3 },
    { value: "plateau", weight: 3 },
    { value: "mountain", weight: 1 }
  ],
  riverlands: [
    { value: "valley", weight: 5 },
    { value: "lowland", weight: 4 },
    { value: "basin", weight: 2 },
    { value: "wetland", weight: 2 }
  ],
  ruins: [
    { value: "rolling", weight: 2 },
    { value: "ridge", weight: 2 },
    { value: "plateau", weight: 2 },
    { value: "valley", weight: 2 },
    { value: "cliff", weight: 1 }
  ]
};

const biomeTopographyBias: Record<BiomeKey, { value: TopographyKind; weight: number }[]> = {
  sunmeadow: [
    { value: "lowland", weight: 3 },
    { value: "rolling", weight: 3 },
    { value: "valley", weight: 1 }
  ],
  blackpine: [
    { value: "valley", weight: 2 },
    { value: "rolling", weight: 2 },
    { value: "highland", weight: 2 },
    { value: "ridge", weight: 1 }
  ],
  sableFen: [
    { value: "wetland", weight: 4 },
    { value: "basin", weight: 3 },
    { value: "lowland", weight: 2 }
  ],
  oldRoad: [
    { value: "plateau", weight: 2 },
    { value: "ridge", weight: 2 },
    { value: "valley", weight: 1 },
    { value: "cliff", weight: 1 }
  ],
  brokenUplands: [
    { value: "highland", weight: 3 },
    { value: "ridge", weight: 3 },
    { value: "plateau", weight: 2 },
    { value: "mountain", weight: 2 }
  ],
  lowMarch: [
    { value: "lowland", weight: 3 },
    { value: "valley", weight: 3 },
    { value: "wetland", weight: 2 },
    { value: "basin", weight: 2 }
  ]
};

const ecologyByBiomeAndElevation: Record<BiomeKey, Record<ElevationBand, ElevationEcology>> = {
  sunmeadow: {
    low: {
      flora: ["sweetgrass", "reed clover", "low sunflowers"],
      fauna: ["field hares", "thorn jackals", "amber bees"],
      resources: ["sungrain", "wild flax", "amber honey"],
      threats: ["thorn jackals", "locust sprites"]
    },
    middle: {
      flora: ["chalk thyme", "slope barley", "whiteleaf shrubs"],
      fauna: ["scrub goats", "grass falcons", "hill foxes"],
      resources: ["white clay", "chalk thyme", "falcon feathers"],
      threats: ["bandit gleaners", "hill fox packs"]
    },
    high: {
      flora: ["wind oats", "golden lichen", "stone sage"],
      fauna: ["stone larks", "ridge aurochs", "storm hares"],
      resources: ["stone sage", "golden lichen", "ridge amber"],
      threats: ["dry-grass revenants", "ridge aurochs"]
    },
    alpine: {
      flora: ["frost grass", "suncrust moss", "thin-air poppies"],
      fauna: ["white ravens", "ice hares", "cloud moths"],
      resources: ["suncrust moss", "thin-air poppies", "sky chalk"],
      threats: ["white ravens", "wind-starved dead"]
    }
  },
  blackpine: {
    low: {
      flora: ["black ferns", "mire cedar", "shadecap beds"],
      fauna: ["moss wolves", "bark rats", "green moths"],
      resources: ["shadecap mushrooms", "blackpine resin", "mire cedar"],
      threats: ["moss wolves", "rootbound dead"]
    },
    middle: {
      flora: ["ironwood groves", "needle moss", "amber fungus"],
      fauna: ["needle deer", "bark owls", "branch cats"],
      resources: ["ironwood", "green amber", "needle moss"],
      threats: ["needle archers", "bark witches"]
    },
    high: {
      flora: ["stormpine", "cold sap lichen", "hanging bracken"],
      fauna: ["black eagles", "ridge bears", "snow moths"],
      resources: ["stormpine pitch", "cold sap", "eagle quills"],
      threats: ["ridge bears", "storm-crowned witches"]
    },
    alpine: {
      flora: ["frostpine", "icecap fungus", "blue needle moss"],
      fauna: ["glass owls", "pale lynx", "snow beetles"],
      resources: ["frostpine needles", "icecap fungus", "blue amber"],
      threats: ["pale lynx", "glass-eyed dead"]
    }
  },
  sableFen: {
    low: {
      flora: ["sour reeds", "moonmilk blooms", "black peat moss"],
      fauna: ["lamp eels", "reed crabs", "bog adders"],
      resources: ["sour reeds", "moonmilk", "black peat"],
      threats: ["lamp eels", "bog ghouls"]
    },
    middle: {
      flora: ["fen willow", "silt orchids", "bog iron blooms"],
      fauna: ["mud geese", "fen boars", "lantern flies"],
      resources: ["bog iron", "silt orchids", "fen willow"],
      threats: ["fen hags", "mud-crowned deserters"]
    },
    high: {
      flora: ["mist heather", "cold reeds", "carrion bells"],
      fauna: ["mist stags", "white leeches", "carrion kites"],
      resources: ["mist heather", "cold reed fiber", "white leech oil"],
      threats: ["carrion kites", "mist-stag stampedes"]
    },
    alpine: {
      flora: ["ice reeds", "bogglass moss", "pale bellflowers"],
      fauna: ["bogglass moths", "ice newts", "thin crows"],
      resources: ["bogglass moss", "ice reeds", "pale bellflowers"],
      threats: ["thin crows", "frozen fen wights"]
    }
  },
  oldRoad: {
    low: {
      flora: ["crackweed", "grave nettle", "roadside ivy"],
      fauna: ["glass-fed spiders", "toll crows", "ash rats"],
      resources: ["old mortar", "saint ash", "roadside ivy"],
      threats: ["glass-fed spiders", "toll ghosts"]
    },
    middle: {
      flora: ["milestone moss", "silver thistle", "shrine roses"],
      fauna: ["mirror moths", "road foxes", "oath crows"],
      resources: ["road silver", "milestone moss", "silver thistle"],
      threats: ["oathless legionaries", "road saints"]
    },
    high: {
      flora: ["relic lichen", "wind roses", "old cedar scrub"],
      fauna: ["cliff swifts", "mirror hawks", "stone dogs"],
      resources: ["relic glass", "wind roses", "mirror hawk feathers"],
      threats: ["mirror wights", "stone dogs"]
    },
    alpine: {
      flora: ["saint snowmoss", "bellflower frost", "glasswort"],
      fauna: ["bell crows", "white spiders", "summit goats"],
      resources: ["saint snowmoss", "glasswort", "summit salt"],
      threats: ["white spiders", "summit road saints"]
    }
  },
  brokenUplands: {
    low: {
      flora: ["goat grass", "cairn nettle", "copper moss"],
      fauna: ["storm-bitten goats", "stone kites", "marmots"],
      resources: ["goat wool", "copper moss", "cairn nettle"],
      threats: ["cairn bandits", "storm-bitten goats"]
    },
    middle: {
      flora: ["storm heather", "sky salt crusts", "shelf pine"],
      fauna: ["stone kites", "crag goats", "red marmots"],
      resources: ["sky salt", "copper bloom", "storm heather"],
      threats: ["stone kites", "cairn bandits"]
    },
    high: {
      flora: ["thunder lichen", "knifegrass", "blue shelf moss"],
      fauna: ["crag ogres", "black condors", "ridge rams"],
      resources: ["storm quartz", "thunder lichen", "ridge ram horn"],
      threats: ["crag ogres", "black condors"]
    },
    alpine: {
      flora: ["frost lichen", "cloud nettle", "summit moss"],
      fauna: ["ice kites", "summit goats", "white rams"],
      resources: ["frost lichen", "cloud nettle", "summit quartz"],
      threats: ["ice kites", "summit ogres"]
    }
  },
  lowMarch: {
    low: {
      flora: ["blue rushes", "flood reeds", "salt grass"],
      fauna: ["silt serpents", "river crabs", "eel shoals"],
      resources: ["blue rushes", "eel oil", "salt fish"],
      threats: ["silt serpents", "river raiders"]
    },
    middle: {
      flora: ["willow groves", "river mint", "pearlwort"],
      fauna: ["toll herons", "flood deer", "river otters"],
      resources: ["river pearls", "river mint", "willow bark"],
      threats: ["toll ghosts", "flood cultists"]
    },
    high: {
      flora: ["spring moss", "cold rush", "cliff willow"],
      fauna: ["spring stags", "silver trout", "cliff herons"],
      resources: ["spring moss", "silver trout", "cliff willow"],
      threats: ["cliff herons", "spring-flood wraiths"]
    },
    alpine: {
      flora: ["snow rush", "glacier mint", "white pearlwort"],
      fauna: ["snow trout", "white herons", "ice crabs"],
      resources: ["glacier mint", "snow trout", "white pearlwort"],
      threats: ["ice crabs", "glacier toll ghosts"]
    }
  }
};

const biomeKeys = Object.keys(biomeProfiles) as BiomeKey[];

export const mineableFeatureKinds = new Set<WorldFeatureKind>(["ore-vein", "crystal-seam", "salt-pocket", "peat-bed"]);

export const featureKindLabels: Record<WorldFeatureKind, string> = {
  "ore-vein": "ore vein",
  "crystal-seam": "crystal seam",
  "salt-pocket": "salt pocket",
  "peat-bed": "peat bed",
  "mushroom-grotto": "mushroom grotto",
  cavern: "cavern",
  crevice: "crevice",
  "underground-river": "underground river",
  "ancient-vault": "ancient vault",
  "floating-island": "floating island",
  "sky-ruin": "sky ruin"
};

export const layerLabels: Record<MediumLayer, string> = {
  surface: "surface",
  underground: "underground",
  deep: "deep",
  sky: "sky"
};

const featureNameRoots: Record<WorldFeatureKind, string[]> = {
  "ore-vein": ["red ore vein", "black iron seam", "copper bloom", "moon-metal scratch"],
  "crystal-seam": ["storm crystal seam", "green glass vein", "singing quartz shelf", "cold sapphire seam"],
  "salt-pocket": ["sky-salt pocket", "white brine hollow", "buried salt rib", "bitter salt chamber"],
  "peat-bed": ["black peat bed", "sour peat shelf", "lantern peat sink", "moonmilk bog seam"],
  "mushroom-grotto": ["shadecap grotto", "moonmilk mushroom cave", "pale fungus garden", "blue-spore hollow"],
  cavern: ["wide cavern", "pillar cave", "echoing hollow", "basalt gallery"],
  crevice: ["knife crevice", "wind-cut crack", "shear drop", "black split"],
  "underground-river": ["blind river", "cold underflow", "silt-black stream", "submerged ford"],
  "ancient-vault": ["sealed vault", "buried waystation", "saint-locked chamber", "old empire storehouse"],
  "floating-island": ["floating meadow", "wind-root island", "sky shelf", "drifting crown"],
  "sky-ruin": ["broken sky shrine", "cloud road remnant", "fallen observatory", "sunken sky tower"]
};

const layerDanger: Record<MediumLayer, number> = {
  surface: 4,
  underground: 14,
  deep: 28,
  sky: 24
};

const featureDanger: Record<WorldFeatureKind, number> = {
  "ore-vein": 8,
  "crystal-seam": 16,
  "salt-pocket": 7,
  "peat-bed": 10,
  "mushroom-grotto": 14,
  cavern: 18,
  crevice: 24,
  "underground-river": 20,
  "ancient-vault": 31,
  "floating-island": 26,
  "sky-ruin": 34
};

function mergeUnique(...groups: (readonly string[] | undefined)[]): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))];
}

function rounded(value: number, precision = 100): number {
  return Math.round(value * precision) / precision;
}

function routeCostForSettlement(settlement: Settlement): number {
  const biome = biomeProfiles[settlement.biomeId] ?? biomeProfiles.sunmeadow;
  return (
    terrainTravelCost[settlement.terrain] +
    biome.travelCostBonus +
    topographyTravelCost[settlement.topography] +
    elevationBandTravelCost[settlement.elevationBand]
  );
}

function passDifficultyFor(topography: TopographyKind, elevationBand: ElevationBand, elevationMeters: number): number {
  const altitudePressure = Math.max(0, elevationMeters - 900) / 90;
  return clamp(Math.round(topographyPassDifficulty[topography] + elevationBandHazard[elevationBand] * 0.35 + altitudePressure), 0, 100);
}

function settlementHazard(settlement: Settlement, biome: BiomeProfile): number {
  return terrainHazard[settlement.terrain] + biome.hazardBonus + topographyHazard[settlement.topography] + elevationBandHazard[settlement.elevationBand];
}

function settlementTravelCost(settlement: Settlement, biome: BiomeProfile): number {
  return terrainTravelCost[settlement.terrain] + biome.travelCostBonus + topographyTravelCost[settlement.topography] + elevationBandTravelCost[settlement.elevationBand];
}

function addWeight(scores: Map<TopographyKind, number>, value: TopographyKind, weight: number): void {
  scores.set(value, (scores.get(value) ?? 0) + weight);
}

export function emptyPlanet(): PlanetMedium {
  return {
    id: "planet-0",
    name: "Veyr",
    kind: "planet",
    radiusKm: 4820,
    climate: "temperate frontier belt",
    dayLengthHours: 26,
    biomes: biomeProfiles,
    regions: {},
    routes: {},
    features: {},
    holdings: {}
  };
}

export function biomeForRegion(regionName: string, rng: Rng): BiomeKey {
  if (regionName.includes("Fen")) {
    return "sableFen";
  }
  if (regionName.includes("Blackpine")) {
    return "blackpine";
  }
  if (regionName.includes("Uplands")) {
    return "brokenUplands";
  }
  if (regionName.includes("Old Road")) {
    return rng.chance(0.72) ? "oldRoad" : "sunmeadow";
  }
  if (regionName.includes("Low March")) {
    return rng.chance(0.72) ? "lowMarch" : "sunmeadow";
  }
  return rng.pick(biomeKeys);
}

export function terrainForRegion(regionName: string, rng: Rng): TerrainKind {
  return biomeProfiles[biomeForRegion(regionName, rng)].terrain;
}

export function topographyForSettlement(regionName: string, biomeId: BiomeKey, terrain: TerrainKind, rng: Rng): TopographyKind {
  const scores = new Map<TopographyKind, number>();
  for (const option of topographyWeightsByTerrain[terrain]) {
    addWeight(scores, option.value, option.weight);
  }
  for (const option of biomeTopographyBias[biomeId]) {
    addWeight(scores, option.value, option.weight);
  }
  if (regionName.includes("Uplands")) {
    addWeight(scores, "mountain", 4);
    addWeight(scores, "ridge", 3);
  }
  if (regionName.includes("Fen")) {
    addWeight(scores, "wetland", 5);
    addWeight(scores, "basin", 3);
  }
  if (regionName.includes("Low March")) {
    addWeight(scores, "valley", 4);
    addWeight(scores, "lowland", 3);
  }
  return rng.weighted([...scores.entries()].map(([value, weight]) => ({ value, weight })));
}

export function elevationForTopography(topography: TopographyKind, biomeId: BiomeKey, rng: Rng): number {
  const [min, max] = topographyElevationRange[topography];
  return clamp(Math.round(rng.int(min, max) + biomeElevationShift[biomeId] + rng.int(-45, 45)), 0, 4200);
}

export function elevationBandForMeters(elevationMeters: number): ElevationBand {
  if (elevationMeters >= 2100) {
    return "alpine";
  }
  if (elevationMeters >= 1050) {
    return "high";
  }
  if (elevationMeters >= 360) {
    return "middle";
  }
  return "low";
}

export function ecologyForElevation(biomeId: BiomeKey, elevationBand: ElevationBand): ElevationEcology {
  return ecologyByBiomeAndElevation[biomeId]?.[elevationBand] ?? ecologyByBiomeAndElevation.sunmeadow.low;
}

export function biomeAtSettlement(world: World, settlementId: Id): BiomeProfile {
  const settlement = world.settlements[settlementId];
  return world.planet.biomes[settlement?.biomeId ?? "sunmeadow"] ?? biomeProfiles.sunmeadow;
}

export function routeIdBetween(fromId: Id, toId: Id): Id {
  return [fromId, toId].sort().join("__");
}

export function settlementDistance(world: World, fromId: Id, toId: Id): number {
  const from = world.settlements[fromId];
  const to = world.settlements[toId];
  if (!from || !to) {
    return 0;
  }
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getRoute(world: World, fromId: Id, toId: Id): TravelRoute | undefined {
  if (fromId === toId) {
    return undefined;
  }
  return world.planet.routes[routeIdBetween(fromId, toId)];
}

export function ensureSettlementEnvironment(settlement: Settlement, rng: Rng): void {
  settlement.biomeId ??= biomeForRegion(settlement.region, rng);
  const biome = biomeProfiles[settlement.biomeId] ?? biomeProfiles.sunmeadow;
  settlement.terrain ??= biome.terrain;
  settlement.topography ??= topographyForSettlement(settlement.region, settlement.biomeId, settlement.terrain, rng);
  settlement.elevationMeters = Number.isFinite(settlement.elevationMeters)
    ? settlement.elevationMeters
    : elevationForTopography(settlement.topography, settlement.biomeId, rng);
  settlement.elevationBand = elevationBandForMeters(settlement.elevationMeters);

  const ecology = ecologyForElevation(settlement.biomeId, settlement.elevationBand);
  settlement.flora = mergeUnique(settlement.flora, ecology.flora).slice(0, 4);
  settlement.fauna = mergeUnique(settlement.fauna, ecology.fauna).slice(0, 4);
  settlement.resources = mergeUnique(ecology.resources, settlement.resources, biome.resources).slice(0, 5);
  settlement.localThreats = mergeUnique(ecology.threats, settlement.localThreats, biome.threats).slice(0, 5);
}

function createRegion(settlement: Settlement, biome: BiomeProfile, rng: Rng): MediumRegion {
  const hazard = clamp(Math.round(settlementHazard(settlement, biome) + rng.int(0, 8)), 0, 100);
  const travelCost = rounded(settlementTravelCost(settlement, biome));
  const passDifficulty = passDifficultyFor(settlement.topography, settlement.elevationBand, settlement.elevationMeters);
  return {
    id: settlement.mediumRegionId,
    name: settlement.region,
    biomeId: settlement.biomeId,
    terrain: settlement.terrain,
    topography: settlement.topography,
    elevationMin: settlement.elevationMeters,
    elevationMax: settlement.elevationMeters,
    elevationAvg: settlement.elevationMeters,
    elevationBand: settlement.elevationBand,
    hazard,
    travelCost,
    passDifficulty,
    resources: [...settlement.resources],
    flora: [...settlement.flora],
    fauna: [...settlement.fauna],
    threats: [...settlement.localThreats],
    settlementIds: [settlement.id],
    color: biome.color || terrainColor[settlement.terrain]
  };
}

function addSettlementToRegion(region: MediumRegion, settlement: Settlement, biome: BiomeProfile, rng: Rng): void {
  const previousCount = region.settlementIds.length;
  const count = previousCount + 1;
  const hazard = clamp(Math.round(settlementHazard(settlement, biome) + rng.int(0, 8)), 0, 100);
  const travelCost = settlementTravelCost(settlement, biome);
  const passDifficulty = passDifficultyFor(settlement.topography, settlement.elevationBand, settlement.elevationMeters);

  region.settlementIds.push(settlement.id);
  region.elevationMin = Math.min(region.elevationMin, settlement.elevationMeters);
  region.elevationMax = Math.max(region.elevationMax, settlement.elevationMeters);
  region.elevationAvg = Math.round((region.elevationAvg * previousCount + settlement.elevationMeters) / count);
  region.elevationBand = elevationBandForMeters(region.elevationAvg);
  region.hazard = clamp(Math.round((region.hazard * previousCount + hazard) / count), 0, 100);
  region.travelCost = rounded((region.travelCost * previousCount + travelCost) / count);
  region.resources = mergeUnique(region.resources, settlement.resources).slice(0, 8);
  region.flora = mergeUnique(region.flora, settlement.flora).slice(0, 8);
  region.fauna = mergeUnique(region.fauna, settlement.fauna).slice(0, 8);
  region.threats = mergeUnique(region.threats, settlement.localThreats).slice(0, 8);
  if (passDifficulty > region.passDifficulty) {
    region.passDifficulty = passDifficulty;
    region.topography = settlement.topography;
    region.terrain = settlement.terrain;
  }
}

function featureCandidatesFor(settlement: Settlement): { value: WorldFeatureKind; weight: number }[] {
  const weights: { value: WorldFeatureKind; weight: number }[] = [
    { value: "cavern", weight: 3 },
    { value: "crevice", weight: settlement.topography === "ridge" || settlement.topography === "cliff" || settlement.topography === "mountain" ? 4 : 1 },
    { value: "ancient-vault", weight: settlement.terrain === "ruins" ? 5 : 1 },
    { value: "underground-river", weight: settlement.terrain === "riverlands" || settlement.topography === "valley" ? 4 : 1 },
    { value: "mushroom-grotto", weight: settlement.terrain === "forest" || settlement.terrain === "marsh" ? 4 : 1 }
  ];

  if (settlement.biomeId === "brokenUplands" || settlement.topography === "mountain" || settlement.topography === "ridge") {
    weights.push({ value: "ore-vein", weight: 5 }, { value: "crystal-seam", weight: 5 });
  }
  if (settlement.biomeId === "sableFen" || settlement.topography === "wetland" || settlement.topography === "basin") {
    weights.push({ value: "peat-bed", weight: 6 }, { value: "ore-vein", weight: 2 });
  }
  if (settlement.biomeId === "lowMarch" || settlement.terrain === "riverlands") {
    weights.push({ value: "salt-pocket", weight: 3 }, { value: "underground-river", weight: 4 });
  }
  if (settlement.biomeId === "oldRoad" || settlement.terrain === "ruins") {
    weights.push({ value: "ancient-vault", weight: 5 }, { value: "crystal-seam", weight: 2 });
  }
  if (settlement.elevationBand === "high" || settlement.elevationBand === "alpine") {
    weights.push({ value: "floating-island", weight: 3 }, { value: "sky-ruin", weight: 2 }, { value: "crystal-seam", weight: 2 });
  }

  return weights;
}

function layerForFeature(kind: WorldFeatureKind, rng: Rng): MediumLayer {
  if (kind === "floating-island" || kind === "sky-ruin") {
    return "sky";
  }
  if (kind === "ancient-vault" || kind === "crystal-seam") {
    return rng.chance(0.48) ? "deep" : "underground";
  }
  if (kind === "crevice") {
    return rng.chance(0.35) ? "deep" : "underground";
  }
  if (kind === "peat-bed") {
    return "surface";
  }
  return "underground";
}

function featureDepth(layer: MediumLayer, rng: Rng): number {
  if (layer === "surface" || layer === "sky") {
    return 0;
  }
  if (layer === "deep") {
    return rng.int(420, 1450);
  }
  return rng.int(35, 420);
}

function featureAltitude(settlement: Settlement, layer: MediumLayer, rng: Rng): number {
  if (layer !== "sky") {
    return settlement.elevationMeters;
  }
  return settlement.elevationMeters + rng.int(520, settlement.elevationBand === "alpine" ? 2600 : 1600);
}

function createWorldFeature(settlement: Settlement, index: number, rng: Rng): WorldFeature {
  const kind = rng.weighted(featureCandidatesFor(settlement));
  const layer = layerForFeature(kind, rng);
  const depthMeters = featureDepth(layer, rng);
  const altitudeMeters = featureAltitude(settlement, layer, rng);
  const ecology = ecologyForElevation(settlement.biomeId, settlement.elevationBand);
  const richness = clamp(
    rng.int(24, 76) +
      (mineableFeatureKinds.has(kind) ? 12 : 0) +
      (settlement.elevationBand === "high" || settlement.elevationBand === "alpine" ? 8 : 0) +
      (layer === "deep" ? 10 : 0),
    8,
    100
  );
  const stability = clamp(
    rng.int(38, 88) -
      (settlement.topography === "cliff" || settlement.topography === "mountain" ? 14 : 0) -
      (layer === "deep" ? 10 : 0) -
      (kind === "crevice" ? 12 : 0),
    5,
    100
  );
  const danger = clamp(
    Math.round(
      settlement.threat * 0.35 +
        terrainHazard[settlement.terrain] +
        topographyHazard[settlement.topography] +
        elevationBandHazard[settlement.elevationBand] +
        layerDanger[layer] +
        featureDanger[kind] +
        rng.int(-6, 10)
    ),
    0,
    100
  );
  const knownChance = kind === "peat-bed" ? 0.72 : kind === "floating-island" || kind === "sky-ruin" ? 0.22 : 0.45;
  const resourcePool = mergeUnique(
    mineableFeatureKinds.has(kind) ? settlement.resources : [],
    kind === "mushroom-grotto" ? ecology.flora : [],
    kind === "underground-river" ? ecology.fauna : [],
    ecology.resources,
    settlement.resources
  );
  return {
    id: makeId("feature", `${settlement.id}-${index}`.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + rng.int(0, 9999)),
    name: `${rng.pick(featureNameRoots[kind])} of ${settlement.name}`,
    kind,
    layer,
    status: rng.chance(knownChance) ? "known" : "hidden",
    regionId: settlement.mediumRegionId,
    nearestSettlementId: settlement.id,
    biomeId: settlement.biomeId,
    topography: settlement.topography,
    elevationBand: settlement.elevationBand,
    depthMeters,
    altitudeMeters,
    richness,
    danger,
    stability,
    exploration: rng.chance(knownChance) ? rng.int(8, 38) : 0,
    depletion: 0,
    resources: resourcePool.slice(0, 4),
    flora: mergeUnique(ecology.flora, settlement.flora).slice(0, 4),
    fauna: mergeUnique(ecology.fauna, settlement.fauna).slice(0, 4),
    threats: mergeUnique(ecology.threats, settlement.localThreats).slice(0, 4),
    tags: [featureKindLabels[kind], layerLabels[layer], settlement.topography, settlement.elevationBand]
  };
}

function generateWorldFeatures(planet: PlanetMedium, world: World, rng: Rng): void {
  for (const settlement of Object.values(world.settlements)) {
    const featureCount =
      2 +
      rng.int(0, 1) +
      (settlement.elevationBand === "high" || settlement.elevationBand === "alpine" ? 1 : 0) +
      (settlement.terrain === "ruins" ? 1 : 0);
    for (let index = 0; index < featureCount; index += 1) {
      const feature = createWorldFeature(settlement, index, rng);
      planet.features[feature.id] = feature;
    }
  }
}

export function createPlanetMedium(world: World, rng: Rng): PlanetMedium {
  const planet = emptyPlanet();
  for (const settlement of Object.values(world.settlements)) {
    if (!settlement.mediumRegionId) {
      settlement.mediumRegionId = makeId("region", regions.indexOf(settlement.region));
    }
    ensureSettlementEnvironment(settlement, rng);
    const biome = planet.biomes[settlement.biomeId];
    const existingRegion = planet.regions[settlement.mediumRegionId];
    if (existingRegion) {
      addSettlementToRegion(existingRegion, settlement, biome, rng);
    } else {
      planet.regions[settlement.mediumRegionId] = createRegion(settlement, biome, rng);
    }
  }

  const settlements = Object.values(world.settlements);
  for (let left = 0; left < settlements.length; left += 1) {
    for (let right = left + 1; right < settlements.length; right += 1) {
      const from = settlements[left];
      const to = settlements[right];
      const distance = settlementDistance(world, from.id, to.id);
      const harderEndpoint = routeCostForSettlement(from) > routeCostForSettlement(to) ? from : to;
      const terrain = harderEndpoint.terrain;
      const topography = harderEndpoint.topography;
      const elevationBand = harderEndpoint.elevationBand;
      const biome = biomeProfiles[harderEndpoint.biomeId];
      const elevationGain = Math.abs(from.elevationMeters - to.elevationMeters);
      const horizontalKm = Math.max(1, distance * 128);
      const slopeGrade = rounded((elevationGain / (horizontalKm * 1000)) * 100, 10);
      const passDifficulty = clamp(
        Math.round(topographyPassDifficulty[topography] + elevationGain / 70 + slopeGrade * 3 + elevationBandHazard[elevationBand] * 0.4),
        0,
        100
      );
      const travelMultiplier =
        terrainTravelCost[terrain] +
        biome.travelCostBonus +
        topographyTravelCost[topography] +
        elevationBandTravelCost[elevationBand] +
        passDifficulty * 0.002;
      const route: TravelRoute = {
        id: routeIdBetween(from.id, to.id),
        fromId: from.id,
        toId: to.id,
        distance: Math.max(12, Math.round(distance * 128 * travelMultiplier)),
        danger: clamp(
          Math.round(
            (from.threat + to.threat) / 2 +
              terrainHazard[terrain] +
              biome.hazardBonus +
              topographyHazard[topography] +
              elevationBandHazard[elevationBand] +
              passDifficulty * 0.22 +
              rng.int(-5, 8)
          ),
          0,
          100
        ),
        biomeId: biome.id,
        terrain,
        topography,
        elevationBand,
        elevationGain,
        slopeGrade,
        passDifficulty
      };
      planet.routes[route.id] = route;
    }
  }

  generateWorldFeatures(planet, world, rng);
  return planet;
}

import {
  biomeProfiles,
  factionRoots,
  purposes,
  questKindLabels,
  regions,
  settlementNames
} from "./sim/data/content";
import { event } from "./sim/chronicle/events";
import { ensureAbilityIds, learnEligibleAbility, partyAbilityBonus } from "./sim/abilities/compendium";
import { simulateCombat } from "./sim/combat/combat";
import { clamp, average, makeId, signed } from "./sim/core/math";
import { hashSeed, Rng } from "./sim/core/rng";
import { makeBiomeLoot, makeRecipeItem, autoEquip, ensureItem, rememberItem } from "./sim/economy/items";
import { advanceOrganizationEconomy } from "./sim/economy/organizations";
import { tickPowerResources } from "./sim/economy/power";
import {
  attemptObservedRecipeLearning,
  ensureRecipeKnowledge,
  observeRecipeFromItem,
  observeRecipesFromFeature,
  recipeList,
  recipeMeetsRequirements,
  teachCultureRecipe
} from "./sim/economy/recipes";
import {
  biomeAtSettlement,
  biomeForRegion,
  createPlanetMedium,
  ecologyForElevation,
  elevationBandForMeters,
  elevationBandTravelCost,
  elevationForTopography,
  emptyPlanet,
  ensureSettlementEnvironment,
  featureKindLabels,
  getRoute,
  layerLabels,
  mineableFeatureKinds,
  terrainForRegion,
  terrainTravelCost,
  topographyForSettlement,
  topographyTravelCost
} from "./sim/environment/planet";
import {
  biomeForClimate,
  elevationBandForClimate,
  humidityForClimate,
  neighborBiomeIdsForSector,
  settlementBiomeForClimate,
  temperatureForClimate,
  tileBiomeForClimate
} from "./sim/environment/climate";
import {
  addMemory,
  adjustTrait,
  createPerson,
  ensureBandLeader,
  livingMembers,
  strongestSkill,
  validAncestry
} from "./sim/individuals/people";
import {
  ensureIdentityAxes,
  identityActionBias,
  identityQuestBias,
  mutateIdentityForQuest,
  shiftIdentity
} from "./sim/individuals/identity";
import { tickInfluenceState } from "./sim/individuals/influence";
import { tickAugmentations } from "./sim/individuals/augmentations";
import { applyConversationProjection, deriveConversationProjection } from "./sim/individuals/conversations";
import { tickSocialEmotionalStates, updatePersonRelationStance } from "./sim/individuals/moods";
import { ensureSocialMind } from "./sim/individuals/social";
import { ensureStats, shiftCoreStats, statActionBias, statQuestBias } from "./sim/individuals/stats";
import { updateBandEmotionalClimate, updateOrganizationEmotionalClimate } from "./sim/society/emotionalClimate";
import { applySettlementCulture, cultureForPerson, cultureLearningBonus, cultureQuestBias, ensureCultures, updateCultures } from "./sim/society/culture";
import { advanceAges, createWardFromConquest, educateChildren, ensureLineage, maybeCreateChild, updateOrphansAndWards } from "./sim/society/family";
import { ensureOrganizationEconomy } from "./sim/society/organizations";
import { ensureStoryState, expireStoryQuest, resolveStoryQuest, setbackStoryQuest, storyQuestBias, updateStoryEngine } from "./sim/world/story";
import { ensureWorldPhase, maybeScheduleDeterministicWorldEvent, tickSpecialWorldEvents } from "./sim/world/encounters";
import { applyConditionEncounterPressure, proposeConditionPressureQuestNeeds } from "./sim/world/conditionPressure";
import { addLocationPulse, addRouteTrail, updateLingeringEffects } from "./sim/world/effects";
import { applyRemainsEncounterPressure, proposeRemainsPressureQuestNeeds, syncRemainsForDeadPersons } from "./sim/world/remains";
import { isQuietActivityAction, quietActivityDecisionScore, updateQuietBandActivity } from "./sim/world/quietActivity";
import { ensureSettlementDevelopment, updateSettlementDevelopment } from "./sim/world/buildings";
import { proposeOrganizationPressureQuestNeeds } from "./sim/world/organizationPressure";
import { addQuestNeedProposals, updateQuestNeedLane } from "./sim/world/questNeeds";
import { proposeTradeServiceQuestNeeds } from "./sim/world/trade";
import { createTerritories, createWeatherSystem, ensureTerritoriesAndWeather, updateTerritories, updateWeather } from "./sim/world/territory";
import type {
  Band,
  CraftingRecipeDefinition,
  DecisionScore,
  Doctrine,
  Faction,
  Id,
  Item,
  ItemDesire,
  OceanBody,
  Person,
  Quest,
  QuestKind,
  TerrainHoldingKind,
  OverworldTile,
  WorldFeature,
  WorldGenConfig,
  WorldGeography,
  WorldSector,
  World
} from "./sim/types";

const ticksPerDay = 6;
const questKinds: QuestKind[] = ["defense", "delve", "hunt", "escort", "politics"];
const worldSizeSettlements: Record<WorldGenConfig["size"], number> = {
  small: 6,
  medium: 8,
  large: 11
};
const worldSizeSectorGrid: Record<WorldGenConfig["size"], { columns: number; rows: number; tileRadius: number }> = {
  small: { columns: 7, rows: 5, tileRadius: 1 },
  medium: { columns: 10, rows: 7, tileRadius: 2 },
  large: { columns: 13, rows: 9, tileRadius: 2 }
};
const continentNames = ["Aster", "Boreal", "Cindervale", "Dawnmarch"];
const oceanNames = ["Greywake", "Sable Mere", "Aetherwash", "Glassdeep"];

export function defaultWorldGenConfig(): WorldGenConfig {
  return {
    size: "small",
    continents: 1,
    landmass: 58,
    ocean: 42,
    climate: 50
  };
}

function normalizeWorldGenConfig(options: Partial<WorldGenConfig> = {}): WorldGenConfig {
  const defaults = defaultWorldGenConfig();
  const size = options.size === "medium" || options.size === "large" ? options.size : defaults.size;
  return {
    size,
    continents: Math.round(clamp(options.continents ?? defaults.continents, 1, 4)),
    landmass: Math.round(clamp(options.landmass ?? defaults.landmass, 20, 90)),
    ocean: Math.round(clamp(options.ocean ?? defaults.ocean, 10, 80)),
    climate: Math.round(clamp(options.climate ?? defaults.climate, 0, 100))
  };
}

function tileOffsets(radius: number): { q: number; r: number }[] {
  const offsets: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r += 1) {
      offsets.push({ q, r });
    }
  }
  return offsets;
}

function createGeography(config: WorldGenConfig, rng: Rng): WorldGeography {
  const continents = Array.from({ length: config.continents }, (_, index) => {
    const angle = (index / Math.max(1, config.continents)) * Math.PI * 2 + rng.next() * 0.42;
    const distance = config.continents === 1 ? 0 : 0.21 + rng.next() * 0.1;
    return {
      id: makeId("continent", index),
      name: `${continentNames[index] ?? "Far"} Continent`,
      x: clamp(0.5 + Math.cos(angle) * distance, 0.18, 0.82),
      y: clamp(0.5 + Math.sin(angle) * distance * 0.82, 0.2, 0.8),
      radius: clamp(config.landmass / 170 + rng.next() * 0.08, 0.22, 0.58),
      humidity: clamp(config.climate + rng.int(-18, 18), 0, 100),
      temperature: clamp(60 - Math.abs(index - 1.5) * 8 + rng.int(-14, 14), 0, 100),
      settlementIds: [],
      dominantBiomeIds: []
    };
  });
  const oceanCount = Math.max(1, Math.min(4, Math.round(config.ocean / 24)));
  const oceans: OceanBody[] = Array.from({ length: oceanCount }, (_, index) => ({
    id: makeId("ocean", index),
    name: `${oceanNames[index] ?? "Outer"} Ocean`,
    x: clamp(0.18 + index * (0.64 / Math.max(1, oceanCount - 1)) + rng.next() * 0.08 - 0.04, 0.08, 0.92),
    y: clamp(0.18 + rng.next() * 0.68, 0.08, 0.92),
    width: clamp(0.18 + config.ocean / 220 + rng.next() * 0.12, 0.18, 0.52),
    height: clamp(0.16 + config.ocean / 260 + rng.next() * 0.1, 0.14, 0.44),
    danger: Math.round(clamp(config.ocean * 0.7 + (100 - config.landmass) * 0.2 + rng.int(-12, 18), 8, 92)),
    knownCrossingCultureIds: []
  }));
  const sectors: WorldGeography["sectors"] = {};
  const tiles: WorldGeography["tiles"] = {};
  const grid = worldSizeSectorGrid[config.size];
  const offsets = tileOffsets(grid.tileRadius);
  let tileIndex = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const id = makeId("sector", row * grid.columns + column);
      const x = (column + 0.5 + (row % 2) * 0.5) / (grid.columns + 0.5);
      const y = (row + 0.5) / grid.rows;
      const nearestContinent = [...continents].sort((a, b) => Math.hypot(a.x - x, a.y - y) / a.radius - Math.hypot(b.x - x, b.y - y) / b.radius)[0];
      const nearestOcean = [...oceans].sort((a, b) => Math.hypot((a.x - x) / a.width, (a.y - y) / a.height) - Math.hypot((b.x - x) / b.width, (b.y - y) / b.height))[0];
      const continentDistance = nearestContinent ? Math.hypot(nearestContinent.x - x, nearestContinent.y - y) / nearestContinent.radius : 99;
      const oceanDistance = nearestOcean ? Math.hypot((nearestOcean.x - x) / nearestOcean.width, (nearestOcean.y - y) / nearestOcean.height) : 99;
      const landRoll = config.landmass / 100 + rng.next() * 0.14 - 0.07;
      const isLand = continentDistance < landRoll || (continentDistance < landRoll + 0.2 && rng.chance(0.34));
      const kind: WorldSector["kind"] = isLand ? (oceanDistance < 0.95 || continentDistance > landRoll - 0.08 ? "coast" : "continent") : oceanDistance < 0.92 ? "ocean" : "island";
      const neighborBiomeIds = neighborBiomeIdsForSector(sectors, column, row);
      const baseClimate = {
        config,
        x,
        y,
        kind,
        continentDistance,
        oceanDistance,
        regionName: nearestContinent?.name ?? "frontier",
        continentHumidity: nearestContinent?.humidity,
        continentTemperature: nearestContinent?.temperature,
        neighborBiomeIds
      };
      const draftElevationBand = elevationBandForClimate(baseClimate, rng);
      const biomeId = biomeForClimate({ ...baseClimate, elevationBand: draftElevationBand }, rng);
      const biome = biomeProfiles[biomeId];
      const elevationBand = elevationBandForClimate({ ...baseClimate, elevationBand: draftElevationBand, anchorBiomeId: biomeId }, rng, biomeId);
      const terrain = kind === "ocean" ? ("riverlands" as const) : biome.terrain;
      const climateWithElevation = { ...baseClimate, elevationBand };
      const sector: WorldSector = {
        id,
        q: column,
        r: row,
        x,
        y,
        kind,
        continentId: isLand ? nearestContinent?.id : undefined,
        oceanId: kind === "ocean" || kind === "coast" ? nearestOcean?.id : undefined,
        biomeId,
        terrain,
        elevationBand,
        humidity: Math.round(clamp(humidityForClimate(climateWithElevation) + rng.int(-4, 4), 0, 100)),
        temperature: Math.round(clamp(temperatureForClimate(climateWithElevation) + rng.int(-4, 4), 0, 100)),
        settlementIds: [] as Id[],
        tileIds: [] as Id[],
        tags: [kind, terrain, elevationBand, biomeId]
      };
      sectors[id] = sector;
      offsets.forEach((offset) => {
        const tileId = makeId("tile", tileIndex);
        tileIndex += 1;
        const tileClimate = {
          ...climateWithElevation,
          x: clamp(x + offset.q * 0.018 + offset.r * 0.009, 0, 1),
          y: clamp(y + offset.r * 0.022, 0, 1),
          anchorBiomeId: biomeId
        };
        const tileBiomeId = tileBiomeForClimate(tileClimate, biomeId, rng);
        const tileBiome = biomeProfiles[tileBiomeId];
        const layer = rng.weighted([
          { value: "surface" as const, weight: kind === "ocean" ? 9 : 12 },
          { value: "underground" as const, weight: kind === "ocean" ? 0.2 : 2 },
          { value: "deep" as const, weight: kind === "ocean" ? 0.1 : 0.8 },
          { value: "sky" as const, weight: elevationBand === "high" || elevationBand === "alpine" ? 1.2 : 0.25 }
        ]);
        const danger = Math.round(clamp((kind === "ocean" ? nearestOcean?.danger ?? 40 : 18) + tileBiome.hazardBonus + rng.int(-8, 18), 0, 100));
        const tile: OverworldTile = {
          id: tileId,
          sectorId: id,
          q: offset.q,
          r: offset.r,
          biomeId: tileBiomeId,
          terrain: tileBiome.terrain,
          elevationBand: rng.chance(0.18) && kind !== "ocean" ? elevationBandForClimate(tileClimate, rng, tileBiomeId) : elevationBand,
          layer,
          passability: Math.round(clamp(100 - danger * 0.38 - (kind === "ocean" ? 36 : 0) - (layer === "deep" ? 18 : 0), 4, 100)),
          danger,
          resourceHints: tileBiome.resources.slice(0, 2),
          featureIds: [] as Id[],
          tags: [kind, tileBiome.terrain, tileBiomeId, layer]
        };
        tiles[tileId] = tile;
        sector.tileIds.push(tileId);
      });
    }
  }
  return { continents, oceans, sectors, tiles };
}

function settlementNameForIndex(index: number, rng: Rng): string {
  return settlementNames[index] ?? `${rng.pick(["North", "South", "Far", "New", "Old"])} ${rng.pick(settlementNames)}`;
}

function nearestSectorForPoint(geography: WorldGeography, x: number, y: number, continentId?: Id): string {
  const sectors = Object.values(geography.sectors);
  const preferred = sectors.filter((sector) => sector.kind !== "ocean" && (!continentId || sector.continentId === continentId));
  const pool = preferred.length ? preferred : sectors.filter((sector) => sector.kind !== "ocean");
  return [...(pool.length ? pool : sectors)].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]?.id ?? "";
}

function ensureGeography(world: World, rng: Rng): void {
  world.generation = normalizeWorldGenConfig(world.generation);
  if (!world.geography?.sectors || !world.geography.tiles || !world.geography.continents?.length || !world.geography.oceans?.length) {
    world.geography = createGeography(world.generation, rng);
  }
  for (const continent of world.geography.continents) {
    continent.settlementIds = [];
    continent.dominantBiomeIds = [];
  }
  for (const sector of Object.values(world.geography.sectors)) {
    sector.settlementIds = [];
  }
  for (const settlement of Object.values(world.settlements)) {
    const nearestContinent = [...world.geography.continents].sort((a, b) => Math.hypot(a.x - settlement.x, a.y - settlement.y) - Math.hypot(b.x - settlement.x, b.y - settlement.y))[0];
    settlement.sectorId = nearestSectorForPoint(world.geography, settlement.x, settlement.y, nearestContinent?.id);
    if (nearestContinent) {
      nearestContinent.settlementIds.push(settlement.id);
      nearestContinent.dominantBiomeIds = [...new Set([...nearestContinent.dominantBiomeIds, settlement.biomeId])].slice(0, 4);
    }
    const sector = world.geography.sectors[settlement.sectorId];
    if (sector) {
      sector.settlementIds.push(settlement.id);
    }
  }
}

function relationName(value: number): string {
  if (value >= 55) {
    return "devoted";
  }
  if (value >= 25) {
    return "friendly";
  }
  if (value <= -55) {
    return "hated";
  }
  if (value <= -25) {
    return "hostile";
  }
  return "wary";
}

function factionRelation(faction: Faction, otherId: Id): number {
  return faction.relations[otherId] ?? 0;
}

function defaultDoctrine(): Doctrine {
  return {
    targetPolicy: "casters",
    healBelow: 42,
    aoeAt: 3,
    spendConsumables: "balanced",
    retreatBelow: 24,
    riskStance: "balanced",
    preferredQuest: "any"
  };
}

function createQuest(world: World, rng: Rng, kind?: QuestKind, factionId?: Id, locationId?: Id): Quest {
  const actualKind = kind ?? rng.pick(questKinds);
  const settlement = locationId ? world.settlements[locationId] : rng.pick(Object.values(world.settlements));
  const biome = biomeAtSettlement(world, settlement.id);
  const localThreat = rng.pick(settlement.localThreats.length ? settlement.localThreats : biome.threats);
  const localResource = rng.pick(settlement.resources.length ? settlement.resources : biome.resources);
  const hook = rng.pick(biome.questHooks);
  const issuerFaction = factionId ?? settlement.factionId;
  const dangerBase = actualKind === "politics" ? 32 : actualKind === "delve" ? 58 : 44;
  const region = world.planet.regions[settlement.mediumRegionId];
  const ecology = ecologyForElevation(settlement.biomeId, settlement.elevationBand);
  const localFlora = rng.pick(settlement.flora.length ? settlement.flora : ecology.flora);
  const localFauna = rng.pick(settlement.fauna.length ? settlement.fauna : ecology.fauna);
  const danger = clamp(
    dangerBase +
      rng.int(-16, 26) +
      Math.floor(settlement.threat * 0.35) +
      Math.floor((region?.hazard ?? 0) * 0.12) +
      Math.floor((region?.passDifficulty ?? 0) * 0.08),
    12,
    95
  );
  const title = makeQuestTitle(actualKind, settlement.name, localThreat, localResource, hook, rng);
  const targetOptions = Object.keys(world.factions).filter((id) => id !== issuerFaction);
  return {
    id: makeId("quest", world.tick * 100 + rng.int(10, 99)),
    title,
    kind: actualKind,
    issuerFactionId: issuerFaction,
    locationId: settlement.id,
    targetFactionId: targetOptions.length > 0 && rng.chance(0.55) ? rng.pick(targetOptions) : undefined,
    danger,
    rewardGold: Math.ceil(danger * rng.int(3, 7) * 0.35),
    rewardRenown: Math.ceil(danger / 8) + rng.int(1, 5),
    urgency: rng.int(28, 90),
    progress: 0,
    status: "open",
    summary: `${questKindLabels[actualKind]} contract in ${settlement.name}. ${biome.name} ${settlement.topography} ground at ${Math.round(
      settlement.elevationMeters
    )}m supports ${localFlora} and ${localFauna}; it offers ${localResource} and threatens ${localThreat}. Danger ${danger}.`
  };
}

function makeQuestTitle(
  kind: QuestKind,
  settlementName: string,
  threat: string,
  resource: string,
  hook: string,
  rng: Rng
): string {
  if (kind === "hunt") {
    return rng.pick([`Track the ${threat} near ${settlementName}`, `Break the ${threat} lair by the ${hook}`]);
  }
  if (kind === "defense") {
    return rng.pick([`Defend the ${resource} stores at ${settlementName}`, `Hold ${settlementName} against ${threat}`]);
  }
  if (kind === "delve") {
    return rng.pick([`Recover ${resource} from the ${hook}`, `Open the ${hook} beneath ${settlementName}`]);
  }
  if (kind === "escort") {
    return rng.pick([`Carry ${resource} through ${threat} country`, `Escort witnesses past the ${hook}`]);
  }
  return rng.pick([`Settle the ${resource} dispute in ${settlementName}`, `Expose the cabal using ${threat}`]);
}

export function createWorld(seedName = `frontier-${Date.now()}`, options: Partial<WorldGenConfig> = {}): World {
  const rng = new Rng(hashSeed(seedName));
  const generation = normalizeWorldGenConfig(options);
  const geography = createGeography(generation, rng);
  const world: World = {
    version: 1,
    seedName,
    rngState: rng.state,
    tick: 0,
    day: 1,
    persons: {},
    bands: {},
    factions: {},
    cultures: {},
    organizations: {},
    assets: {},
    agreements: {},
    remains: {},
    story: {
      artifacts: {},
      bosses: {},
      crises: {}
    },
    settlements: {},
    territories: {},
    weather: {
      season: "spring",
      fronts: {},
      nextSeasonTick: ticksPerDay * 30
    },
    worldPhase: {
      current: "normal",
      changedTick: 0,
      hardMode: false,
      tags: ["normal"]
    },
    specialEvents: {},
    encounterPressure: {},
    generation,
    geography,
    lingeringEffects: {},
    planet: emptyPlanet(),
    quests: {},
    events: [],
    doctrine: defaultDoctrine(),
    deity: {
      favoredBandId: "",
      watchedPersonIds: [],
      omen: "none",
      blessingByPersonId: {}
    },
    selectedPersonId: "",
    selectedBandId: "",
    lastDecisionScores: []
  };

  const factionCount = Math.min(6, Math.max(4, generation.continents + 3));
  const settlementCount = worldSizeSettlements[generation.size];

  for (let index = 0; index < settlementCount; index += 1) {
    const id = makeId("settlement", index);
    const regionName = rng.pick(regions);
    const continent = geography.continents[index % geography.continents.length];
    const angle = rng.next() * Math.PI * 2;
    const distance = Math.sqrt(rng.next()) * continent.radius * 0.74;
    const x = clamp(continent.x + Math.cos(angle) * distance, 0.08, 0.92);
    const y = clamp(continent.y + Math.sin(angle) * distance * 0.78, 0.1, 0.9);
    const sectorId = nearestSectorForPoint(geography, x, y, continent.id);
    const biomeId = settlementBiomeForClimate(regionName, geography.sectors[sectorId], generation, rng);
    const biome = biomeProfiles[biomeId];
    const topography = topographyForSettlement(regionName, biomeId, biome.terrain, rng);
    const elevationMeters = elevationForTopography(topography, biomeId, rng);
    const elevationBand = elevationBandForMeters(elevationMeters);
    const ecology = ecologyForElevation(biomeId, elevationBand);
    world.settlements[id] = {
      id,
      name: settlementNameForIndex(index, rng),
      region: regionName,
      mediumRegionId: makeId("region", regions.indexOf(regionName)),
      sectorId,
      biomeId,
      terrain: biome.terrain,
      topography,
      elevationMeters,
      elevationBand,
      factionId: "",
      x,
      y,
      population: rng.int(120, 920),
      prosperity: rng.int(32, 78),
      defense: rng.int(22, 72),
      unrest: rng.int(6, 38),
      threat: rng.int(8, 46),
      resources: [...new Set([...rng.pick([ecology.resources, [...ecology.resources].reverse()]), ...biome.resources])].slice(0, 4),
      flora: ecology.flora.slice(0, 4),
      fauna: ecology.fauna.slice(0, 4),
      localThreats: [...new Set([...rng.pick([ecology.threats, [...ecology.threats].reverse()]), ...biome.threats])].slice(0, 4),
      tags: [rng.pick(["ford", "shrine", "mine", "market", "watch", "orchards", "old stones"]), rng.pick(biome.questHooks)]
    };
    continent.settlementIds.push(id);
    continent.dominantBiomeIds = [...new Set([...continent.dominantBiomeIds, biomeId])].slice(0, 3);
    if (geography.sectors[sectorId]) {
      geography.sectors[sectorId].settlementIds.push(id);
    }
  }

  const settlements = Object.values(world.settlements);
  world.planet = createPlanetMedium(world, rng);
  for (let index = 0; index < factionCount; index += 1) {
    const root = factionRoots[index];
    const id = makeId("faction", index);
    const capital = settlements[index % settlements.length];
    world.factions[id] = {
      id,
      name: root.name,
      kind: root.kind,
      cultureId: "",
      color: root.color,
      capitalId: capital.id,
      wealth: rng.int(32, 88),
      stability: rng.int(34, 82),
      military: rng.int(26, 82),
      magic: rng.int(12, 72),
      relations: {},
      activeWars: []
    };
    capital.factionId = id;
  }

  settlements.forEach((settlement, index) => {
    if (!settlement.factionId) {
      settlement.factionId = makeId("faction", index % factionCount);
    }
  });

  const factionIds = Object.keys(world.factions);
  for (const faction of Object.values(world.factions)) {
    for (const otherId of factionIds) {
      if (otherId !== faction.id) {
        faction.relations[otherId] = rng.int(-28, 28);
      }
    }
  }
  world.territories = createTerritories(world);
  world.weather = createWeatherSystem(world, rng);
  ensureCultures(world, rng);
  ensureStoryState(world, rng);

  let personIndex = 0;
  for (let index = 0; index < 44; index += 1) {
    const faction = rng.pick(factionIds);
    const home = rng.pick(settlements.filter((settlement) => settlement.factionId === faction) ?? settlements);
    const role = rng.weighted<Person["role"]>([
      { value: "commoner", weight: 9 },
      { value: "fighter", weight: 5 },
      { value: "scout", weight: 3 },
      { value: "healer", weight: 2 },
      { value: "mage", weight: 2 }
    ]);
    const person = createPerson(rng, makeId("person", personIndex), faction, home.id, role);
    person.cultureId = world.factions[faction]?.cultureId ?? "";
    person.birthCultureId = person.cultureId;
    person.heritageCultureIds = [person.cultureId];
    ensureRecipeKnowledge(person, rng, world.cultures[person.cultureId]);
    ensureSocialMind(person, rng, world.tick);
    world.persons[person.id] = person;
    personIndex += 1;
  }
  ensureCultures(world, rng);
  ensureLineage(world);
  ensureOrganizationEconomy(world, { seedDefaults: true });
  ensureSettlementDevelopment(world);

  let eligible = Object.values(world.persons).filter((person) => person.role !== "commoner");
  for (let index = 0; index < 4; index += 1) {
    const leaderPool = eligible.filter((person) => !person.bandId);
    if (leaderPool.length === 0) {
      break;
    }
    const leader = rng.pick(leaderPool);
    eligible = eligible.filter((person) => person.id !== leader.id);
    leader.role = "leader";
    leader.title ||= rng.pick(["the Lantern", "the Scarred", "the Bridge", "the Hungry"]);
    leader.skills.command += rng.int(18, 28);
    leader.renown += rng.int(16, 30);
    ensureAbilityIds(leader, rng);
    ensureRecipeKnowledge(leader, rng, world.cultures[leader.cultureId]);
    const factionPeople = Object.values(world.persons).filter(
      (person) => person.id !== leader.id && !person.bandId && person.factionId === leader.factionId
    );
    const members = [leader];
    while (members.length < 3 && factionPeople.length > 0) {
      const next = factionPeople.splice(rng.int(0, factionPeople.length - 1), 1)[0];
      members.push(next);
    }
    const bandId = makeId("band", index);
    const purpose = rng.pick(purposes);
    const band: Band = {
      id: bandId,
      name: `${rng.pick(["Ash", "Oath", "Lantern", "Crow", "Mire", "Red"])} ${rng.pick([
        "Company",
        "Band",
        "Vow",
        "Knives",
        "Pilgrims"
      ])}`,
      leaderId: leader.id,
      memberIds: members.map((member) => member.id),
      locationId: leader.locationId,
      purpose,
      cohesion: rng.int(38, 76),
      supplies: rng.int(28, 70),
      notoriety: rng.int(0, 24),
      goal: "looking for a contract"
    };
    for (const member of members) {
      member.bandId = band.id;
      member.locationId = band.locationId;
      for (const peer of members) {
        if (peer.id !== member.id) {
          member.relations[peer.id] = rng.int(-6, 28);
        }
      }
    }
    eligible = eligible.filter((person) => !members.some((member) => member.id === person.id));
    world.bands[band.id] = band;
  }

  for (let index = 0; index < 9; index += 1) {
    const quest = createQuest(world, rng);
    world.quests[quest.id] = quest;
  }

  const firstBand = Object.values(world.bands)[0];
  world.deity.favoredBandId = firstBand.id;
  world.selectedBandId = firstBand.id;
  world.selectedPersonId = firstBand.leaderId;
  world.deity.watchedPersonIds = [firstBand.leaderId];
  event(
    world,
    "world",
    "medium",
    `The frontier wakes. ${Object.keys(world.factions).length} powers, ${Object.keys(world.bands).length} bands, and ${Object.keys(world.persons).length} named people begin moving under your watch.`
  );
  event(
    world,
    "divine",
    "medium",
    `Your first gaze settles on ${world.persons[firstBand.leaderId].name} ${world.persons[firstBand.leaderId].familyName}, leader of ${firstBand.name}.`,
    [firstBand.leaderId]
  );
  updateStoryEngine(world, rng);
  updateSocialEmotionalState(world);

  world.rngState = rng.state;
  return world;
}

function scoreOpenQuest(world: World, band: Band, quest: Quest, leader: Person, doctrine: Doctrine): DecisionScore {
  const settlement = world.settlements[quest.locationId];
  const issuer = world.factions[quest.issuerFactionId];
  const relation = factionRelation(world.factions[leader.factionId], issuer.id);
  const members = livingMembers(world, band);
  const health = average(members.map((member) => member.hp / member.maxHp));
  const fatigue = average(members.map((member) => member.fatigue));
  const bravery = leader.traits.bravery - leader.traits.caution;
  const identityFit = identityQuestBias(leader, quest.kind);
  const statFit = statQuestBias(leader, quest.kind);
  const cultureFit = cultureQuestBias(cultureForPerson(world, leader), quest.kind);
  const storyFit = storyQuestBias(world, quest, leader);
  const dangerFit = bravery * 0.18 - Math.max(0, quest.danger - 48) * (doctrine.riskStance === "cautious" ? 0.9 : 0.42);
  const policy = doctrine.preferredQuest === quest.kind ? 24 : doctrine.preferredQuest === "any" ? 4 : -8;
  const omen = world.deity.omen === quest.kind ? 28 : 0;
  const threatPressure = quest.kind === "defense" ? settlement.threat * 0.36 + leader.traits.loyalty * 0.12 : 0;
  const woundedPenalty = health < 0.75 ? -(0.75 - health) * 120 : 0;
  const supplyPenalty = Math.max(0, 34 - band.supplies) * 1.2;
  const fatiguePenalty = Math.max(0, fatigue - 55) * 0.85;
  const route = getRoute(world, band.locationId, quest.locationId);
  const perception = leader.stats.derived.perception;
  const routeDangerMultiplier = clamp(1 - (perception - 50) / 240, 0.68, 1.24);
  const routePenalty = route ? route.distance * 0.1 + route.danger * 0.18 * routeDangerMultiplier : 0;
  const score =
    30 +
    quest.rewardGold * 0.08 +
    quest.rewardRenown * 1.7 +
    relation * 0.14 +
    identityFit +
    statFit +
    cultureFit +
    storyFit +
    dangerFit +
    policy +
    omen +
    threatPressure +
    woundedPenalty -
    supplyPenalty -
    fatiguePenalty -
    routePenalty +
    leader.traits.ambition * 0.16 +
    leader.traits.curiosity * (quest.kind === "delve" ? 0.2 : 0.04) -
    quest.progress * 0.2;

  return {
    action: `Accept: ${quest.title}`,
    score,
    reason: `${questKindLabels[quest.kind]}, danger ${quest.danger}, ${issuer.name}, ${settlement.name}${
      route ? `, route ${Math.round(route.distance)} / danger ${route.danger}` : ", local"
    }, identity ${identityFit >= 0 ? "+" : ""}${Math.round(identityFit)}, stats ${statFit >= 0 ? "+" : ""}${Math.round(statFit)}, culture ${cultureFit >= 0 ? "+" : ""}${Math.round(cultureFit)}${
      storyFit ? `, legend +${Math.round(storyFit)}` : ""
    }, perception ${Math.round(perception)}`
  };
}

function featuresNearBand(world: World, band: Band): WorldFeature[] {
  const settlement = world.settlements[band.locationId];
  if (!settlement) {
    return [];
  }
  return Object.values(world.planet.features ?? {}).filter(
    (feature) => feature.nearestSettlementId === settlement.id || feature.regionId === settlement.mediumRegionId
  );
}

function holdingKindForFeature(feature: WorldFeature): TerrainHoldingKind {
  if (feature.kind === "ancient-vault") {
    return "sealed-vault";
  }
  if (feature.layer === "sky") {
    return "sky-dock";
  }
  if (mineableFeatureKinds.has(feature.kind)) {
    return "mine";
  }
  if (feature.kind === "cavern" || feature.kind === "mushroom-grotto" || feature.kind === "underground-river") {
    return "cavern-town";
  }
  if (feature.layer === "deep" || feature.kind === "crevice") {
    return "underground-fortress";
  }
  return "outpost";
}

function featureLabel(feature: WorldFeature): string {
  const kind = featureKindLabels[feature.kind];
  if (feature.layer === "sky" && kind.startsWith("sky ")) {
    return `${layerLabels[feature.layer]} ${kind.slice(4)}`;
  }
  return `${layerLabels[feature.layer]} ${kind}`;
}

function findFeatureByAction(world: World, action: string, prefix: string): WorldFeature | undefined {
  const name = action.slice(prefix.length).trim();
  return Object.values(world.planet.features ?? {}).find((feature) => feature.name === name);
}

function scoreFeatureActions(world: World, band: Band, leader: Person, members: Person[]): DecisionScore[] {
  const localFeatures = featuresNearBand(world, band);
  const hiddenFeatures = localFeatures.filter((feature) => feature.status === "hidden");
  const knownFeatures = localFeatures.filter((feature) => feature.status !== "hidden" && feature.status !== "depleted" && feature.status !== "sealed");
  const fatigue = average(members.map((member) => member.fatigue));
  const survival = average(members.map((member) => member.skills.survival));
  const perception = average(members.map((member) => member.stats.derived.perception));
  const scores: DecisionScore[] = [];

  if (hiddenFeatures.length > 0) {
    const bestHidden = [...hiddenFeatures].sort((a, b) => b.richness - a.richness || a.danger - b.danger)[0];
    scores.push({
      action: `Prospect: ${world.settlements[band.locationId]?.region ?? "local terrain"}`,
      score:
        62 +
        hiddenFeatures.length * 8 +
        leader.traits.curiosity * 0.26 +
        survival * 0.18 +
        perception * 0.16 +
        leader.skills.sorcery * 0.05 -
        fatigue * 0.45 +
        (bestHidden.layer === "sky" ? leader.stats.derived.intelligence * 0.08 : 0),
      reason: `${hiddenFeatures.length} hidden features, best rumor ${featureLabel(bestHidden)}`
    });
  }

  for (const feature of knownFeatures) {
    const dangerPenalty = Math.max(0, feature.danger - 45) * 0.44;
    const instabilityPenalty = Math.max(0, 50 - feature.stability) * 0.24;
    if (feature.exploration < 100) {
      scores.push({
        action: `Explore: ${feature.name}`,
        score:
          58 +
          leader.traits.curiosity * 0.3 +
          leader.traits.bravery * 0.16 +
          survival * 0.22 +
          perception * 0.2 +
          leader.stats.derived.intelligence * 0.1 +
          feature.richness * 0.16 -
          dangerPenalty -
          instabilityPenalty -
          fatigue * 0.34,
        reason: `${featureLabel(feature)}, explored ${Math.round(feature.exploration)}%, danger ${feature.danger}, stability ${feature.stability}`
      });
    }

    if (mineableFeatureKinds.has(feature.kind) && feature.depletion < 100 && feature.exploration >= 16) {
      scores.push({
        action: `Mine: ${feature.name}`,
        score:
          72 +
          feature.richness * 0.38 +
          survival * 0.12 +
          leader.stats.derived.endurance * 0.15 +
          leader.traits.ambition * 0.22 -
          feature.depletion * 0.28 -
          dangerPenalty -
          instabilityPenalty -
          fatigue * 0.36,
        reason: `${feature.resources.slice(0, 2).join(", ")} · richness ${feature.richness}, depleted ${Math.round(feature.depletion)}%, ${layerLabels[feature.layer]}`
      });
    }

    if (!feature.holdingId && feature.exploration >= 42 && feature.status !== "claimed" && band.supplies >= 20) {
      const kind = holdingKindForFeature(feature);
      scores.push({
        action: `Fortify: ${feature.name}`,
        score:
          58 +
          feature.richness * 0.16 +
          feature.stability * 0.22 +
          leader.skills.command * 0.22 +
          leader.skills.diplomacy * 0.12 +
          leader.traits.ambition * 0.24 +
          (kind === "underground-fortress" ? leader.traits.loyalty * 0.12 : 0) -
          feature.danger * 0.24 -
          Math.max(0, 28 - band.supplies) * 1.3,
        reason: `found ${kind.replace("-", " ")}, claim ${featureKindLabels[feature.kind]} for ${world.factions[leader.factionId]?.name ?? "society"}`
      });
    }
  }

  return scores;
}

function recipeSiteScore(world: World, band: Band, recipe: CraftingRecipeDefinition): { score: number; feature?: WorldFeature; reason: string } {
  const settlement = world.settlements[band.locationId];
  const localFeatures = featuresNearBand(world, band).filter((feature) => feature.status !== "hidden" && feature.status !== "depleted");
  const localText = [
    settlement?.terrain,
    settlement?.topography,
    settlement?.elevationBand,
    ...(settlement?.resources ?? []),
    ...(settlement?.tags ?? []),
    ...localFeatures.flatMap((feature) => [feature.kind, feature.layer, feature.elevationBand, ...feature.resources, ...feature.threats, ...feature.tags])
  ]
    .join(" ")
    .toLowerCase();

  const tagScore = (tag: string): number => {
    if (tag === "settlement" || tag === "workbench") return settlement ? 18 : 0;
    if (tag === "forge") return /mine|market|iron|copper|ore|steel|charcoal/.test(localText) ? 24 : 6;
    if (tag === "mine") return /mine|ore-vein|ore|iron|copper|bog iron/.test(localText) ? 24 : 0;
    if (tag === "forest") return settlement?.terrain === "forest" || /blackpine|wood|amber|resin/.test(localText) ? 20 : 0;
    if (tag === "crystal") return /crystal-seam|storm quartz|quartz|glass/.test(localText) ? 28 : 0;
    if (tag === "highland" || tag === "storm") return /high|alpine|highland|mountain|storm|sky salt/.test(localText) ? 20 : 0;
    if (tag === "vault" || tag === "ruin" || tag === "mirror") return /ancient-vault|sealed vault|ruins|relic glass|mirror|old road/.test(localText) ? 30 : 0;
    if (tag === "sky" || tag === "aether-door") return /sky-ruin|floating-island|sky|aether/.test(localText) ? 34 : 0;
    if (tag === "deep") return /deep|ancient-vault|crevice/.test(localText) ? 28 : 0;
    if (tag === "death") return /dead|ghost|ghoul|wight|grave|crypt|bone/.test(localText) ? 24 : 0;
    if (tag === "moon") return /moon|silver/.test(localText) ? 22 : 0;
    if (tag === "shrine") return /shrine|saint|ash|holy/.test(localText) ? 22 : 0;
    return localText.includes(tag) ? 12 : 0;
  };

  const score = recipe.siteTags.reduce((sum, tag) => sum + tagScore(tag), settlement ? 10 : 0);
  const bestFeature = localFeatures
    .map((feature) => {
      const text = [feature.kind, feature.layer, feature.elevationBand, ...feature.resources, ...feature.threats, ...feature.tags].join(" ").toLowerCase();
      const featureScore = recipe.siteTags.reduce((sum, tag) => sum + (text.includes(tag) ? 18 : tagScore(tag) * 0.35), 0) + feature.exploration * 0.12;
      return { feature, featureScore };
    })
    .sort((a, b) => b.featureScore - a.featureScore)[0]?.feature;
  return {
    score: clamp(score, 0, 100),
    feature: bestFeature,
    reason: recipe.siteTags.length ? recipe.siteTags.join(", ") : "ordinary workshop"
  };
}

function scoreCraftActions(world: World, band: Band, leader: Person, members: Person[], rng: Rng): DecisionScore[] {
  const scores: DecisionScore[] = [];
  for (const member of members) {
    ensureRecipeKnowledge(member, rng, cultureForPerson(world, member));
  }
  const candidateRecipes = recipeList.filter((recipe) =>
    members.some((member) => member.recipeIds.includes(recipe.id) && recipeMeetsRequirements(member, recipe))
  );
  for (const recipe of candidateRecipes) {
    const crafter = members
      .filter((member) => member.recipeIds.includes(recipe.id) && recipeMeetsRequirements(member, recipe))
      .sort((a, b) => b.stats.derived.intelligence + b.stats.derived.dexterity + b.skills.survival - (a.stats.derived.intelligence + a.stats.derived.dexterity + a.skills.survival))[0];
    if (!crafter) continue;
    const site = recipeSiteScore(world, band, recipe);
    const cost = 8 + recipe.tier * 6;
    const specialSiteNeeded = recipe.tier >= 4 || recipe.siteTags.some((tag) => ["sky", "aether-door", "deep", "vault", "crystal"].includes(tag));
    if (band.supplies < cost || (specialSiteNeeded && site.score < 34)) {
      continue;
    }
    const craftBias =
      leader.traits.ambition * 0.12 +
      leader.traits.curiosity * 0.1 +
      identityActionBias(leader, "train") +
      statActionBias(leader, "train") +
      (recipe.tags.includes("magic") ? Math.max(0, leader.identity.mightMagic) * 0.08 : 0) +
      (recipe.tags.includes("might") ? Math.max(0, -leader.identity.mightMagic) * 0.06 : 0);
    scores.push({
      action: `Craft: ${recipe.name}`,
      score: 20 + recipe.tier * 6 + site.score * 0.38 + craftBias + crafter.stats.derived.intelligence * 0.08 - cost * 0.4,
      reason: `${crafter.name} knows it · ${site.reason} · supplies ${cost}`
    });
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, 3);
}

function scoreBandActions(world: World, band: Band, rng: Rng, isFavored: boolean): DecisionScore[] {
  const leader = world.persons[band.leaderId];
  const members = livingMembers(world, band);
  const health = average(members.map((member) => member.hp / member.maxHp));
  const fatigue = average(members.map((member) => member.fatigue));
  const supplies = band.supplies;
  const doctrine = world.doctrine;
  const scores: DecisionScore[] = [];

  scores.push({
    action: "Rest and resupply",
    score:
      20 +
      (1 - health) * 92 +
      fatigue * 0.8 +
      Math.max(0, 38 - supplies) * 1.1 +
      identityActionBias(leader, "rest") +
      statActionBias(leader, "rest") +
      leader.traits.caution * 0.22 -
      leader.traits.ambition * 0.1,
    reason: `health ${Math.round(health * 100)}%, fatigue ${Math.round(fatigue)}, supplies ${Math.round(supplies)}`
  });

  scores.push({
    action: "Patrol nearby roads",
    score:
      28 +
      leader.traits.loyalty * 0.2 +
      leader.traits.bravery * 0.14 +
      identityActionBias(leader, "patrol") +
      statActionBias(leader, "patrol") +
      (world.settlements[band.locationId]?.threat ?? 30) * 0.45 +
      (band.purpose === "guarding" ? 18 : 0),
    reason: "lower local threat, gain small renown, maybe find trouble"
  });

  scores.push({
    action: "Train and drill",
    score:
      22 +
      leader.traits.ambition * 0.18 +
      band.cohesion * 0.18 +
      identityActionBias(leader, "train") +
      statActionBias(leader, "train") +
      (fatigue > 42 ? -14 : 0),
    reason: "slow skill growth and cohesion"
  });

  scores.push({
    action: "Recruit at settlement",
    score:
      18 +
      Math.max(0, 4 - members.length) * 28 +
      leader.skills.diplomacy * 0.22 +
      identityActionBias(leader, "recruit") +
      statActionBias(leader, "recruit") +
      band.notoriety * 0.12,
    reason: `${members.length} current members`
  });

  const quietScore = quietActivityDecisionScore(world, band);
  if (quietScore) {
    scores.push(quietScore);
  }

  scores.push(...scoreFeatureActions(world, band, leader, members));
  scores.push(...scoreCraftActions(world, band, leader, members, rng));

  for (const quest of Object.values(world.quests)) {
    if (quest.status === "open") {
      scores.push(scoreOpenQuest(world, band, quest, leader, doctrine));
    }
  }

  const memoryBias = leader.memories.reduce((sum, memory) => {
    if (memory.tags.includes("near-death")) {
      return sum - 5;
    }
    if (memory.tags.includes("victory")) {
      return sum + 3;
    }
    return sum;
  }, 0);

  for (const score of scores) {
    score.score += memoryBias + rng.int(-8, 8) + (isFavored ? 4 : 0);
  }

  return scores.sort((a, b) => b.score - a.score);
}

function noteRecipeLearning(world: World, person: Person, recipe: CraftingRecipeDefinition, learned: string[], source: string): void {
  learned.push(`${person.name} learns ${recipe.name}`);
  addMemory(person, world, `Learned ${recipe.name} from ${source}`, 6, ["recipe", "craft", ...recipe.tags.slice(0, 2)]);
}

function tryObservedRecipeLearning(world: World, person: Person, rng: Rng, learned: string[], source: string): void {
  const recipe = attemptObservedRecipeLearning(person, rng, world.tick, cultureForPerson(world, person));
  if (recipe) {
    noteRecipeLearning(world, person, recipe, learned, source);
  }
}

function recordItemRecipeKnowledge(world: World, members: Person[], item: Item, rng: Rng, learned: string[], source: string, bonus = 0): void {
  for (const member of members) {
    ensureRecipeKnowledge(member, rng, cultureForPerson(world, member));
    const study = observeRecipeFromItem(member, item, world.tick, rng, bonus);
    if (!study) {
      continue;
    }
    const attemptChance = clamp((study.exposure + Math.max(0, study.affinity)) / 260, 0.04, 0.62);
    if (rng.chance(attemptChance)) {
      tryObservedRecipeLearning(world, member, rng, learned, source);
    }
  }
}

function recordFeatureRecipeKnowledge(world: World, members: Person[], feature: WorldFeature, rng: Rng, learned: string[], source: string, bonus = 0): void {
  for (const member of members) {
    ensureRecipeKnowledge(member, rng, cultureForPerson(world, member));
    const studies = observeRecipesFromFeature(member, feature, world.tick, rng, bonus);
    if (studies.length === 0) {
      continue;
    }
    const bestStudy = studies.sort((a, b) => b.exposure + b.affinity * 0.3 - (a.exposure + a.affinity * 0.3))[0];
    const attemptChance = clamp((bestStudy.exposure + Math.max(0, bestStudy.affinity)) / 280, 0.04, 0.58);
    if (rng.chance(attemptChance)) {
      tryObservedRecipeLearning(world, member, rng, learned, source);
    }
  }
}

function executeCraftRecipe(world: World, band: Band, recipe: CraftingRecipeDefinition, rng: Rng): void {
  const members = livingMembers(world, band);
  const crafter = members
    .filter((member) => member.recipeIds.includes(recipe.id) && recipeMeetsRequirements(member, recipe))
    .sort((a, b) => b.stats.derived.intelligence + b.stats.derived.dexterity + b.skills.survival - (a.stats.derived.intelligence + a.stats.derived.dexterity + a.skills.survival))[0];
  if (!crafter) {
    return;
  }
  const site = recipeSiteScore(world, band, recipe);
  const cost = 8 + recipe.tier * 6;
  if (band.supplies < cost) {
    band.goal = `lacks supplies for ${recipe.name}`;
    return;
  }
  const item = makeRecipeItem(world, crafter, recipe.id, rng, band.locationId, site.feature?.id);
  if (!item) {
    return;
  }
  crafter.inventory.push(item);
  const equipped = autoEquip(crafter, item);
  band.supplies = clamp(band.supplies - cost, 0, 100);
  band.cohesion = clamp(band.cohesion + rng.int(0, 4) - (recipe.risks.length > 1 ? 1 : 0), 0, 100);
  crafter.fatigue = clamp(crafter.fatigue + rng.int(5, 14) + recipe.tier * 2, 0, 100);
  crafter.gold = clamp(crafter.gold - Math.floor(cost / 4), 0, 9999);
  crafter.renown += recipe.tier >= 4 ? rng.int(1, 3) : 0;
  teachCultureRecipe(cultureForPerson(world, crafter), recipe.id);
  addMemory(crafter, world, `Crafted ${item.name} through ${recipe.name}`, 8, ["recipe", "craft", recipe.id]);
  if (recipe.id === "soulforging") {
    crafter.status = [...new Set([...crafter.status, "soul-debt"])];
    crafter.morale = clamp(crafter.morale - rng.int(4, 12), 0, 100);
    shiftIdentity(crafter, { corruptPure: -rng.int(1, 3), evilGood: -rng.int(0, 2), vengefulForgiving: -rng.int(0, 2) });
  } else if (recipe.id === "aether-weaving") {
    crafter.status = [...new Set([...crafter.status, "aether-touched"])];
    shiftIdentity(crafter, { materialistSpiritualist: rng.int(1, 3), mightMagic: rng.int(1, 2) });
  } else if (recipe.tags.includes("holy")) {
    shiftIdentity(crafter, { corruptPure: rng.int(1, 2), vengefulForgiving: rng.int(0, 2) });
  }

  const learned: string[] = [];
  recordItemRecipeKnowledge(world, members, item, rng, learned, recipe.name, 8 + recipe.tier);
  for (const member of members) {
    appeaseEquippedItems(world, member, ["craft", "wealth", item.kind, item.quality, recipe.id, ...recipe.tags], `Crafted ${item.name}`, 5 + recipe.tier);
  }
  band.goal = `crafted ${item.name}`;
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "inventory",
    recipe.tier >= 5 || item.quality === "legendary" ? "high" : "medium",
    `${crafter.name} ${crafter.familyName} crafts ${item.name} through ${recipe.name}${equipped ? " and equips it" : ""}. Origin: ${item.provenance?.story ?? "unknown."}${learningLine}`,
    members.map((member) => member.id),
    [crafter.factionId],
    band.locationId
  );
}

function setBandLocation(world: World, band: Band, locationId: Id): void {
  band.locationId = locationId;
  for (const member of livingMembers(world, band)) {
    member.locationId = locationId;
  }
}

function beginTravel(world: World, band: Band, destinationId: Id, purpose: "quest" | "patrol" | "relocate", questId?: Id): boolean {
  if (band.locationId === destinationId) {
    setBandLocation(world, band, destinationId);
    band.travel = undefined;
    return false;
  }

  const route = getRoute(world, band.locationId, destinationId);
  const destination = world.settlements[destinationId];
  const origin = world.settlements[band.locationId];
  if (!route || !destination || !origin) {
    setBandLocation(world, band, destinationId);
    band.travel = undefined;
    return false;
  }

  band.travel = {
    originId: band.locationId,
    destinationId,
    routeId: route.id,
    progress: 0,
    total: route.distance,
    purpose,
    questId
  };
  const biome = world.planet.biomes[route.biomeId];
  band.goal = `traveling through ${biome.name} toward ${destination.name}`;
  addRouteTrail(world, route.id, 0, `${band.name} sets out`, "#f3e1a1", band.memberIds);
  return true;
}

function updateTravel(world: World, band: Band, rng: Rng): void {
  const travel = band.travel;
  if (!travel) {
    return;
  }

  const route = world.planet.routes[travel.routeId];
  const destination = world.settlements[travel.destinationId];
  const origin = world.settlements[travel.originId];
  const biome = route ? world.planet.biomes[route.biomeId] : undefined;
  const members = livingMembers(world, band);
  if (!route || !destination || !origin || members.length === 0) {
    band.travel = undefined;
    return;
  }

  const leader = world.persons[band.leaderId];
  const survival = average(members.map((member) => member.skills.survival));
  const travelStats = average(members.map((member) => (member.stats.derived.dexterity + member.stats.derived.endurance + member.stats.derived.perception) / 3));
  const perception = average(members.map((member) => member.stats.derived.perception));
  const travelBonus = partyAbilityBonus(members, "travel");
  const speed = clamp(
    10 + survival * 0.08 + travelStats * 0.04 + leader.skills.command * 0.04 + travelBonus * 0.07 + (band.supplies > 20 ? 2 : -2),
    6,
    28
  );
  travel.progress = clamp(travel.progress + speed, 0, travel.total);
  addRouteTrail(world, route.id, travel.progress / travel.total, band.name, band.id === world.deity.favoredBandId ? "#f3e1a1" : "#d7d9cd", band.memberIds);
  band.supplies = clamp(band.supplies - rng.int(1, 4), 0, 100);
  for (const member of members) {
    member.fatigue = clamp(
      member.fatigue +
        rng.int(1, 4) +
        terrainTravelCost[route.terrain] +
        topographyTravelCost[route.topography] +
        elevationBandTravelCost[route.elevationBand] +
        route.passDifficulty / 28,
      0,
      100
    );
  }

  if (rng.chance(route.danger / (900 + perception * 8))) {
    const target = rng.pick(members);
    const ecology = ecologyForElevation(route.biomeId, route.elevationBand);
    const threatPool = [...ecology.threats, ...(biome?.threats ?? [])];
    const threat = rng.pick(threatPool.length ? threatPool : ["roadside danger"]);
    const damage = rng.int(2, 8) + Math.ceil(route.danger / 18);
    target.hp = clamp(target.hp - damage, 1, target.maxHp);
    target.status = [...new Set([...target.status, "road-worn"])];
    band.cohesion = clamp(band.cohesion - rng.int(1, 4), 0, 100);
    event(
      world,
      "world",
      "medium",
      `${band.name} is harried by ${threat} on the ${route.topography} ${biome?.name ?? route.terrain} route; ${target.name} reaches camp road-worn.`,
      [target.id],
      [],
      origin.id
    );
  }

  if (travel.progress < travel.total) {
    band.goal = `traveling to ${destination.name} (${Math.round((travel.progress / travel.total) * 100)}%)`;
    return;
  }

  setBandLocation(world, band, destination.id);
  band.travel = undefined;
  band.goal = travel.questId ? `arrived for ${world.quests[travel.questId]?.title ?? "a contract"}` : `arrived at ${destination.name}`;
  for (const member of members) {
    appeaseEquippedItems(world, member, ["travel", "route", route.topography, route.elevationBand], `Reached ${destination.name}`, 4);
  }
  addLocationPulse(world, destination.id, `${band.name} arrives`, "#d7d9cd", ["arrival", "travel"], 5, 18);
  if (travel.questId || band.id === world.deity.favoredBandId) {
    event(
      world,
      "world",
      "medium",
      `${band.name} arrives at ${destination.name} from ${origin.name}.`,
      members.map((member) => member.id),
      [destination.factionId],
      destination.id
    );
  }
}

function acceptQuest(world: World, band: Band, questId: Id): void {
  const quest = world.quests[questId];
  const leader = world.persons[band.leaderId];
  quest.status = "active";
  quest.assignedBandId = band.id;
  band.currentQuestId = quest.id;
  if (beginTravel(world, band, quest.locationId, "quest", quest.id)) {
    event(
      world,
      "decision",
      "medium",
      `${leader.name} ${leader.familyName} takes contract "${quest.title}" and starts toward ${world.settlements[quest.locationId].name}.`,
      [leader.id],
      [quest.issuerFactionId],
      band.locationId
    );
    return;
  }
  band.goal = quest.title;
  event(
    world,
    "decision",
    "medium",
    `${leader.name} ${leader.familyName} takes contract: ${quest.title}.`,
    [leader.id],
    [quest.issuerFactionId],
    quest.locationId
  );
}

function executeRest(world: World, band: Band, rng: Rng): void {
  const members = livingMembers(world, band);
  for (const member of members) {
    member.hp = clamp(member.hp + rng.int(8, 22) + Math.floor(member.skills.medicine * 0.08), 0, member.maxHp);
    member.mana = clamp(member.mana + rng.int(5, 18), 0, member.maxMana);
    member.fatigue = clamp(member.fatigue - rng.int(14, 34), 0, 100);
    member.morale = clamp(member.morale + rng.int(2, 9), 0, 100);
    shiftIdentity(member, {
      warlikePeaceful: rng.int(0, 1),
      vengefulForgiving: rng.int(0, 1),
      materialistSpiritualist: rng.chance(0.3) ? 1 : 0
    });
    if (rng.chance(0.12)) {
      shiftCoreStats(member, { willpower: 1 });
    }
    appeaseEquippedItems(world, member, ["rest", "mercy", "protection"], "Rested and tended wounds", 5);
  }
  band.supplies = clamp(band.supplies + rng.int(12, 28), 0, 100);
  band.cohesion = clamp(band.cohesion + rng.int(1, 5), 0, 100);
  band.goal = "recovering";
  event(world, "decision", "low", `${band.name} rests, patches wounds, and buys rough supplies.`, members.map((m) => m.id), [], band.locationId);
}

function executePatrol(world: World, band: Band, rng: Rng): void {
  const settlement = world.settlements[band.locationId];
  const members = livingMembers(world, band);
  const leader = world.persons[band.leaderId];
  settlement.threat = clamp(settlement.threat - rng.int(3, 12), 0, 100);
  settlement.defense = clamp(settlement.defense + rng.int(1, 4), 0, 100);
  band.supplies = clamp(band.supplies - rng.int(2, 7), 0, 100);
  band.notoriety = clamp(band.notoriety + rng.int(0, 3), 0, 100);
  leader.renown += rng.int(0, 2);
  for (const member of members) {
    shiftIdentity(member, {
      warlikePeaceful: -rng.int(0, 2),
      cravenBold: rng.int(0, 2),
      corruptPure: rng.chance(0.35) ? 1 : 0
    });
    const learningChance = clamp(0.2 + cultureLearningBonus(cultureForPerson(world, member)) / 80, 0.16, 0.42);
    if (rng.chance(learningChance)) {
      shiftCoreStats(member, rng.chance(0.55) ? { physique: 1 } : { finesse: 1 });
    }
    appeaseEquippedItems(world, member, ["patrol", "order", "protection"], `Patrolled ${settlement.name}`, 5);
  }
  if (rng.chance(0.32)) {
    const quest = createQuest(world, rng, rng.pick(["defense", "hunt"]), settlement.factionId, settlement.id);
    world.quests[quest.id] = quest;
    event(world, "quest", "medium", `Patrol rumors harden into a new contract: ${quest.title}.`, [leader.id], [settlement.factionId], settlement.id);
  } else {
    event(world, "decision", "low", `${band.name} patrols ${settlement.name}; locals now call the roads a little less cursed.`, members.map((m) => m.id), [settlement.factionId], settlement.id);
  }
}

function applyFeatureStrain(members: Person[], feature: WorldFeature, rng: Rng): void {
  const strain = feature.layer === "sky" ? 4 : feature.layer === "deep" ? 5 : feature.layer === "underground" ? 3 : 2;
  for (const member of members) {
    member.fatigue = clamp(member.fatigue + rng.int(strain, strain + 8) + Math.max(0, feature.danger - feature.stability) / 30, 0, 100);
    if (feature.layer === "deep" && rng.chance(0.16)) {
      shiftCoreStats(member, { willpower: 1 });
    }
    if (mineableFeatureKinds.has(feature.kind) && rng.chance(0.2)) {
      shiftCoreStats(member, { physique: 1 });
    }
  }
}

function maybeFeatureMishap(world: World, band: Band, feature: WorldFeature, rng: Rng): string {
  const members = livingMembers(world, band);
  const perception = average(members.map((member) => member.stats.derived.perception));
  const risk = clamp((feature.danger + Math.max(0, 62 - feature.stability) - perception * 0.35) / 280, 0.03, 0.46);
  if (!rng.chance(risk) || members.length === 0) {
    return "";
  }

  const target = rng.pick(members);
  const damage = rng.int(3, 12) + Math.ceil(feature.danger / 16);
  target.hp = clamp(target.hp - damage, 1, target.maxHp);
  target.status = [...new Set([...target.status, feature.layer === "sky" ? "wind-battered" : "stone-bruised"])];
  band.cohesion = clamp(band.cohesion - rng.int(1, 5), 0, 100);
  feature.stability = clamp(feature.stability - rng.int(1, 6), 0, 100);
  addMemory(target, world, `Was hurt in ${feature.name}`, -4, ["terrain", feature.layer, "injury"]);
  return `${target.name} is hurt as hostile pressure from ${rng.pick(feature.threats.length ? feature.threats : ["the terrain"])} overtakes the site.`;
}

function executeProspect(world: World, band: Band, rng: Rng): void {
  const members = livingMembers(world, band);
  const hidden = featuresNearBand(world, band).filter((feature) => feature.status === "hidden");
  const leader = world.persons[band.leaderId];
  const learned: string[] = [];
  if (hidden.length === 0) {
    band.goal = "reading old terrain";
    event(world, "decision", "low", `${band.name} searches the local terrain but finds no new seam, cave, or sky-sign.`, [leader.id], [], band.locationId);
    return;
  }

  const feature = rng.weighted(hidden.map((candidate) => ({ value: candidate, weight: 8 + candidate.richness + candidate.danger * 0.15 })));
  const progress = rng.int(14, 34) + Math.floor(average(members.map((member) => member.skills.survival + member.stats.derived.perception)) * 0.08);
  feature.status = "known";
  feature.exploration = clamp(feature.exploration + progress, 0, 88);
  band.supplies = clamp(band.supplies - rng.int(1, 5), 0, 100);
  band.goal = `prospected ${feature.name}`;
  for (const member of members) {
    member.skills.survival = clamp(member.skills.survival + rng.int(0, 2), 0, 100);
    adjustTrait(member, "curiosity", rng.chance(0.35) ? 1 : 0);
    addMemory(member, world, `Found ${feature.name}`, 4, ["terrain", feature.layer, "discovery"]);
    appeaseEquippedItems(world, member, ["prospect", "explore", "secrets", feature.layer], `Discovered ${feature.name}`, 6);
  }
  recordFeatureRecipeKnowledge(world, members, feature, rng, learned, feature.name, 4);
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "world",
    "medium",
    `${band.name} discovers ${feature.name}, a ${featureLabel(feature)} near ${world.settlements[feature.nearestSettlementId]?.name ?? "the frontier"}.${learningLine}`,
    members.map((member) => member.id),
    [],
    feature.nearestSettlementId
  );
}

function executeExploreFeature(world: World, band: Band, feature: WorldFeature, rng: Rng): void {
  const members = livingMembers(world, band);
  const learned: string[] = [];
  if (members.length === 0) {
    return;
  }
  const leader = world.persons[band.leaderId];
  const progress =
    rng.int(10, 26) +
    Math.floor(leader.skills.command * 0.05) +
    Math.floor(average(members.map((member) => member.skills.survival + member.stats.derived.perception)) * 0.07);
  feature.exploration = clamp(feature.exploration + progress, 0, 100);
  band.supplies = clamp(band.supplies - rng.int(2, 8), 0, 100);
  band.goal = `exploring ${feature.name}`;
  applyFeatureStrain(members, feature, rng);
  for (const member of members) {
    member.skills.survival = clamp(member.skills.survival + rng.int(0, 2), 0, 100);
    shiftIdentity(member, { cravenBold: rng.int(0, 2), materialistSpiritualist: feature.layer === "sky" ? rng.int(0, 2) : 0 });
    appeaseEquippedItems(world, member, ["explore", "secrets", feature.layer, feature.kind], `Mapped ${feature.name}`, 6);
  }
  const mishap = maybeFeatureMishap(world, band, feature, rng);
  recordFeatureRecipeKnowledge(world, members, feature, rng, learned, feature.name, 8);
  const mapped = feature.exploration >= 100 ? " It is now mapped well enough to claim." : "";
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  if (feature.exploration >= 100 && feature.kind === "ancient-vault" && rng.chance(0.42)) {
    const quest = createQuest(world, rng, "delve", world.settlements[feature.nearestSettlementId]?.factionId, feature.nearestSettlementId);
    quest.title = `Open ${feature.name}`;
    quest.summary = `${feature.name} has been mapped, but its sealed chambers still need a true delve.`;
    quest.danger = clamp(Math.max(quest.danger, feature.danger + 12), 12, 95);
    world.quests[quest.id] = quest;
  }
  event(
    world,
    "world",
    feature.danger > 70 || feature.layer === "sky" ? "medium" : "low",
    `${band.name} maps ${feature.name} to ${Math.round(feature.exploration)}%.${mapped}${mishap ? ` ${mishap}` : ""}${learningLine}`,
    members.map((member) => member.id),
    [],
    feature.nearestSettlementId
  );
}

function executeMineFeature(world: World, band: Band, feature: WorldFeature, rng: Rng): void {
  const members = livingMembers(world, band);
  const learned: string[] = [];
  const settlement = world.settlements[feature.nearestSettlementId];
  const faction = world.factions[settlement?.factionId ?? ""];
  const leader = world.persons[band.leaderId];
  const outputResource = rng.pick(feature.resources.length ? feature.resources : settlement.resources);
  const extraction = clamp(
    rng.int(5, 14) + Math.floor(average(members.map((member) => member.skills.survival + member.stats.derived.endurance)) * 0.04) + Math.floor(feature.richness / 22),
    3,
    24
  );
  feature.depletion = clamp(feature.depletion + extraction, 0, 100);
  feature.exploration = clamp(feature.exploration + rng.int(3, 9), 0, 100);
  feature.status = feature.depletion >= 100 ? "depleted" : feature.status === "hidden" ? "known" : feature.status;
  band.supplies = clamp(band.supplies - rng.int(3, 9), 0, 100);
  band.goal = `mining ${feature.name}`;
  leader.gold += Math.ceil(extraction * (feature.richness / 28));
  if (settlement) {
    settlement.prosperity = clamp(settlement.prosperity + rng.int(1, 4), 0, 100);
  }
  if (faction) {
    faction.wealth = clamp(faction.wealth + rng.int(1, 4), 0, 100);
  }
  applyFeatureStrain(members, feature, rng);
  for (const member of members) {
    member.skills.survival = clamp(member.skills.survival + rng.int(0, 2), 0, 100);
    adjustTrait(member, "ambition", rng.chance(0.26) ? 1 : 0);
    appeaseEquippedItems(world, member, ["mine", "wealth", outputResource], `Mined ${outputResource}`, 6);
  }
  const mishap = maybeFeatureMishap(world, band, feature, rng);
  recordFeatureRecipeKnowledge(world, members, feature, rng, learned, feature.name, 10);
  const depleted = feature.depletion >= 100 ? " The site is stripped bare." : "";
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "inventory",
    feature.danger > 72 || mishap ? "medium" : "low",
    `${band.name} extracts ${outputResource} from ${feature.name}; depletion reaches ${Math.round(feature.depletion)}%.${depleted}${mishap ? ` ${mishap}` : ""}${learningLine}`,
    members.map((member) => member.id),
    faction ? [faction.id] : [],
    feature.nearestSettlementId
  );
}

function executeFortifyFeature(world: World, band: Band, feature: WorldFeature, rng: Rng): void {
  const members = livingMembers(world, band);
  const learned: string[] = [];
  const settlement = world.settlements[feature.nearestSettlementId];
  const leader = world.persons[band.leaderId];
  const factionId = leader.factionId || settlement.factionId;
  const faction = world.factions[factionId];
  const kind = holdingKindForFeature(feature);
  const outputResource = rng.pick(feature.resources.length ? feature.resources : settlement.resources);
  const holding = {
    id: makeId("holding", world.tick * 100 + rng.int(10, 99)),
    name: `${feature.name} ${kind === "mine" ? "Works" : kind === "sky-dock" ? "Mooring" : kind === "sealed-vault" ? "Seal" : "Hold"}`,
    kind,
    status: "active" as const,
    featureId: feature.id,
    factionId,
    level: 1,
    integrity: clamp(52 + Math.floor(feature.stability * 0.38) + rng.int(-8, 12), 10, 100),
    workers: rng.int(12, 48),
    garrison: kind === "mine" ? rng.int(2, 8) : rng.int(8, 28),
    stockpile: 0,
    outputResource
  };
  world.planet.holdings[holding.id] = holding;
  feature.holdingId = holding.id;
  feature.ownerFactionId = factionId;
  feature.status = "claimed";
  band.supplies = clamp(band.supplies - rng.int(10, 22), 0, 100);
  band.cohesion = clamp(band.cohesion + rng.int(1, 6), 0, 100);
  if (settlement) {
    settlement.defense = clamp(settlement.defense + (kind === "underground-fortress" ? rng.int(5, 12) : rng.int(1, 6)), 0, 100);
    settlement.prosperity = clamp(settlement.prosperity + (kind === "mine" || kind === "sky-dock" ? rng.int(3, 9) : rng.int(1, 5)), 0, 100);
  }
  if (faction) {
    faction.wealth = clamp(faction.wealth - rng.int(1, 5), 0, 100);
    faction.military = clamp(faction.military + (kind === "underground-fortress" ? rng.int(2, 6) : rng.int(0, 3)), 0, 100);
  }
  for (const member of members) {
    addMemory(member, world, `Helped claim ${feature.name}`, 5, ["terrain", "holding", kind]);
    shiftIdentity(member, { materialistSpiritualist: kind === "sky-dock" || kind === "sealed-vault" ? rng.int(0, 2) : -rng.int(0, 1) });
    appeaseEquippedItems(world, member, ["fortify", "claim", "order", "protection", "dominion", kind], `Claimed ${feature.name}`, 8);
  }
  recordFeatureRecipeKnowledge(world, members, feature, rng, learned, feature.name, 12);
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "world",
    "high",
    `${band.name} claims ${feature.name} for ${faction?.name ?? "their society"} and raises ${holding.name}, a ${kind.replace("-", " ")}.${learningLine}`,
    members.map((member) => member.id),
    faction ? [faction.id] : [],
    feature.nearestSettlementId
  );
}

function executeTraining(world: World, band: Band, rng: Rng): void {
  const members = livingMembers(world, band);
  const learned: string[] = [];
  for (const member of members) {
    const skill = strongestSkill(member);
    member.skills[skill] = clamp(member.skills[skill] + rng.int(1, 3), 0, 100);
    member.fatigue = clamp(member.fatigue + rng.int(4, 9), 0, 100);
    shiftIdentity(member, {
      cravenBold: rng.int(0, 2),
      mightMagic: skill === "sorcery" || skill === "ward" || skill === "medicine" ? rng.int(0, 2) : -rng.int(0, 2)
    });
    if (skill === "blade" || skill === "ward") {
      shiftCoreStats(member, rng.chance(0.5) ? { physique: 1 } : { willpower: 1 });
    } else if (skill === "survival") {
      shiftCoreStats(member, rng.chance(0.55) ? { finesse: 1 } : { physique: 1 });
    } else if (skill === "sorcery" || skill === "medicine" || skill === "command") {
      shiftCoreStats(member, { willpower: 1 });
    } else if (skill === "diplomacy") {
      shiftCoreStats(member, rng.chance(0.55) ? { willpower: 1 } : { finesse: 1 });
    } else if (rng.chance(0.55)) {
      shiftCoreStats(member, { finesse: 1 });
    }
    ensureStats(member);
    ensureRecipeKnowledge(member, rng, cultureForPerson(world, member));
    if (rng.chance(0.24)) {
      const ability = learnEligibleAbility(member, rng);
      if (ability) {
        learned.push(`${member.name} learns ${ability.name}`);
        addMemory(member, world, `Learned ${ability.name} while drilling`, 4, ["training", "ability"]);
      }
    }
    if (rng.chance(0.18 + cultureLearningBonus(cultureForPerson(world, member)) / 120)) {
      tryObservedRecipeLearning(world, member, rng, learned, "drilling and shop talk");
    }
  }
  band.cohesion = clamp(band.cohesion + rng.int(3, 9), 0, 100);
  band.goal = "drilling";
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "decision",
    "low",
    `${band.name} drills until old habits turn into reflex. Cohesion ${signed(rng.int(3, 7))}.${learningLine}`,
    members.map((m) => m.id),
    [],
    band.locationId
  );
}

function executeRecruit(world: World, band: Band, rng: Rng): void {
  const leader = world.persons[band.leaderId];
  const candidates = Object.values(world.persons).filter(
    (person) => person.alive && !person.bandId && person.locationId === band.locationId && person.role !== "commoner"
  );
  if (candidates.length === 0 || livingMembers(world, band).length >= 5) {
    band.goal = "failed recruitment";
    event(world, "decision", "low", `${band.name} looks for recruits, but only rumor-drunk onlookers answer.`, [leader.id], [], band.locationId);
    return;
  }

  const recruit = rng.pick(candidates);
  recruit.bandId = band.id;
  band.memberIds.push(recruit.id);
  band.cohesion = clamp(band.cohesion - rng.int(2, 8), 0, 100);
  recruit.relations[leader.id] = rng.int(4, 22);
  leader.relations[recruit.id] = rng.int(2, 18);
  shiftIdentity(leader, { authoritarianEgalitarian: rng.int(0, 2), vengefulForgiving: rng.int(0, 1) });
  shiftIdentity(recruit, { authoritarianEgalitarian: rng.int(0, 2), vengefulForgiving: rng.int(0, 1) });
  band.goal = "testing a new companion";
  event(
    world,
    "relation",
    "medium",
    `${recruit.name} ${recruit.familyName}, a ${recruit.role}, joins ${band.name}.`,
    [leader.id, recruit.id],
    [recruit.factionId],
    band.locationId
  );
}

function completeQuest(world: World, band: Band, quest: Quest, rng: Rng): void {
  const issuer = world.factions[quest.issuerFactionId];
  const settlement = world.settlements[quest.locationId];
  const members = livingMembers(world, band);
  const leader = world.persons[band.leaderId];
  quest.status = "succeeded";
  quest.progress = 100;
  band.currentQuestId = undefined;
  band.travel = undefined;
  band.goal = "looking for a contract";
  band.supplies = clamp(band.supplies - rng.int(4, 13), 0, 100);
  band.cohesion = clamp(band.cohesion + rng.int(1, 8), 0, 100);
  leader.gold += quest.rewardGold;
  leader.renown += quest.rewardRenown;
  issuer.wealth = clamp(issuer.wealth + rng.int(1, 5), 0, 100);
  issuer.stability = clamp(issuer.stability + rng.int(2, 8), 0, 100);
  settlement.threat = clamp(settlement.threat - rng.int(8, 22), 0, 100);
  settlement.prosperity = clamp(settlement.prosperity + rng.int(1, 7), 0, 100);
  const learned: string[] = [];

  for (const member of members) {
    const skill = quest.kind === "politics" ? "diplomacy" : quest.kind === "escort" ? "survival" : strongestSkill(member);
    member.skills[skill] = clamp(member.skills[skill] + rng.int(1, 4), 0, 100);
    member.morale = clamp(member.morale + rng.int(2, 8), 0, 100);
    member.renown += rng.int(1, 3);
    addMemory(member, world, `Succeeded at ${quest.title}`, 7, ["victory", quest.kind]);
    mutateIdentityForQuest(member, quest.kind, "success", rng);
    adjustTrait(member, "ambition", rng.chance(0.45) ? 1 : 0);
    if (quest.kind === "defense" || quest.kind === "escort") {
      adjustTrait(member, "loyalty", rng.chance(0.35) ? 1 : 0);
    }
    if (quest.kind === "defense" || quest.kind === "hunt") {
      shiftCoreStats(member, rng.chance(0.55) ? { physique: 1 } : { willpower: 1 });
    } else if (quest.kind === "delve" || quest.kind === "escort") {
      shiftCoreStats(member, rng.chance(0.55) ? { finesse: 1 } : { willpower: 1 });
    } else {
      shiftCoreStats(member, { willpower: 1 });
    }
    const learningChance = clamp(0.16 + cultureLearningBonus(cultureForPerson(world, member)) / 100, 0.12, 0.34);
    appeaseEquippedItems(world, member, ["quest", quest.kind, "victory", "bloodshed", "dominion"], `Succeeded at ${quest.title}`, 7);
    if (rng.chance(learningChance)) {
      const ability = learnEligibleAbility(member, rng);
      if (ability) {
        learned.push(`${member.name} learns ${ability.name}`);
        addMemory(member, world, `Learned ${ability.name} after ${quest.title}`, 5, ["quest", "ability", quest.kind]);
      }
    }
  }

  const loot = makeBiomeLoot(world, quest.locationId, rng, Math.ceil(quest.danger / 32));
  const receiver = rng.pick(members);
  receiver.inventory.push(loot);
  const equipped = autoEquip(receiver, loot);
  appeaseEquippedItems(world, receiver, ["loot", "wealth", loot.kind, loot.quality], `Claimed ${loot.name}`, 5);
  recordItemRecipeKnowledge(world, members, loot, rng, learned, loot.name, quest.kind === "delve" ? 10 : 5);
  const storyLine = resolveStoryQuest(world, band, quest, receiver, rng);
  const learningLine = learned.length ? ` ${learned.slice(0, 2).join("; ")}.` : "";
  event(
    world,
    "quest",
    "high",
    `${band.name} completes "${quest.title}" for ${issuer.name}. ${receiver.name} claims ${loot.name}${equipped ? " and equips it" : ""}.${learningLine}${
      storyLine ? ` ${storyLine}` : ""
    }`,
    members.map((member) => member.id),
    [issuer.id],
    quest.locationId
  );
}

function failQuest(world: World, band: Band, quest: Quest, rng: Rng, reason: string): void {
  const issuer = world.factions[quest.issuerFactionId];
  const settlement = world.settlements[quest.locationId];
  const members = livingMembers(world, band);
  const storyLine = setbackStoryQuest(world, band, quest, rng, reason);
  quest.status = reason === "expired" ? "expired" : "failed";
  band.currentQuestId = undefined;
  band.travel = undefined;
  band.goal = "recovering from failure";
  issuer.stability = clamp(issuer.stability - rng.int(3, 12), 0, 100);
  settlement.threat = clamp(settlement.threat + rng.int(5, 18), 0, 100);
  settlement.unrest = clamp(settlement.unrest + rng.int(3, 12), 0, 100);
  for (const member of members) {
    member.morale = clamp(member.morale - rng.int(4, 14), 0, 100);
    adjustTrait(member, "caution", rng.chance(0.5) ? 2 : 1);
    mutateIdentityForQuest(member, quest.kind, "failure", rng);
    addMemory(member, world, `Failed at ${quest.title}`, -6, ["failure", quest.kind]);
  }
  event(
    world,
    "quest",
    "high",
    `${band.name} fails "${quest.title}" (${reason}). ${settlement.name} grows more afraid.${storyLine ? ` ${storyLine}` : ""}`,
    members.map((member) => member.id),
    [issuer.id],
    quest.locationId
  );
}

function expireQuest(world: World, quest: Quest, rng: Rng): void {
  const issuer = world.factions[quest.issuerFactionId];
  const settlement = world.settlements[quest.locationId];
  quest.status = "expired";
  const storyLine = expireStoryQuest(world, quest, rng);
  issuer.stability = clamp(issuer.stability - rng.int(1, 5), 0, 100);
  settlement.threat = clamp(settlement.threat + rng.int(2, 9), 0, 100);
  settlement.unrest = clamp(settlement.unrest + rng.int(1, 6), 0, 100);
  event(
    world,
    "quest",
    "medium",
    `No one answers "${quest.title}" in time. ${settlement.name} absorbs the consequence alone.${storyLine ? ` ${storyLine}` : ""}`,
    [],
    [issuer.id],
    quest.locationId
  );
}

function continueQuest(world: World, band: Band, rng: Rng): void {
  const quest = band.currentQuestId ? world.quests[band.currentQuestId] : undefined;
  if (!quest || quest.status !== "active") {
    band.currentQuestId = undefined;
    return;
  }

  const members = livingMembers(world, band);
  if (members.length === 0) {
    quest.status = "failed";
    return;
  }

  const leader = world.persons[band.leaderId];
  if (band.locationId !== quest.locationId) {
    beginTravel(world, band, quest.locationId, "quest", quest.id);
    return;
  }

  const health = average(members.map((member) => member.hp / member.maxHp));
  const fatigue = average(members.map((member) => member.fatigue));
  if (health < 0.46 || band.supplies <= 0 || fatigue > 78) {
    quest.status = "open";
    quest.assignedBandId = undefined;
    quest.progress = clamp(quest.progress - rng.int(6, 16), 0, 95);
    band.currentQuestId = undefined;
    band.goal = "withdrawing to recover";
    band.cohesion = clamp(band.cohesion - rng.int(1, 5), 0, 100);
    for (const member of members) {
      adjustTrait(member, "caution", rng.chance(0.35) ? 1 : 0);
      mutateIdentityForQuest(member, quest.kind, "retreat", rng);
    }
    event(
      world,
      "quest",
      "medium",
      `${band.name} suspends "${quest.title}" to recover before the road takes more from them.`,
      members.map((member) => member.id),
      [quest.issuerFactionId],
      quest.locationId
    );
    return;
  }

  const progress = rng.int(10, 22) + Math.floor(leader.skills.command * 0.08) + Math.floor(average(members.map((m) => m.skills.survival)) * 0.05);
  quest.progress = clamp(quest.progress + progress, 0, 100);
  band.supplies = clamp(band.supplies - rng.int(2, 7), 0, 100);
  for (const member of members) {
    member.fatigue = clamp(member.fatigue + rng.int(2, 8), 0, 100);
  }

  if (rng.chance(0.22 + quest.danger / 360) || quest.progress >= 100) {
    const result = simulateCombat(world, band, quest, rng);
    if (result === "victory") {
      completeQuest(world, band, quest, rng);
      return;
    }
    if (result === "defeat") {
      failQuest(world, band, quest, rng, "defeated");
      return;
    }
    quest.progress = clamp(quest.progress - rng.int(10, 24), 0, 90);
    band.supplies = clamp(band.supplies - rng.int(5, 16), 0, 100);
    for (const member of members) {
      adjustTrait(member, "caution", 1);
      mutateIdentityForQuest(member, quest.kind, "retreat", rng);
    }
    return;
  }

  event(
    world,
    "quest",
    "low",
    `${band.name} advances "${quest.title}" to ${quest.progress}%.`,
    members.map((member) => member.id),
    [quest.issuerFactionId],
    quest.locationId
  );
}

function updateBand(world: World, band: Band, rng: Rng, isFavored: boolean): void {
  const members = livingMembers(world, band);
  if (members.length === 0) {
    band.goal = "broken; no living members remain";
    if (isFavored) {
      world.lastDecisionScores = [
        {
          action: "No living members",
          score: 0,
          reason: `${band.name} has become history. Favor another band.`
        }
      ];
    }
    return;
  }
  if (!ensureBandLeader(world, band)) {
    return;
  }

  for (const member of members) {
    member.fatigue = clamp(member.fatigue + rng.int(0, 3), 0, 100);
    if (member.status.includes("blessed")) {
      member.hp = clamp(member.hp + 1, 0, member.maxHp);
    }
  }

  if (band.travel) {
    updateTravel(world, band, rng);
    if (isFavored) {
      const travel = band.travel;
      world.lastDecisionScores = travel
        ? [
            {
              action: `Travel to ${world.settlements[travel.destinationId]?.name ?? "destination"}`,
              score: Math.round((travel.progress / travel.total) * 100),
              reason: `${Math.round(travel.progress)}/${Math.round(travel.total)} across ${
                world.planet.routes[travel.routeId]?.topography ?? world.planet.routes[travel.routeId]?.terrain ?? "unknown"
              } terrain`
            }
          ]
        : [
            {
              action: "Arrived",
              score: 100,
              reason: band.goal
            }
          ];
    }
    return;
  }

  if (band.currentQuestId) {
    continueQuest(world, band, rng);
    return;
  }

  const scores = scoreBandActions(world, band, rng, isFavored);
  if (isFavored) {
    world.lastDecisionScores = scores.slice(0, 6);
  }
  const chosen = scores[0];
  const questId = chosen.action.startsWith("Accept: ")
    ? Object.values(world.quests).find((quest) => chosen.action === `Accept: ${quest.title}`)?.id
    : undefined;

  if (questId) {
    acceptQuest(world, band, questId);
    return;
  }

  if (chosen.action.startsWith("Prospect: ")) {
    executeProspect(world, band, rng);
    return;
  }
  if (chosen.action.startsWith("Explore: ")) {
    const feature = findFeatureByAction(world, chosen.action, "Explore:");
    if (feature) {
      executeExploreFeature(world, band, feature, rng);
      return;
    }
  }
  if (chosen.action.startsWith("Mine: ")) {
    const feature = findFeatureByAction(world, chosen.action, "Mine:");
    if (feature) {
      executeMineFeature(world, band, feature, rng);
      return;
    }
  }
  if (chosen.action.startsWith("Fortify: ")) {
    const feature = findFeatureByAction(world, chosen.action, "Fortify:");
    if (feature) {
      executeFortifyFeature(world, band, feature, rng);
      return;
    }
  }
  if (chosen.action.startsWith("Craft: ")) {
    const recipeName = chosen.action.slice("Craft: ".length).trim();
    const recipe = recipeList.find((candidate) => candidate.name === recipeName);
    if (recipe) {
      executeCraftRecipe(world, band, recipe, rng);
      return;
    }
  }

  if (isQuietActivityAction(chosen.action)) {
    updateQuietBandActivity(world, band, rng, { active: true });
    return;
  }

  if (chosen.action === "Rest and resupply") {
    executeRest(world, band, rng);
    return;
  }
  if (chosen.action === "Patrol nearby roads") {
    executePatrol(world, band, rng);
    return;
  }
  if (chosen.action === "Train and drill") {
    executeTraining(world, band, rng);
    return;
  }
  if (chosen.action === "Recruit at settlement") {
    executeRecruit(world, band, rng);
    return;
  }
}

function updateQuestPressure(world: World, rng: Rng): void {
  for (const quest of Object.values(world.quests)) {
    if (quest.status !== "open" && quest.status !== "active") {
      continue;
    }
    quest.urgency -= 1;
    if (quest.urgency <= 0 && quest.status === "open") {
      expireQuest(world, quest, rng);
    }
  }
}

function maybeConquerSettlement(world: World, conqueror: Faction, defender: Faction, rng: Rng): void {
  if (!conqueror.activeWars.includes(defender.id) || !rng.chance(0.08)) {
    return;
  }
  const targets = Object.values(world.settlements).filter((settlement) => settlement.factionId === defender.id);
  if (targets.length === 0) {
    return;
  }
  const settlement = rng.weighted(
    targets.map((target) => ({
      value: target,
      weight: 8 + target.prosperity * 0.04 + Math.max(0, 70 - target.defense) * 0.16 + target.unrest * 0.05
    }))
  );
  const attack = conqueror.military + rng.int(-18, 32) + conqueror.stability * 0.08;
  const defense = settlement.defense + defender.military * 0.32 + rng.int(-12, 26);
  if (attack < defense) {
    settlement.threat = clamp(settlement.threat + rng.int(1, 5), 0, 100);
    return;
  }

  const oldFactionId = settlement.factionId;
  settlement.factionId = conqueror.id;
  settlement.unrest = clamp(settlement.unrest + rng.int(12, 28), 0, 100);
  settlement.defense = clamp(settlement.defense - rng.int(8, 20), 0, 100);
  settlement.threat = clamp(settlement.threat + rng.int(8, 18), 0, 100);
  conqueror.wealth = clamp(conqueror.wealth + rng.int(1, 5), 0, 100);
  defender.stability = clamp(defender.stability - rng.int(3, 9), 0, 100);

  const children = Object.values(world.persons).filter((person) => person.alive && person.age < 16 && person.locationId === settlement.id && person.factionId === oldFactionId);
  const warded: string[] = [];
  for (const child of children) {
    if (rng.chance(0.42) && createWardFromConquest(world, child, conqueror.id, settlement.id, rng)) {
      warded.push(child.name);
    }
  }
  event(
    world,
    "world",
    "high",
    `${conqueror.name} conquers ${settlement.name} from ${defender.name}.${warded.length ? ` Children are taken into wardship: ${warded.slice(0, 3).join(", ")}.` : ""}`,
    [],
    [conqueror.id, defender.id],
    settlement.id
  );
}

function updateFactionPolitics(world: World, rng: Rng): void {
  if (!rng.chance(0.34)) {
    return;
  }

  const factions = Object.values(world.factions);
  const faction = rng.pick(factions);
  const other = rng.pick(factions.filter((candidate) => candidate.id !== faction.id));
  const relation = factionRelation(faction, other.id);
  const drift = rng.int(-8, 6) + (faction.stability < 35 ? -4 : 0);
  faction.relations[other.id] = clamp(relation + drift, -100, 100);
  other.relations[faction.id] = clamp((other.relations[faction.id] ?? 0) + Math.round(drift * 0.65), -100, 100);

  if (faction.relations[other.id] < -60 && !faction.activeWars.includes(other.id)) {
    faction.activeWars.push(other.id);
    other.activeWars.push(faction.id);
    event(world, "world", "high", `${faction.name} and ${other.name} slide into open war.`, [], [faction.id, other.id]);
    return;
  }

  maybeConquerSettlement(world, faction, other, rng);
  maybeConquerSettlement(world, other, faction, rng);

  if (faction.stability < 24 && rng.chance(0.3)) {
    faction.stability = clamp(faction.stability - rng.int(2, 9), 0, 100);
    const settlement = world.settlements[faction.capitalId];
    settlement.unrest = clamp(settlement.unrest + rng.int(6, 18), 0, 100);
    const quest = createQuest(world, rng, "politics", faction.id, settlement.id);
    world.quests[quest.id] = quest;
    event(world, "world", "high", `${faction.name} trembles with succession rumors. A political contract appears in ${settlement.name}.`, [], [faction.id], settlement.id);
    return;
  }

  if (Math.abs(drift) >= 6) {
    event(world, "world", "low", `${faction.name}'s stance toward ${other.name} becomes ${relationName(faction.relations[other.id])}.`, [], [faction.id, other.id]);
  }
}

function updateTerrainHoldings(world: World, rng: Rng): void {
  if (world.tick % ticksPerDay !== 0) {
    return;
  }

  for (const holding of Object.values(world.planet.holdings ?? {})) {
    if (holding.status === "abandoned") {
      continue;
    }
    const feature = world.planet.features[holding.featureId];
    const settlement = feature ? world.settlements[feature.nearestSettlementId] : undefined;
    const faction = world.factions[holding.factionId];
    if (!feature || !settlement || !faction) {
      holding.status = "abandoned";
      continue;
    }

    const output = Math.max(1, Math.floor((feature.richness * holding.level * holding.integrity) / 1800));
    holding.stockpile = clamp(holding.stockpile + output, 0, 999);
    faction.wealth = clamp(faction.wealth + Math.floor(output / 2), 0, 100);
    settlement.prosperity = clamp(settlement.prosperity + (holding.kind === "mine" || holding.kind === "sky-dock" ? 1 : 0), 0, 100);
    settlement.defense = clamp(settlement.defense + (holding.kind === "underground-fortress" ? 1 : 0), 0, 100);
    if (holding.kind === "mine" && feature.depletion < 100) {
      feature.depletion = clamp(feature.depletion + Math.max(0.4, output * 0.55), 0, 100);
      if (feature.depletion >= 100) {
        feature.status = "depleted";
        holding.status = "abandoned";
        event(world, "world", "medium", `${holding.name} exhausts ${feature.name} and is abandoned.`, [], [faction.id], settlement.id);
        continue;
      }
    }

    const accidentRisk = clamp((feature.danger + Math.max(0, 55 - feature.stability) - holding.integrity * 0.35 - holding.garrison * 0.25) / 360, 0.01, 0.28);
    if (rng.chance(accidentRisk)) {
      const damage = rng.int(4, 16);
      holding.integrity = clamp(holding.integrity - damage, 0, 100);
      settlement.threat = clamp(settlement.threat + rng.int(1, 5), 0, 100);
      holding.status = holding.integrity < 28 ? "damaged" : holding.status;
      event(
        world,
        "world",
        holding.integrity < 28 ? "high" : "medium",
        `${holding.name} suffers a ${feature.layer === "sky" ? "wind shear" : "collapse"} while working ${feature.name}. Integrity ${Math.round(holding.integrity)}.`,
        [],
        [faction.id],
        settlement.id
      );
    }
  }
}

function updateSettlements(world: World, rng: Rng): void {
  for (const settlement of Object.values(world.settlements)) {
    const faction = world.factions[settlement.factionId];
    const warPressure = faction.activeWars.length * rng.int(0, 3);
    settlement.threat = clamp(settlement.threat + rng.int(-2, 3) + warPressure, 0, 100);
    settlement.unrest = clamp(settlement.unrest + rng.int(-2, 2) + (faction.stability < 35 ? 1 : 0), 0, 100);
    settlement.prosperity = clamp(settlement.prosperity + rng.int(-1, 2) - Math.floor(settlement.threat / 52), 0, 100);
    if (world.tick % ticksPerDay === 0) {
      applySettlementCulture(world, settlement, rng);
    }

    if (settlement.threat > 76 && rng.chance(0.2)) {
      const quest = createQuest(world, rng, "defense", settlement.factionId, settlement.id);
      world.quests[quest.id] = quest;
      event(world, "quest", "high", `${settlement.name} sends urgent runners: ${quest.title}.`, [], [settlement.factionId], settlement.id);
    }
  }
}

function updateSettlementDevelopmentLane(world: World): void {
  updateSettlementDevelopment(world, {
    issueCadenceTicks: ticksPerDay * 5,
    buildCadenceTicks: ticksPerDay,
    serviceCadenceTicks: ticksPerDay * 2,
    minPressure: 58,
    maxSignals: 8,
    maxPerSettlement: 1,
    maxNewOrders: 2,
    maxActivePerSettlement: 1
  });
}

function spawnOccasionalQuest(world: World, rng: Rng): void {
  const openCount = Object.values(world.quests).filter((quest) => quest.status === "open").length;
  if (openCount < 6 || rng.chance(0.16)) {
    const kind = world.deity.omen !== "none" && rng.chance(0.48) ? world.deity.omen : undefined;
    const quest = createQuest(world, rng, kind);
    world.quests[quest.id] = quest;
    event(world, "quest", "medium", `A new ${questKindLabels[quest.kind].toLowerCase()} contract spreads by rumor: ${quest.title}.`, [], [quest.issuerFactionId], quest.locationId);
  }
}

function updateRelationStancePair(world: World, firstId: Id | undefined, secondId: Id | undefined): void {
  if (!firstId || !secondId || firstId === secondId) {
    return;
  }
  const first = world.persons[firstId];
  const second = world.persons[secondId];
  if (!first?.alive || !second?.alive) {
    return;
  }
  updatePersonRelationStance(first, second);
  updatePersonRelationStance(second, first);
}

function updateSocialEmotionalState(world: World): void {
  const living = Object.values(world.persons).filter((person) => person.alive);
  tickSocialEmotionalStates(world, living, { tick: world.tick });

  for (const person of living) {
    const relationIds = Object.entries(person.relations)
      .filter(([, value]) => Math.abs(value) >= 28)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([id]) => id);
    const socialIds = [
      ...Object.keys(person.social?.trustByPersonId ?? {}),
      ...Object.keys(person.social?.suspicionByPersonId ?? {}),
      ...person.parentIds,
      ...person.childIds,
      ...person.guardianIds
    ];
    for (const targetId of [...new Set([...relationIds, ...socialIds])]) {
      updateRelationStancePair(world, person.id, targetId);
    }
  }

  for (const band of Object.values(world.bands)) {
    for (let firstIndex = 0; firstIndex < band.memberIds.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < band.memberIds.length; secondIndex += 1) {
        updateRelationStancePair(world, band.memberIds[firstIndex], band.memberIds[secondIndex]);
      }
    }
    updateBandEmotionalClimate(world, band, { tick: world.tick });
  }

  for (const organization of Object.values(world.organizations ?? {})) {
    const members = organization.memberIds.slice(0, 8);
    for (const memberId of members) {
      updateRelationStancePair(world, organization.leaderPersonId, memberId);
    }
    updateOrganizationEmotionalClimate(world, organization, { tick: world.tick });
  }
}

function updateMeaningfulConversations(world: World, rng: Rng): void {
  if (world.tick % (ticksPerDay * 2) !== 0) {
    return;
  }
  let applied = 0;
  for (const band of Object.values(world.bands).sort((left, right) => left.id.localeCompare(right.id))) {
    if (applied >= 3) {
      break;
    }
    const members = livingMembers(world, band)
      .filter((person) => world.tick - (person.social?.lastConversationTick ?? -999) >= ticksPerDay)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (members.length < 2) {
      continue;
    }
    const speaker = rng.pick(members);
    const listener = rng.pick(members.filter((person) => person.id !== speaker.id));
    const projection = deriveConversationProjection(world, speaker, listener, {
      maxTopics: 4,
      includeQuests: true,
      minTopicScore: 22
    });
    if (!projection) {
      continue;
    }
    const result = applyConversationProjection(world, projection, { emitEvent: false });
    if (!result.applied) {
      continue;
    }
    if (speaker.social) {
      speaker.social.lastConversationTick = world.tick;
    }
    if (listener.social) {
      listener.social.lastConversationTick = world.tick;
    }
    applied += 1;
  }
}

function updateOrganizationPressureQuests(world: World): void {
  if (world.tick % (ticksPerDay * 3) !== 0) {
    return;
  }
  const pressure = advanceOrganizationEconomy(world, undefined, {
    maxSignals: 6,
    signalThreshold: 68
  });
  const proposals = proposeOrganizationPressureQuestNeeds(world, pressure.signals, {
    minPressure: 62,
    maxProposals: 2,
    maxPerOrganization: 1,
    maxPerAsset: 1,
    maxPerLocation: 1,
    includeLowPriority: false
  });
  addQuestNeedProposals(world, proposals, {
    maxCreated: 1,
    maxOpenQuests: 18,
    maxOpenPerLocation: 3,
    emitEvents: true
  });
}

function updateTradeServicePressure(world: World): void {
  if (world.tick % (ticksPerDay * 4) !== 0) {
    return;
  }
  addQuestNeedProposals(
    world,
    proposeTradeServiceQuestNeeds(world, {
      minPressure: 54,
      maxProposals: 4,
      maxPerLocation: 1,
      maxPerRoute: 1
    }),
    {
      maxCreated: 1,
      maxOpenQuests: 18,
      maxOpenPerLocation: 3,
      emitEvents: true
    }
  );
}

function updateConditionPressure(world: World): void {
  if (world.tick % (ticksPerDay * 2) !== 0) {
    return;
  }
  applyConditionEncounterPressure(world, {
    includeQuestSignals: false,
    minPressure: 42,
    maxSignals: 8,
    maxPerPerson: 1,
    maxDeltaPerKind: 12
  });
  addQuestNeedProposals(world, proposeConditionPressureQuestNeeds(world, { minPressure: 44, maxProposals: 4, maxPerPerson: 1, maxPerLocation: 1 }), {
    maxCreated: 1,
    maxOpenQuests: 18,
    maxOpenPerLocation: 3,
    emitEvents: true
  });
}

function updateRemainsPressure(world: World): void {
  syncRemainsForDeadPersons(world, { maxCreated: 4 });
  if (world.tick % (ticksPerDay * 2) !== 0) {
    return;
  }
  applyRemainsEncounterPressure(world, {
    includeQuestSignals: false,
    minPressure: 34,
    maxSignals: 8,
    maxDeltaPerKind: 10
  });
  addQuestNeedProposals(world, proposeRemainsPressureQuestNeeds(world, { minPressure: 40, maxProposals: 4, maxPerLocation: 1 }), {
    maxCreated: 1,
    maxOpenQuests: 18,
    maxOpenPerLocation: 3,
    emitEvents: true
  });
}

function updatePowerResources(world: World): void {
  for (const person of Object.values(world.persons)) {
    if (person.alive) {
      tickPowerResources(person, undefined, world.tick);
    }
  }
}

function updateAugmentations(world: World): void {
  if (world.tick % ticksPerDay !== 0) {
    return;
  }
  for (const person of Object.values(world.persons)) {
    if (person.alive) {
      tickAugmentations(person, { tick: world.tick });
    }
  }
}

function equippedItems(person: Person): Item[] {
  return [person.equipment.weapon, person.equipment.armor, person.equipment.trinket].filter((item): item is Item => Boolean(item)).map((item) => ensureItem(item));
}

function desireMatches(desire: ItemDesire, tags: string[]): boolean {
  if (desire === "bloodshed") return tags.some((tag) => ["combat", "victory", "bloodshed", "hunt", "defense", "delve"].includes(tag));
  if (desire === "mercy") return tags.some((tag) => ["mercy", "rest", "heal", "escort"].includes(tag));
  if (desire === "secrets") return tags.some((tag) => ["secrets", "explore", "prospect", "delve", "artifact", "underground", "deep"].includes(tag));
  if (desire === "order") return tags.some((tag) => ["order", "patrol", "defense", "fortify", "politics"].includes(tag));
  if (desire === "wealth") return tags.some((tag) => ["wealth", "mine", "loot", "reward", "relic"].includes(tag));
  if (desire === "travel") return tags.some((tag) => ["travel", "route", "escort", "sky"].includes(tag));
  if (desire === "protection") return tags.some((tag) => ["protection", "defense", "guard", "fortify", "rest"].includes(tag));
  return tags.some((tag) => ["dominion", "claim", "victory", "politics", "fortify"].includes(tag));
}

function appeaseEquippedItems(world: World, person: Person, tags: string[], label: string, amount: number): void {
  for (const item of equippedItems(person)) {
    if (!item.sentience || !desireMatches(item.sentience.desire, tags)) {
      continue;
    }
    item.sentience.hunger = clamp(item.sentience.hunger - amount * 1.8, 0, 100);
    item.sentience.mood = clamp(item.sentience.mood + amount, -100, 100);
    item.sentience.loyalty = clamp(item.sentience.loyalty + Math.ceil(amount / 3), -100, 100);
    item.sentience.lastAppeasedTick = world.tick;
    rememberItem(item, world.tick, label, amount, tags);
  }
}

function updateSentientItems(world: World, rng: Rng): void {
  if (world.tick % ticksPerDay !== 0) {
    return;
  }

  for (const person of Object.values(world.persons)) {
    if (!person.alive) {
      continue;
    }
    person.inventory = person.inventory.map((item) => ensureItem(item, rng));
    for (const item of equippedItems(person)) {
      if (!item.sentience) {
        continue;
      }
      const sentience = item.sentience;
      const neglectedTicks = world.tick - sentience.lastAppeasedTick;
      sentience.hunger = clamp(sentience.hunger + (sentience.desire === "bloodshed" || sentience.desire === "dominion" ? 3 : 2), 0, 100);
      if (neglectedTicks > ticksPerDay * 4) {
        sentience.mood = clamp(sentience.mood - rng.int(1, 4), -100, 100);
        sentience.loyalty = clamp(sentience.loyalty - rng.int(0, 2), -100, 100);
      }

      const cursePressure = sentience.hunger + sentience.willpower * 0.35 - sentience.loyalty * 0.25 - sentience.mood * 0.2;
      if (cursePressure > 88 && rng.chance(clamp(cursePressure / 360, 0.04, 0.32))) {
        item.cursed = true;
        person.status = [...new Set([...person.status, "item-cursed"])];
        person.morale = clamp(person.morale - rng.int(2, 8), 0, 100);
        person.fatigue = clamp(person.fatigue + rng.int(1, 5), 0, 100);
        rememberItem(item, world.tick, `Punished ${person.name} for neglect`, -8, ["curse", sentience.desire]);
        event(world, "inventory", "medium", `${item.name} turns its will against ${person.name}; it hungers for ${sentience.desire}.`, [person.id], [person.factionId], person.locationId);
        continue;
      }

      if (sentience.loyalty > 32 && sentience.mood > 18 && rng.chance(0.08)) {
        person.morale = clamp(person.morale + rng.int(2, 6), 0, 100);
        person.mana = clamp(person.mana + rng.int(1, 5), 0, person.maxMana);
        rememberItem(item, world.tick, `Aided ${person.name}`, 5, ["aid", sentience.desire]);
        event(world, "inventory", "low", `${item.name} stirs in sympathy with ${person.name}.`, [person.id], [person.factionId], person.locationId);
      }
    }
  }
}

function decayBlessings(world: World): void {
  for (const [personId, ticks] of Object.entries(world.deity.blessingByPersonId)) {
    const person = world.persons[personId];
    if (!person) {
      delete world.deity.blessingByPersonId[personId];
      continue;
    }
    const next = ticks - 1;
    if (next <= 0) {
      person.status = person.status.filter((status) => status !== "blessed");
      delete world.deity.blessingByPersonId[personId];
      event(world, "divine", "low", `The blessing fades from ${person.name} ${person.familyName}.`, [person.id]);
    } else {
      world.deity.blessingByPersonId[personId] = next;
    }
  }
}

export function tickWorld(world: World, steps = 1): World {
  const rng = new Rng(world.rngState);
  for (let step = 0; step < steps; step += 1) {
    world.tick += 1;
    world.day = Math.floor(world.tick / ticksPerDay) + 1;
    updateLingeringEffects(world);
    decayBlessings(world);
    updateSentientItems(world, rng);
    updatePowerResources(world);
    updateAugmentations(world);
    updateCultures(world, rng);
    tickInfluenceState(world, rng);
    updateStoryEngine(world, rng);
    updateQuestPressure(world, rng);
    updateWeather(world, rng, ticksPerDay);
    updateSettlements(world, rng);
    updateTerrainHoldings(world, rng);
    updateSettlementDevelopmentLane(world);
    updateFactionPolitics(world, rng);
    updateTerritories(world, rng, ticksPerDay);
    maybeScheduleDeterministicWorldEvent(world, rng);
    tickSpecialWorldEvents(world, rng);
    updateConditionPressure(world);
    updateQuestNeedLane(world, {
      intervalTicks: ticksPerDay * 2,
      maxCreated: 1,
      maxOpenQuests: 18,
      maxOpenPerLocation: 3,
      emitEvents: true
    });
    updateOrganizationPressureQuests(world);
    updateTradeServicePressure(world);
    spawnOccasionalQuest(world, rng);
    if (world.tick % ticksPerDay === 0) {
      advanceAges(world);
      updateOrphansAndWards(world, rng);
      maybeCreateChild(world, rng);
      educateChildren(world, rng);
    }

    const bands = Object.values(world.bands);
    for (const band of bands) {
      updateQuietBandActivity(world, band, rng);
      updateBand(world, band, rng, band.id === world.deity.favoredBandId);
    }
    updateMeaningfulConversations(world, rng);
    updateRemainsPressure(world);
    updateSocialEmotionalState(world);
  }

  world.rngState = rng.state;
  return world;
}

export function blessPerson(world: World, personId: Id): void {
  const person = world.persons[personId];
  if (!person) {
    return;
  }
  if (!person.alive) {
    event(world, "divine", "medium", `${person.name} ${person.familyName} is beyond this small blessing.`, [person.id]);
    return;
  }
  person.status = [...new Set([...person.status, "blessed"])];
  person.hp = clamp(person.hp + Math.round(person.maxHp * 0.18), 0, person.maxHp);
  person.morale = clamp(person.morale + 12, 0, 100);
  shiftIdentity(person, {
    materialistSpiritualist: 3,
    mightMagic: 2,
    corruptPure: 1
  });
  world.deity.blessingByPersonId[personId] = 18;
  addMemory(person, world, "Felt a watcher turn the knife of fate aside", 8, ["divine", "blessing"]);
  event(world, "divine", "high", `A quiet blessing settles over ${person.name} ${person.familyName}.`, [person.id]);
}

export function setOmen(world: World, omen: QuestKind | "none"): void {
  world.deity.omen = omen;
  const label = omen === "none" ? "no single purpose" : `${questKindLabels[omen].toLowerCase()} work`;
  event(world, "divine", "medium", `Your omen bends rumor toward ${label}.`, [], []);
}

export function setFavoredBand(world: World, bandId: Id): void {
  const band = world.bands[bandId];
  if (!band) {
    return;
  }
  world.deity.favoredBandId = band.id;
  world.selectedBandId = band.id;
  world.selectedPersonId = band.leaderId;
  if (!world.deity.watchedPersonIds.includes(band.leaderId)) {
    world.deity.watchedPersonIds.unshift(band.leaderId);
  }
  event(world, "divine", "medium", `Your gaze moves to ${band.name}.`, [band.leaderId]);
}

export function toggleWatchedPerson(world: World, personId: Id): void {
  if (world.deity.watchedPersonIds.includes(personId)) {
    world.deity.watchedPersonIds = world.deity.watchedPersonIds.filter((id) => id !== personId);
  } else {
    world.deity.watchedPersonIds.unshift(personId);
    world.deity.watchedPersonIds = world.deity.watchedPersonIds.slice(0, 8);
  }
}

export function repairLoadedWorld(value: unknown): World | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const maybeWorld = value as Partial<World>;
  if (maybeWorld.version !== 1 || !maybeWorld.persons || !maybeWorld.bands || !maybeWorld.factions || !maybeWorld.settlements) {
    return undefined;
  }
  maybeWorld.doctrine = { ...defaultDoctrine(), ...maybeWorld.doctrine };
  maybeWorld.cultures ??= {};
  maybeWorld.lastDecisionScores ??= [];
  maybeWorld.events ??= [];
  maybeWorld.territories ??= {};
  maybeWorld.generation = normalizeWorldGenConfig(maybeWorld.generation);
  maybeWorld.geography ??= { continents: [], oceans: [], sectors: {}, tiles: {} };
  maybeWorld.lingeringEffects ??= {};
  maybeWorld.specialEvents ??= {};
  maybeWorld.encounterPressure ??= {};
  maybeWorld.remains ??= {};
  maybeWorld.deity ??= {
    favoredBandId: Object.keys(maybeWorld.bands)[0] ?? "",
    watchedPersonIds: [],
    omen: "none",
    blessingByPersonId: {}
  };
  maybeWorld.selectedBandId ||= maybeWorld.deity.favoredBandId;
  maybeWorld.selectedPersonId ||= maybeWorld.bands[maybeWorld.selectedBandId]?.leaderId ?? Object.keys(maybeWorld.persons)[0] ?? "";
  const repaired = maybeWorld as World;
  const rng = new Rng(repaired.rngState || hashSeed(repaired.seedName || "repaired-frontier"));
  ensureWorldPhase(repaired);
  ensureCultures(repaired, rng);
  for (const person of Object.values(repaired.persons)) {
    ensureStats(person, rng);
    ensureIdentityAxes(person, rng);
    ensureAbilityIds(person, rng);
    person.birthCultureId ||= person.cultureId || repaired.factions[person.factionId]?.cultureId || "";
    person.heritageCultureIds = [...new Set([...(person.heritageCultureIds ?? []), person.birthCultureId, person.cultureId].filter(Boolean))];
    person.cultureBlend = Number.isFinite(person.cultureBlend) ? clamp(person.cultureBlend, 0, 100) : 0;
    person.adoptionStatus ??= "birth-family";
    person.guardianIds = (person.guardianIds ?? []).filter((id) => Boolean(repaired.persons[id]));
    person.ancestry = validAncestry(person.ancestry);
    person.ancestryLineage = [...new Set([person.ancestry, ...(person.ancestryLineage ?? []).map(validAncestry)])];
    ensureRecipeKnowledge(person, rng, cultureForPerson(repaired, person));
    person.inventory = (person.inventory ?? []).map((item) => ensureItem(item, rng));
    person.equipment ??= {};
    if (person.equipment.weapon) person.equipment.weapon = ensureItem(person.equipment.weapon, rng);
    if (person.equipment.armor) person.equipment.armor = ensureItem(person.equipment.armor, rng);
    if (person.equipment.trinket) person.equipment.trinket = ensureItem(person.equipment.trinket, rng);
    ensureSocialMind(person, rng, repaired.tick);
  }
  ensureCultures(repaired, rng);
  ensureLineage(repaired);
  ensureOrganizationEconomy(repaired, { seedDefaults: true });
  for (const settlement of Object.values(repaired.settlements)) {
    settlement.biomeId ??= biomeForRegion(settlement.region, rng);
    const biome = biomeProfiles[settlement.biomeId];
    settlement.terrain ??= biome?.terrain ?? terrainForRegion(settlement.region, rng);
    settlement.mediumRegionId ??= makeId("region", Math.max(0, regions.indexOf(settlement.region)));
    settlement.resources ??= (biome?.resources ?? biomeProfiles.sunmeadow.resources).slice(0, 3);
    settlement.localThreats ??= (biome?.threats ?? biomeProfiles.sunmeadow.threats).slice(0, 3);
    ensureSettlementEnvironment(settlement, rng);
  }
  ensureGeography(repaired, rng);
  const existingRoutes = Object.values(repaired.planet?.routes ?? {});
  const existingRegions = Object.values(repaired.planet?.regions ?? {});
  const needsPlanetRepair =
    !repaired.planet?.routes ||
    !repaired.planet.biomes ||
    !repaired.planet.features ||
    !repaired.planet.holdings ||
    existingRoutes.some((route) => !route.topography || !Number.isFinite(route.passDifficulty)) ||
    existingRegions.some((region) => !region.topography || !Number.isFinite(region.elevationAvg));
  repaired.planet = needsPlanetRepair ? createPlanetMedium(repaired, rng) : repaired.planet;
  repaired.planet.biomes = biomeProfiles;
  repaired.planet.features ??= {};
  repaired.planet.holdings ??= {};
  if (Object.keys(repaired.planet.features).length === 0) {
    repaired.planet = createPlanetMedium(repaired, rng);
    repaired.planet.biomes = biomeProfiles;
  }
  ensureSettlementDevelopment(repaired);
  ensureStoryState(repaired, rng);
  ensureTerritoriesAndWeather(repaired, rng);
  for (const band of Object.values(repaired.bands)) {
    if (band.travel && !repaired.planet.routes[band.travel.routeId]) {
      band.travel = undefined;
    }
  }
  updateSocialEmotionalState(repaired);
  return repaired;
}

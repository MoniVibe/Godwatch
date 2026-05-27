import { event } from "../chronicle/events";
import { average, clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import type { Faction, Id, MediumRegion, SeasonKind, Territory, WeatherFront, WeatherKind, WeatherSystem, World } from "../types";

const seasonOrder: SeasonKind[] = ["spring", "summer", "autumn", "winter"];

const weatherEffects: Record<WeatherKind, Omit<WeatherFront, "id" | "regionId" | "kind" | "intensity" | "remainingTicks">> = {
  clear: { travelPenalty: 0, threatModifier: -1, resourceModifier: 1, tags: ["clear"] },
  rain: { travelPenalty: 8, threatModifier: 1, resourceModifier: 3, tags: ["wet", "growth"] },
  storm: { travelPenalty: 22, threatModifier: 7, resourceModifier: -2, tags: ["storm", "danger"] },
  fog: { travelPenalty: 14, threatModifier: 4, resourceModifier: 0, tags: ["fog", "ambush"] },
  heatwave: { travelPenalty: 16, threatModifier: 5, resourceModifier: -4, tags: ["heat", "scarcity"] },
  snow: { travelPenalty: 26, threatModifier: 6, resourceModifier: -3, tags: ["cold", "blocked"] },
  ashfall: { travelPenalty: 20, threatModifier: 8, resourceModifier: -5, tags: ["ash", "corruption"] },
  "aether-wind": { travelPenalty: 18, threatModifier: 6, resourceModifier: 2, tags: ["aether", "magic"] }
};

function territoryIdForFaction(factionId: Id): Id {
  return `territory-${factionId}`;
}

function currentSeason(day: number): SeasonKind {
  return seasonOrder[Math.floor(Math.max(0, day - 1) / 30) % seasonOrder.length];
}

function settlementIdsForFaction(world: World, factionId: Id): Id[] {
  return Object.values(world.settlements)
    .filter((settlement) => settlement.factionId === factionId)
    .map((settlement) => settlement.id);
}

function neighboringFactionPressure(world: World, faction: Faction, settlementIds: Set<Id>): { contestedBy: Record<Id, number>; borderSettlementIds: Id[] } {
  const contestedBy: Record<Id, number> = {};
  const borderSettlementIds = new Set<Id>();
  for (const route of Object.values(world.planet.routes)) {
    const fromOwned = settlementIds.has(route.fromId);
    const toOwned = settlementIds.has(route.toId);
    if (fromOwned === toOwned) {
      continue;
    }
    const ownSettlement = world.settlements[fromOwned ? route.fromId : route.toId];
    const otherSettlement = world.settlements[fromOwned ? route.toId : route.fromId];
    if (!ownSettlement || !otherSettlement || otherSettlement.factionId === faction.id) {
      continue;
    }
    borderSettlementIds.add(ownSettlement.id);
    const relation = faction.relations[otherSettlement.factionId] ?? 0;
    const war = faction.activeWars.includes(otherSettlement.factionId) ? 34 : 0;
    const pressure = clamp(Math.round(route.danger * 0.2 + route.passDifficulty * 0.12 + Math.max(0, -relation) * 0.45 + war), 0, 100);
    contestedBy[otherSettlement.factionId] = clamp((contestedBy[otherSettlement.factionId] ?? 0) + pressure, 0, 100);
  }
  return { contestedBy, borderSettlementIds: [...borderSettlementIds] };
}

function buildTerritory(world: World, faction: Faction): Territory {
  const settlementIds = settlementIdsForFaction(world, faction.id);
  const settlements = settlementIds.map((id) => world.settlements[id]).filter(Boolean);
  const settlementSet = new Set(settlementIds);
  const { contestedBy, borderSettlementIds } = neighboringFactionPressure(world, faction, settlementSet);
  const regionIds = [...new Set(settlements.map((settlement) => settlement.mediumRegionId).filter(Boolean))];
  const claimStrength = clamp(
    Math.round(
      faction.stability * 0.25 +
        faction.military * 0.22 +
        faction.wealth * 0.18 +
        average(settlements.map((settlement) => settlement.defense)) * 0.2 +
        settlementIds.length * 6
    ),
    0,
    100
  );
  const unrest = Math.round(average(settlements.map((settlement) => settlement.unrest)));
  const cohesion = clamp(
    Math.round(faction.stability * 0.46 + average(settlements.map((settlement) => 100 - settlement.unrest)) * 0.28 + claimStrength * 0.26),
    0,
    100
  );
  const borderPressure = Math.round(average(Object.values(contestedBy)));
  const capital = world.settlements[faction.capitalId] ?? settlements[0];
  return {
    id: territoryIdForFaction(faction.id),
    name: `${faction.name} Territory`,
    factionId: faction.id,
    capitalId: capital?.id ?? faction.capitalId,
    settlementIds,
    regionIds,
    borderSettlementIds,
    claimStrength,
    cohesion,
    unrest,
    borderPressure,
    contestedBy,
    tags: [
      faction.kind,
      faction.activeWars.length ? "at-war" : "uneasy",
      claimStrength > 68 ? "strong-claim" : claimStrength < 34 ? "weak-claim" : "held",
      borderPressure > 62 ? "contested-border" : "settled-border"
    ]
  };
}

export function createTerritories(world: World): Record<Id, Territory> {
  return Object.fromEntries(Object.values(world.factions).map((faction) => [territoryIdForFaction(faction.id), buildTerritory(world, faction)]));
}

function weatherOptions(region: MediumRegion, season: SeasonKind): { value: WeatherKind; weight: number }[] {
  const winter = season === "winter" ? 5 : 0;
  const summer = season === "summer" ? 5 : 0;
  const wet = region.terrain === "marsh" || region.terrain === "riverlands" ? 5 : 0;
  const high = region.elevationBand === "high" || region.elevationBand === "alpine" ? 5 : 0;
  return [
    { value: "clear", weight: 3 },
    { value: "rain", weight: 4 + wet + (season === "spring" || season === "autumn" ? 2 : 0) },
    { value: "storm", weight: 2 + wet + high },
    { value: "fog", weight: 2 + wet + (region.biomeId === "blackpine" ? 3 : 0) },
    { value: "heatwave", weight: summer + (region.biomeId === "sunmeadow" ? 3 : 0) },
    { value: "snow", weight: winter + high + (region.elevationBand === "alpine" ? 5 : 0) },
    { value: "ashfall", weight: region.biomeId === "oldRoad" ? 5 : 1 },
    { value: "aether-wind", weight: region.biomeId === "brokenUplands" || region.biomeId === "oldRoad" ? 4 : 1 }
  ];
}

function makeWeatherFront(world: World, rng: Rng, regionId: Id): WeatherFront | undefined {
  const region = world.planet.regions[regionId];
  if (!region) {
    return undefined;
  }
  const kind = rng.weighted(weatherOptions(region, world.weather?.season ?? currentSeason(world.day)));
  if (kind === "clear") {
    return undefined;
  }
  const effect = weatherEffects[kind];
  const intensity = clamp(rng.int(28, 88) + (region.elevationBand === "alpine" ? 8 : 0), 10, 100);
  return {
    id: makeId("weather", world.tick * 1000 + rng.int(1, 999)),
    regionId,
    kind,
    intensity,
    remainingTicks: rng.int(6, 24),
    travelPenalty: Math.round(effect.travelPenalty * (intensity / 100)),
    threatModifier: Math.round(effect.threatModifier * (intensity / 100)),
    resourceModifier: Math.round(effect.resourceModifier * (intensity / 100)),
    tags: [...effect.tags, region.elevationBand, region.terrain]
  };
}

export function createWeatherSystem(world: World, rng: Rng): WeatherSystem {
  const weather: WeatherSystem = {
    season: currentSeason(world.day),
    fronts: {},
    nextSeasonTick: (Math.floor((world.day - 1) / 30) + 1) * 30 * 6
  };
  world.weather = weather;
  const regionIds = Object.keys(world.planet.regions);
  const targetCount = Math.min(regionIds.length, rng.int(1, 3));
  const used = new Set<Id>();
  while (used.size < targetCount && used.size < regionIds.length) {
    const regionId = rng.pick(regionIds.filter((id) => !used.has(id)));
    used.add(regionId);
    const front = makeWeatherFront(world, rng, regionId);
    if (front) {
      weather.fronts[front.id] = front;
    }
  }
  return weather;
}

export function ensureTerritoriesAndWeather(world: World, rng: Rng): void {
  world.territories = createTerritories(world);
  if (!world.weather || !world.weather.fronts) {
    world.weather = createWeatherSystem(world, rng);
  } else {
    world.weather.season ??= currentSeason(world.day);
    world.weather.fronts ??= {};
    world.weather.nextSeasonTick = Number.isFinite(world.weather.nextSeasonTick) ? world.weather.nextSeasonTick : (Math.floor((world.day - 1) / 30) + 1) * 30 * 6;
  }
}

export function updateTerritories(world: World, rng: Rng, ticksPerDay: number): void {
  const previous = world.territories ?? {};
  world.territories = createTerritories(world);
  if (world.tick % ticksPerDay !== 0) {
    return;
  }
  const pressured = Object.values(world.territories).filter((territory) => territory.borderPressure > 64);
  if (!pressured.length || !rng.chance(0.18)) {
    return;
  }
  const territory = rng.pick(pressured);
  const faction = world.factions[territory.factionId];
  const oldPressure = previous[territory.id]?.borderPressure ?? territory.borderPressure;
  if (!faction || territory.borderPressure < oldPressure + 4) {
    return;
  }
  const challengerId = Object.entries(territory.contestedBy).sort((a, b) => b[1] - a[1])[0]?.[0];
  const challenger = challengerId ? world.factions[challengerId] : undefined;
  event(
    world,
    "world",
    "medium",
    `${faction.name}'s border claims harden${challenger ? ` against ${challenger.name}` : ""}. Pressure ${territory.borderPressure}, cohesion ${territory.cohesion}.`,
    [],
    challenger ? [faction.id, challenger.id] : [faction.id],
    territory.borderSettlementIds[0] ?? territory.capitalId
  );
}

export function updateWeather(world: World, rng: Rng, ticksPerDay: number): void {
  if (!world.weather) {
    world.weather = createWeatherSystem(world, rng);
  }
  if (world.tick >= world.weather.nextSeasonTick) {
    world.weather.season = currentSeason(world.day);
    world.weather.nextSeasonTick += 30 * ticksPerDay;
    event(world, "world", "low", `The season turns toward ${world.weather.season}.`);
  }

  for (const front of Object.values(world.weather.fronts)) {
    front.remainingTicks -= 1;
    if (front.remainingTicks <= 0) {
      const region = world.planet.regions[front.regionId];
      delete world.weather.fronts[front.id];
      if (region && front.intensity > 62) {
        event(world, "world", "low", `${front.kind} breaks over ${region.name}.`);
      }
    }
  }

  if (world.tick % ticksPerDay === 0) {
    for (const front of Object.values(world.weather.fronts)) {
      const region = world.planet.regions[front.regionId];
      if (!region) {
        continue;
      }
      for (const settlementId of region.settlementIds) {
        const settlement = world.settlements[settlementId];
        if (!settlement) {
          continue;
        }
        settlement.threat = clamp(settlement.threat + front.threatModifier, 0, 100);
        settlement.prosperity = clamp(settlement.prosperity + front.resourceModifier, 0, 100);
      }
    }
  }

  const regionIds = Object.keys(world.planet.regions);
  const occupiedRegions = new Set(Object.values(world.weather.fronts).map((front) => front.regionId));
  if (regionIds.length && Object.keys(world.weather.fronts).length < 3 && rng.chance(world.tick % ticksPerDay === 0 ? 0.34 : 0.06)) {
    const candidates = regionIds.filter((id) => !occupiedRegions.has(id));
    if (candidates.length) {
      const regionId = rng.pick(candidates);
      const front = makeWeatherFront(world, rng, regionId);
      if (front) {
        world.weather.fronts[front.id] = front;
        const region = world.planet.regions[regionId];
        event(world, "world", front.intensity > 70 ? "medium" : "low", `${front.kind} gathers over ${region.name}.`, [], [], region.settlementIds[0]);
      }
    }
  }
}

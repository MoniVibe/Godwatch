import { biomeProfiles } from "../data/content";
import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type { BiomeKey, ElevationBand, WorldGenConfig, WorldGeography, WorldSector } from "../types";

export interface ClimateBiomeInput {
  config: WorldGenConfig;
  x: number;
  y: number;
  kind: WorldSector["kind"];
  continentDistance: number;
  oceanDistance: number;
  regionName?: string;
  continentHumidity?: number;
  continentTemperature?: number;
  moisture?: number;
  temperature?: number;
  elevationBand?: ElevationBand;
  anchorBiomeId?: BiomeKey;
  neighborBiomeIds?: BiomeKey[];
}

export interface ClimateFactors {
  northness: number;
  southness: number;
  coastality: number;
  continentality: number;
  moisture: number;
  temperature: number;
  elevationScore: number;
}

export interface BiomeCoherencyIssue {
  id: string;
  scope: "sector" | "tile";
  biomeId: BiomeKey;
  reason: string;
}

const biomeKeys = Object.keys(biomeProfiles) as BiomeKey[];
const elevationScores: Record<ElevationBand, number> = {
  low: 0,
  middle: 0.36,
  high: 0.72,
  alpine: 1
};

function addWeight(weights: Record<BiomeKey, number>, biomeId: BiomeKey, amount: number): void {
  weights[biomeId] += amount;
}

function regionNameHints(weights: Record<BiomeKey, number>, regionName: string | undefined): void {
  const region = regionName?.toLowerCase() ?? "";
  if (region.includes("fen") || region.includes("mire") || region.includes("bog")) {
    addWeight(weights, "sableFen", 7);
  }
  if (region.includes("march") || region.includes("river") || region.includes("ford")) {
    addWeight(weights, "lowMarch", 6);
  }
  if (region.includes("blackpine") || region.includes("pine") || region.includes("wood") || region.includes("forest")) {
    addWeight(weights, "blackpine", 5);
  }
  if (region.includes("upland") || region.includes("ridge") || region.includes("mount")) {
    addWeight(weights, "brokenUplands", 7);
  }
  if (region.includes("road") || region.includes("ruin") || region.includes("old")) {
    addWeight(weights, "oldRoad", 6);
  }
}

export function climateFactorsFor(input: ClimateBiomeInput): ClimateFactors {
  const northness = clamp(1 - input.y, 0, 1);
  const southness = clamp(input.y, 0, 1);
  const oceanDistance = Number.isFinite(input.oceanDistance) ? input.oceanDistance : 1.4;
  const coastality =
    input.kind === "ocean"
      ? 1
      : input.kind === "coast"
        ? 0.92
        : input.kind === "island"
          ? 0.78
          : clamp(1 - (oceanDistance - 0.55) / 1.35, 0, 1);
  const continentality =
    input.kind === "continent"
      ? clamp((oceanDistance - 0.72) / 1.55, 0, 1)
      : input.kind === "island"
        ? 0.18
        : input.kind === "coast"
          ? 0.06
          : 0;
  const globalWetness = input.config.climate / 100;
  const localHumidity = (input.continentHumidity ?? input.config.climate) / 100;
  const baseMoisture = input.moisture ?? globalWetness * 0.42 + localHumidity * 0.58 + coastality * 0.24 - continentality * 0.3;
  const elevationScore = input.elevationBand ? elevationScores[input.elevationBand] : 0.24 + continentality * 0.28 + northness * 0.1;
  const baseTemperature =
    input.temperature ??
    (input.continentTemperature ?? 52) / 100 + southness * 0.22 - northness * 0.32 - elevationScore * 0.26 + coastality * 0.04 - continentality * 0.08;
  return {
    northness,
    southness,
    coastality,
    continentality,
    moisture: clamp(baseMoisture, 0, 1),
    temperature: clamp(baseTemperature, 0, 1),
    elevationScore: clamp(elevationScore, 0, 1)
  };
}

export function humidityForClimate(input: ClimateBiomeInput): number {
  return Math.round(clamp(climateFactorsFor(input).moisture * 100, 0, 100));
}

export function temperatureForClimate(input: ClimateBiomeInput): number {
  return Math.round(clamp(climateFactorsFor(input).temperature * 100, 0, 100));
}

export function biomeWeightsForClimate(input: ClimateBiomeInput): { value: BiomeKey; weight: number }[] {
  const factors = climateFactorsFor(input);
  const wet = factors.moisture;
  const dry = 1 - wet;
  const cold = 1 - factors.temperature;
  const warm = factors.temperature;
  const high = factors.elevationScore;
  const low = 1 - high;
  const weights: Record<BiomeKey, number> = {
    sunmeadow: 2.2 + dry * 4.6 + warm * 1.4 + factors.southness * 1.4 + factors.continentality * 1.7 + low * 0.8,
    blackpine: 1.2 + wet * 3.2 + cold * 2.6 + factors.northness * 2.1 + high * 1.1 + factors.coastality * 0.5,
    sableFen: 0.6 + wet * 5.2 + factors.coastality * 2.3 + low * 2.6 - high * 1.8,
    oldRoad: 1.2 + factors.continentality * 1.6 + dry * 1.1 + high * 0.7 + warm * 0.4,
    brokenUplands: 0.7 + high * 5.4 + cold * 1.5 + factors.northness * 1.5 + dry * 1.8 + factors.continentality * 1.6,
    lowMarch: 0.8 + wet * 4.4 + factors.coastality * 3.1 + low * 2.2 + factors.southness * 0.6
  };

  regionNameHints(weights, input.regionName);
  if (input.anchorBiomeId) {
    addWeight(weights, input.anchorBiomeId, 4.8);
  }
  for (const biomeId of input.neighborBiomeIds ?? []) {
    addWeight(weights, biomeId, 1.35);
  }
  for (const biomeId of biomeKeys) {
    const neighborCount = (input.neighborBiomeIds ?? []).filter((neighbor) => neighbor === biomeId).length;
    if (neighborCount >= 2) {
      addWeight(weights, biomeId, neighborCount * 1.15);
    }
  }

  return biomeKeys.map((value) => ({ value, weight: clamp(weights[value], 0.05, 99) }));
}

export function biomeForClimate(input: ClimateBiomeInput, rng: Rng): BiomeKey {
  if (input.kind === "ocean") {
    return "lowMarch";
  }
  return rng.weighted(biomeWeightsForClimate(input));
}

export function elevationBandForClimate(input: ClimateBiomeInput, rng: Rng, biomeId?: BiomeKey): ElevationBand {
  if (input.kind === "ocean") {
    return "low";
  }
  const factors = climateFactorsFor(input);
  const isWetland = biomeId === "sableFen" || biomeId === "lowMarch";
  const isUpland = biomeId === "brokenUplands";
  const isForest = biomeId === "blackpine";
  const uplift = clamp(
    factors.continentality * 0.38 +
      factors.northness * 0.18 +
      (input.continentDistance > 0.72 ? 0.12 : 0) +
      (isUpland ? 0.35 : 0) +
      (isForest ? 0.08 : 0) -
      (isWetland ? 0.28 : 0),
    0,
    1
  );
  const lowland = clamp(factors.coastality * 0.34 + factors.moisture * 0.22 + (isWetland ? 0.36 : 0) - (isUpland ? 0.24 : 0), 0, 1);
  return rng.weighted<ElevationBand>([
    { value: "low", weight: 2.2 + lowland * 6.4 + factors.southness * 0.5 },
    { value: "middle", weight: 3.5 + (1 - Math.abs(uplift - 0.42)) * 2.2 },
    { value: "high", weight: 0.8 + uplift * 5.5 + (1 - factors.temperature) * 1.3 + (isUpland ? 2.6 : 0) },
    { value: "alpine", weight: 0.1 + uplift * 2.5 + (1 - factors.temperature) * 1.8 + factors.northness * 0.8 + (isUpland ? 1.3 : 0) - (isWetland ? 0.6 : 0) }
  ]);
}

export function neighborBiomeIdsForSector(sectors: Record<string, WorldSector>, q: number, r: number): BiomeKey[] {
  const offsets = [
    { q: -1, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: -1 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: 1, r: -1 }
  ];
  const sectorList = Object.values(sectors);
  return offsets
    .map((offset) => sectorList.find((sector) => sector.q === q + offset.q && sector.r === r + offset.r))
    .filter((sector): sector is WorldSector => Boolean(sector && sector.kind !== "ocean"))
    .map((sector) => sector.biomeId);
}

export function tileBiomeForClimate(input: ClimateBiomeInput, sectorBiomeId: BiomeKey, rng: Rng): BiomeKey {
  if (input.kind === "ocean") {
    return "lowMarch";
  }
  return biomeForClimate(
    {
      ...input,
      anchorBiomeId: sectorBiomeId,
      neighborBiomeIds: [sectorBiomeId, ...(input.neighborBiomeIds ?? [])]
    },
    rng
  );
}

export function settlementBiomeForClimate(regionName: string, sector: WorldSector | undefined, config: WorldGenConfig, rng: Rng): BiomeKey {
  if (!sector) {
    return biomeForClimate(
      {
        config,
        x: 0.5,
        y: 0.5,
        kind: "continent",
        continentDistance: 0.5,
        oceanDistance: 1.2,
        regionName
      },
      rng
    );
  }
  return biomeForClimate(
    {
      config,
      x: sector.x,
      y: sector.y,
      kind: sector.kind,
      continentDistance: 0.5,
      oceanDistance: sector.kind === "coast" ? 0.74 : sector.kind === "island" ? 0.86 : sector.kind === "continent" ? 1.35 : 0,
      regionName,
      moisture: sector.humidity / 100,
      temperature: sector.temperature / 100,
      elevationBand: sector.elevationBand,
      anchorBiomeId: sector.biomeId,
      neighborBiomeIds: [sector.biomeId]
    },
    rng
  );
}

function inferredClimateInputForSector(sector: WorldSector, config: WorldGenConfig): ClimateBiomeInput {
  return {
    config,
    x: sector.x,
    y: sector.y,
    kind: sector.kind,
    continentDistance: 0.5,
    oceanDistance: sector.kind === "coast" ? 0.74 : sector.kind === "island" ? 0.86 : sector.kind === "continent" ? 1.35 : 0,
    moisture: sector.humidity / 100,
    temperature: sector.temperature / 100,
    elevationBand: sector.elevationBand
  };
}

function issueForBiome(input: ClimateBiomeInput, biomeId: BiomeKey, scope: "sector" | "tile", id: string): BiomeCoherencyIssue | undefined {
  const factors = climateFactorsFor(input);
  if ((biomeId === "sableFen" || biomeId === "lowMarch") && factors.moisture < 0.34 && factors.coastality < 0.34) {
    return { id, scope, biomeId, reason: "wet biome in dry inland climate" };
  }
  if (biomeId === "blackpine" && factors.moisture < 0.3 && factors.temperature > 0.72) {
    return { id, scope, biomeId, reason: "forest biome in hot dry climate" };
  }
  if (biomeId === "brokenUplands" && input.elevationBand === "low" && factors.continentality < 0.24) {
    return { id, scope, biomeId, reason: "upland biome on low coastal terrain" };
  }
  if (biomeId === "sunmeadow" && factors.moisture > 0.86 && factors.coastality > 0.58) {
    return { id, scope, biomeId, reason: "dry meadow biome in very wet coastal climate" };
  }
  return undefined;
}

export function validateBiomeCoherency(geography: Pick<WorldGeography, "sectors" | "tiles">, config?: WorldGenConfig): BiomeCoherencyIssue[] {
  const activeConfig = config ?? { size: "small", continents: 1, landmass: 58, ocean: 42, climate: 50 };
  const issues: BiomeCoherencyIssue[] = [];
  for (const sector of Object.values(geography.sectors)) {
    const issue = issueForBiome(inferredClimateInputForSector(sector, activeConfig), sector.biomeId, "sector", sector.id);
    if (issue) {
      issues.push(issue);
    }
  }
  for (const tile of Object.values(geography.tiles)) {
    const sector = geography.sectors[tile.sectorId];
    if (!sector) {
      continue;
    }
    const input = {
      ...inferredClimateInputForSector(sector, activeConfig),
      elevationBand: tile.elevationBand,
      anchorBiomeId: sector.biomeId
    };
    const weights = biomeWeightsForClimate(input);
    const strongest = Math.max(...weights.map((weight) => weight.weight));
    const current = weights.find((weight) => weight.value === tile.biomeId)?.weight ?? 0;
    const issue = current < strongest * 0.3 ? issueForBiome(input, tile.biomeId, "tile", tile.id) : undefined;
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}

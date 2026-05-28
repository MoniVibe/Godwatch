import { biomeProfiles } from "../data/content";
import { clamp } from "../core/math";
import { hashSeed } from "../core/rng";
import { climateFactorsFor } from "./climate";
import type { BiomeKey, ElevationBand, Id, Settlement, TerrainKind, TravelRoute, World, WorldGenConfig, WorldGeography, WorldSector, WorldSize } from "../types";

export type PlanetHexKind = WorldSector["kind"];

export interface PlanetHexCoord {
  q: number;
  r: number;
}

export interface PlanetHexTerrain {
  kind: PlanetHexKind;
  biomeId: BiomeKey;
  terrain: TerrainKind;
  elevationBand: ElevationBand;
  humidity: number;
  temperature: number;
}

export interface PlanetHexTile extends PlanetHexCoord, PlanetHexTerrain {
  id: Id;
  x: number;
  y: number;
  radialDistance: number;
  nearestSectorId: Id;
  sampledSectorIds: readonly Id[];
  neighborIds: readonly Id[];
  neighborCoords: readonly PlanetHexCoord[];
  coastMask: number;
  riverMask: number;
  roadMask: number;
  borderMask: number;
  coastDistance: number;
  waterDepth: number;
}

export interface PlanetHexGridSourceSummary {
  sectorCount: number;
  continentCount: number;
  oceanCount: number;
}

export interface PlanetHexGrid {
  radius: number;
  tileCount: number;
  generation: WorldGenConfig;
  source: PlanetHexGridSourceSummary;
  tiles: readonly PlanetHexTile[];
  byId: Readonly<Record<Id, PlanetHexTile>>;
  byCoord: Readonly<Record<string, PlanetHexTile>>;
}

export interface PlanetHexGridOptions {
  radius?: number;
  seedKey?: string;
}

export type PlanetHexWorldSource = Pick<World, "geography" | "generation" | "seedName"> &
  Partial<Pick<World, "planet" | "settlements">>;

interface PlanetHexSectorSample {
  sector: WorldSector;
  distance: number;
  weight: number;
}

interface InfluenceMetrics {
  id?: Id;
  name?: string;
  distance: number;
  influence: number;
  humidity?: number;
  temperature?: number;
}

interface PlanetHexTileDraft extends PlanetHexCoord, PlanetHexTerrain {
  id: Id;
  x: number;
  y: number;
  radialDistance: number;
  nearestSectorId: Id;
  sampledSectorIds: readonly Id[];
  landScore: number;
  oceanScore: number;
  coastScore: number;
  continentInfluence: number;
}

interface PlanetHexTileBase extends PlanetHexCoord, PlanetHexTerrain {
  id: Id;
  x: number;
  y: number;
  radialDistance: number;
  nearestSectorId: Id;
  sampledSectorIds: readonly Id[];
  neighborIds: readonly Id[];
  neighborCoords: readonly PlanetHexCoord[];
}

interface PlanetHexEdgeFields {
  coastMask: number;
  riverMask: number;
  roadMask: number;
  borderMask: number;
  coastDistance: number;
  waterDepth: number;
}

export const DEFAULT_PLANET_HEX_RADIUS = 14;

export const PLANET_HEX_RADIUS_BY_WORLD_SIZE: Record<WorldSize, number> = {
  small: DEFAULT_PLANET_HEX_RADIUS,
  medium: DEFAULT_PLANET_HEX_RADIUS,
  large: 18
};

export const PLANET_HEX_NEIGHBOR_DIRECTIONS: readonly PlanetHexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

const PLANET_HEX_EDGE_BITS = PLANET_HEX_NEIGHBOR_DIRECTIONS.map((_, index) => 1 << index);

const DEFAULT_WORLD_GEN_CONFIG: WorldGenConfig = {
  size: "small",
  continents: 1,
  landmass: 58,
  ocean: 42,
  climate: 50
};

const elevationScores: Record<ElevationBand, number> = {
  low: 0.12,
  middle: 0.42,
  high: 0.72,
  alpine: 0.96
};

const kindLandScores: Record<PlanetHexKind, number> = {
  continent: 1,
  coast: 0.66,
  island: 0.58,
  ocean: 0
};

const kindOceanScores: Record<PlanetHexKind, number> = {
  ocean: 1,
  coast: 0.46,
  island: 0.34,
  continent: 0
};

const kindCoastScores: Record<PlanetHexKind, number> = {
  coast: 1,
  island: 0.52,
  ocean: 0.12,
  continent: 0
};

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function normalizeWorldGenConfig(config: Partial<WorldGenConfig> | undefined): WorldGenConfig {
  const size = config?.size === "medium" || config?.size === "large" ? config.size : DEFAULT_WORLD_GEN_CONFIG.size;
  return {
    size,
    continents: Math.round(clamp(finiteNumber(config?.continents, DEFAULT_WORLD_GEN_CONFIG.continents), 1, 4)),
    landmass: Math.round(clamp(finiteNumber(config?.landmass, DEFAULT_WORLD_GEN_CONFIG.landmass), 20, 90)),
    ocean: Math.round(clamp(finiteNumber(config?.ocean, DEFAULT_WORLD_GEN_CONFIG.ocean), 10, 80)),
    climate: Math.round(clamp(finiteNumber(config?.climate, DEFAULT_WORLD_GEN_CONFIG.climate), 0, 100))
  };
}

function isWorldSource(source: PlanetHexWorldSource | WorldGeography): source is PlanetHexWorldSource {
  return "geography" in source && "generation" in source;
}

function isWorldGenConfig(value: WorldGenConfig | PlanetHexGridOptions | undefined): value is WorldGenConfig {
  return Boolean(value && "size" in value && "landmass" in value && "ocean" in value && "climate" in value);
}

function boundedRadius(radius: number): number {
  return Math.round(clamp(radius, 4, 36));
}

function radiusForConfig(config: WorldGenConfig, options?: PlanetHexGridOptions): number {
  return boundedRadius(options?.radius ?? PLANET_HEX_RADIUS_BY_WORLD_SIZE[config.size] ?? DEFAULT_PLANET_HEX_RADIUS);
}

function coordPart(value: number): string {
  return value < 0 ? `m${Math.abs(value)}` : `${value}`;
}

export function planetHexCoordKey(coord: PlanetHexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function planetHexId(coord: PlanetHexCoord): Id {
  return `planet-hex-q${coordPart(coord.q)}-r${coordPart(coord.r)}`;
}

export function planetHexDistance(left: PlanetHexCoord, right: PlanetHexCoord): number {
  const q = left.q - right.q;
  const r = left.r - right.r;
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function planetHexCoordsForRadius(radius: number): PlanetHexCoord[] {
  const bounded = boundedRadius(radius);
  const coords: PlanetHexCoord[] = [];
  const qLimit = Math.ceil(bounded * 1.18);
  const rLimit = Math.ceil(bounded * 1.18);
  const xScale = Math.sqrt(3) * bounded;
  const yScale = 1.5 * bounded;
  for (let q = -qLimit; q <= qLimit; q += 1) {
    for (let r = -rLimit; r <= rLimit; r += 1) {
      const rawX = Math.sqrt(3) * (q + r / 2);
      const rawY = 1.5 * r;
      if (Math.hypot(rawX / xScale, rawY / yScale) <= 1.015) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

function rounded(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizedPointForCoord(coord: PlanetHexCoord, radius: number): { x: number; y: number; radialDistance: number } {
  if (radius <= 0) {
    return { x: 0.5, y: 0.5, radialDistance: 0 };
  }
  const rawX = Math.sqrt(3) * (coord.q + coord.r / 2);
  const rawY = 1.5 * coord.r;
  const xScale = Math.sqrt(3) * radius;
  const yScale = 1.5 * radius;
  const x = clamp(0.5 + rawX / (2 * xScale), 0, 1);
  const y = clamp(0.5 + rawY / (2 * yScale), 0, 1);
  return {
    x: rounded(x),
    y: rounded(y),
    radialDistance: rounded(clamp(Math.hypot(rawX / xScale, rawY / yScale), 0, 1), 4)
  };
}

function sortedSectors(geography: WorldGeography): WorldSector[] {
  return Object.values(geography.sectors).sort((left, right) => left.id.localeCompare(right.id));
}

function sourceFingerprint(geography: WorldGeography, config: WorldGenConfig): string {
  const sectorSummary = sortedSectors(geography)
    .map((sector) => `${sector.id}:${sector.kind}:${sector.biomeId}:${sector.elevationBand}:${rounded(sector.x, 3)}:${rounded(sector.y, 3)}`)
    .join("|");
  return `${config.size}:${config.continents}:${config.landmass}:${config.ocean}:${config.climate}|${sectorSummary}`;
}

function coherentField(x: number, y: number, seed: number): number {
  const phaseA = ((seed & 0xff) / 255) * Math.PI * 2;
  const phaseB = (((seed >>> 8) & 0xff) / 255) * Math.PI * 2;
  const phaseC = (((seed >>> 16) & 0xff) / 255) * Math.PI * 2;
  const a = Math.sin((x * 2.2 + y * 1.35) * Math.PI * 2 + phaseA);
  const b = Math.cos((x * 4.4 - y * 2.8) * Math.PI * 2 + phaseB);
  const c = Math.sin((x * 1.25 - y * 3.8) * Math.PI * 2 + phaseC);
  return clamp(a * 0.52 + b * 0.31 + c * 0.17, -1, 1);
}

function sectorSamplesFor(sectors: readonly WorldSector[], x: number, y: number): PlanetHexSectorSample[] {
  return sectors
    .map((sector) => {
      const distance = Math.hypot((sector.x - x) * 1.08, sector.y - y);
      return {
        sector,
        distance,
        weight: 1 / (0.004 + distance * distance)
      };
    })
    .sort((left, right) => left.distance - right.distance || left.sector.id.localeCompare(right.sector.id))
    .slice(0, 6);
}

function weightedAverage(samples: readonly PlanetHexSectorSample[], valueFor: (sample: PlanetHexSectorSample) => number, fallback: number): number {
  let total = 0;
  let weightTotal = 0;
  for (const sample of samples) {
    const value = valueFor(sample);
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value * sample.weight;
    weightTotal += sample.weight;
  }
  return weightTotal > 0 ? total / weightTotal : fallback;
}

function dominantSampleValue<T extends string>(
  samples: readonly PlanetHexSectorSample[],
  fallback: T,
  valueFor: (sector: WorldSector) => T,
  weightFor: (sample: PlanetHexSectorSample) => number = (sample) => sample.weight
): T {
  const weights = new Map<T, number>();
  for (const sample of samples) {
    const value = valueFor(sample.sector);
    weights.set(value, (weights.get(value) ?? 0) + weightFor(sample));
  }
  return (
    [...weights.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? fallback
  );
}

function continentMetrics(geography: WorldGeography, x: number, y: number): InfluenceMetrics {
  let best: InfluenceMetrics = { distance: 99, influence: 0 };
  for (const continent of geography.continents) {
    const radius = Math.max(0.001, continent.radius);
    const distance = Math.hypot(continent.x - x, continent.y - y) / radius;
    if (distance < best.distance) {
      best = {
        id: continent.id,
        name: continent.name,
        distance,
        influence: clamp(1 - (distance - 0.14) / 0.96, 0, 1),
        humidity: continent.humidity,
        temperature: continent.temperature
      };
    }
  }
  return best;
}

function oceanMetrics(geography: WorldGeography, x: number, y: number): InfluenceMetrics {
  let best: InfluenceMetrics = { distance: 99, influence: 0 };
  for (const ocean of geography.oceans) {
    const width = Math.max(0.001, ocean.width);
    const height = Math.max(0.001, ocean.height);
    const distance = Math.hypot((ocean.x - x) / width, (ocean.y - y) / height);
    if (distance < best.distance) {
      best = {
        id: ocean.id,
        name: ocean.name,
        distance,
        influence: clamp(1 - (distance - 0.1) / 0.92, 0, 1)
      };
    }
  }
  return best;
}

function isLandKind(kind: PlanetHexKind): boolean {
  return kind !== "ocean";
}

function edgeBit(index: number): number {
  return PLANET_HEX_EDGE_BITS[index] ?? 0;
}

function neighborCoordAt(coord: PlanetHexCoord, directionIndex: number): PlanetHexCoord {
  const direction = PLANET_HEX_NEIGHBOR_DIRECTIONS[directionIndex] ?? PLANET_HEX_NEIGHBOR_DIRECTIONS[0];
  return { q: coord.q + direction.q, r: coord.r + direction.r };
}

function edgeIndexBetween(left: PlanetHexCoord, right: PlanetHexCoord): number {
  const q = right.q - left.q;
  const r = right.r - left.r;
  return PLANET_HEX_NEIGHBOR_DIRECTIONS.findIndex((direction) => direction.q === q && direction.r === r);
}

function sortedSettlements(source: PlanetHexWorldSource | undefined): Settlement[] {
  return Object.values(source?.settlements ?? {}).sort((left, right) => left.id.localeCompare(right.id));
}

function sortedRoutes(source: PlanetHexWorldSource | undefined): TravelRoute[] {
  return Object.values(source?.planet?.routes ?? {}).sort((left, right) => left.id.localeCompare(right.id));
}

function dominantFactionIdForSettlements(settlementIds: readonly Id[], settlements: Readonly<Record<Id, Settlement>> | undefined): Id | undefined {
  if (!settlements) {
    return undefined;
  }
  const scores = new Map<Id, number>();
  for (const settlementId of settlementIds) {
    const settlement = settlements[settlementId];
    if (!settlement?.factionId) {
      continue;
    }
    scores.set(settlement.factionId, (scores.get(settlement.factionId) ?? 0) + Math.max(1, settlement.population));
  }
  return [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function sectorClaimFactionIds(geography: WorldGeography, source: PlanetHexWorldSource | undefined): Readonly<Record<Id, Id>> {
  const claims: Record<Id, Id> = {};
  for (const sector of sortedSectors(geography)) {
    const factionId = dominantFactionIdForSettlements(sector.settlementIds, source?.settlements);
    if (factionId) {
      claims[sector.id] = factionId;
    }
  }
  return claims;
}

function sampledClaimFactionId(tile: PlanetHexTileBase, claimBySectorId: Readonly<Record<Id, Id>>): Id | undefined {
  const scores = new Map<Id, number>();
  const sectorIds = [tile.nearestSectorId, ...tile.sampledSectorIds];
  for (let index = 0; index < sectorIds.length; index += 1) {
    const factionId = claimBySectorId[sectorIds[index]];
    if (!factionId) {
      continue;
    }
    scores.set(factionId, (scores.get(factionId) ?? 0) + (index === 0 ? 3 : 1));
  }
  return [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function coastEdgeMaskFor(tile: PlanetHexTileBase, byCoord: Readonly<Record<string, PlanetHexTileBase>>): number {
  let mask = 0;
  for (let index = 0; index < PLANET_HEX_NEIGHBOR_DIRECTIONS.length; index += 1) {
    const neighbor = byCoord[planetHexCoordKey(neighborCoordAt(tile, index))];
    if (neighbor && isLandKind(tile.kind) !== isLandKind(neighbor.kind)) {
      mask |= edgeBit(index);
    }
  }
  return mask;
}

function borderEdgeMaskFor(
  tile: PlanetHexTileBase,
  byCoord: Readonly<Record<string, PlanetHexTileBase>>,
  claimBySectorId: Readonly<Record<Id, Id>>
): number {
  let mask = 0;
  const tileClaim = sampledClaimFactionId(tile, claimBySectorId);
  for (let index = 0; index < PLANET_HEX_NEIGHBOR_DIRECTIONS.length; index += 1) {
    const neighbor = byCoord[planetHexCoordKey(neighborCoordAt(tile, index))];
    if (!neighbor || !isLandKind(tile.kind) || !isLandKind(neighbor.kind) || tile.nearestSectorId === neighbor.nearestSectorId) {
      continue;
    }
    const neighborClaim = sampledClaimFactionId(neighbor, claimBySectorId);
    // Dense hexes do not carry an owner field yet. Settlement-derived faction claims win when present;
    // otherwise this is an honest sector-boundary mask for the first political/territory pass.
    if (tileClaim && neighborClaim ? tileClaim !== neighborClaim : true) {
      mask |= edgeBit(index);
    }
  }
  return mask;
}

function coastDistancesFor(
  tiles: readonly PlanetHexTileBase[],
  byCoord: Readonly<Record<string, PlanetHexTileBase>>,
  coastMasks: Readonly<Record<Id, number>>
): Readonly<Record<Id, number>> {
  const fallbackDistance = Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
  const distances: Record<Id, number> = {};
  const queue: PlanetHexTileBase[] = [];
  for (const tile of tiles) {
    const isCoastSeed = (coastMasks[tile.id] ?? 0) > 0 || tile.kind === "coast";
    distances[tile.id] = isCoastSeed ? 0 : Number.POSITIVE_INFINITY;
    if (isCoastSeed) {
      queue.push(tile);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const tile = queue[cursor];
    const nextDistance = (distances[tile.id] ?? fallbackDistance) + 1;
    for (const coord of tile.neighborCoords) {
      const neighbor = byCoord[planetHexCoordKey(coord)];
      if (neighbor && nextDistance < (distances[neighbor.id] ?? Number.POSITIVE_INFINITY)) {
        distances[neighbor.id] = nextDistance;
        queue.push(neighbor);
      }
    }
  }

  for (const tile of tiles) {
    if (!Number.isFinite(distances[tile.id])) {
      distances[tile.id] = fallbackDistance;
    }
  }
  return distances;
}

function waterDepthFor(tile: PlanetHexTileBase, coastDistance: number): number {
  if (tile.kind !== "ocean") {
    return 0;
  }
  return rounded(clamp(0.16 + coastDistance * 0.18, 0.16, 1), 4);
}

function nearestTileForPoint(tiles: readonly PlanetHexTileBase[], x: number, y: number): PlanetHexTileBase | undefined {
  let best: PlanetHexTileBase | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const tile of tiles) {
    const distance = Math.hypot((tile.x - x) * 1.08, tile.y - y);
    const landPenalty = isLandKind(tile.kind) ? 0 : 0.035;
    const score = distance + landPenalty;
    if (score < bestScore || (score === bestScore && tile.id.localeCompare(best?.id ?? "") < 0)) {
      best = tile;
      bestScore = score;
    }
  }
  return best;
}

function roundedAxial(q: number, r: number): PlanetHexCoord {
  let roundedQ = Math.round(q);
  let roundedR = Math.round(r);
  let roundedS = Math.round(-q - r);
  const qDiff = Math.abs(roundedQ - q);
  const rDiff = Math.abs(roundedR - r);
  const sDiff = Math.abs(roundedS + q + r);
  if (qDiff > rDiff && qDiff > sDiff) {
    roundedQ = -roundedR - roundedS;
  } else if (rDiff > sDiff) {
    roundedR = -roundedQ - roundedS;
  } else {
    roundedS = -roundedQ - roundedR;
  }
  return { q: roundedQ, r: roundedR };
}

function hexLineCoords(start: PlanetHexCoord, end: PlanetHexCoord): PlanetHexCoord[] {
  const distance = planetHexDistance(start, end);
  if (distance <= 0) {
    return [{ q: start.q, r: start.r }];
  }
  const coords: PlanetHexCoord[] = [];
  for (let step = 0; step <= distance; step += 1) {
    const t = step / distance;
    const coord = roundedAxial(start.q + (end.q - start.q) * t, start.r + (end.r - start.r) * t);
    const previous = coords[coords.length - 1];
    if (!previous || previous.q !== coord.q || previous.r !== coord.r) {
      coords.push(coord);
    }
  }
  return coords;
}

function addRoadEdgeMask(roadMasks: Record<Id, number>, left: PlanetHexTileBase, right: PlanetHexTileBase): void {
  const edgeIndex = edgeIndexBetween(left, right);
  if (edgeIndex < 0) {
    return;
  }
  roadMasks[left.id] = (roadMasks[left.id] ?? 0) | edgeBit(edgeIndex);
  roadMasks[right.id] = (roadMasks[right.id] ?? 0) | edgeBit((edgeIndex + 3) % PLANET_HEX_NEIGHBOR_DIRECTIONS.length);
}

function roadEdgeMasksFor(
  tiles: readonly PlanetHexTileBase[],
  byCoord: Readonly<Record<string, PlanetHexTileBase>>,
  source: PlanetHexWorldSource | undefined
): Readonly<Record<Id, number>> {
  const roadMasks: Record<Id, number> = {};
  const settlements = source?.settlements;
  if (!settlements) {
    return roadMasks;
  }
  const endpointBySettlementId = new Map<Id, PlanetHexTileBase>();
  for (const settlement of sortedSettlements(source)) {
    const tile = nearestTileForPoint(tiles, settlement.x, settlement.y);
    if (tile) {
      endpointBySettlementId.set(settlement.id, tile);
    }
  }

  for (const route of sortedRoutes(source)) {
    if (!settlements[route.fromId] || !settlements[route.toId]) {
      continue;
    }
    const from = endpointBySettlementId.get(route.fromId);
    const to = endpointBySettlementId.get(route.toId);
    if (!from || !to) {
      continue;
    }
    let previous: PlanetHexTileBase | undefined;
    for (const coord of hexLineCoords(from, to)) {
      const tile = byCoord[planetHexCoordKey(coord)];
      if (!tile) {
        continue;
      }
      if (previous && previous.id !== tile.id && isLandKind(previous.kind) && isLandKind(tile.kind)) {
        addRoadEdgeMask(roadMasks, previous, tile);
      }
      previous = tile;
    }
  }
  return roadMasks;
}

function derivePlanetHexEdgeFields(
  tiles: readonly PlanetHexTileBase[],
  byCoord: Readonly<Record<string, PlanetHexTileBase>>,
  geography: WorldGeography,
  source: PlanetHexWorldSource | undefined
): Readonly<Record<Id, PlanetHexEdgeFields>> {
  const claimBySectorId = sectorClaimFactionIds(geography, source);
  const coastMasks: Record<Id, number> = {};
  const borderMasks: Record<Id, number> = {};
  for (const tile of tiles) {
    coastMasks[tile.id] = coastEdgeMaskFor(tile, byCoord);
    borderMasks[tile.id] = borderEdgeMaskFor(tile, byCoord, claimBySectorId);
  }

  const coastDistances = coastDistancesFor(tiles, byCoord, coastMasks);
  const roadMasks = roadEdgeMasksFor(tiles, byCoord, source);
  const fields: Record<Id, PlanetHexEdgeFields> = {};
  for (const tile of tiles) {
    const coastDistance = coastDistances[tile.id] ?? 0;
    fields[tile.id] = {
      coastMask: coastMasks[tile.id] ?? 0,
      riverMask: 0,
      roadMask: roadMasks[tile.id] ?? 0,
      borderMask: borderMasks[tile.id] ?? 0,
      coastDistance,
      waterDepth: waterDepthFor(tile, coastDistance)
    };
  }
  return fields;
}

function kindFromScores(
  nearestKind: PlanetHexKind,
  config: WorldGenConfig,
  landScore: number,
  oceanScore: number,
  coastScore: number,
  continentInfluence: number
): PlanetHexKind {
  const targetLand = config.landmass / 100;
  const landThreshold = clamp(0.58 - (targetLand - 0.5) * 0.26, 0.43, 0.66);
  const nearBoundary = Math.abs(landScore - landThreshold) <= 0.075 + coastScore * 0.04 || (landScore > 0.37 && oceanScore > 0.43);

  if (landScore < landThreshold || oceanScore > landScore + 0.14) {
    if (nearestKind === "island" && landScore > landThreshold - 0.08 && oceanScore < 0.72) {
      return "island";
    }
    return "ocean";
  }

  if (continentInfluence < 0.22 && nearestKind !== "continent") {
    return "island";
  }
  if (nearBoundary || nearestKind === "coast" || oceanScore > 0.44) {
    return "coast";
  }
  return "continent";
}

function elevationBandFromScore(score: number, kind: PlanetHexKind): ElevationBand {
  if (kind === "ocean") {
    return "low";
  }
  if (score < 0.3) {
    return "low";
  }
  if (score < 0.61) {
    return "middle";
  }
  if (score < 0.86) {
    return "high";
  }
  return "alpine";
}

function terrainForKind(kind: PlanetHexKind, biomeId: BiomeKey, fallback: TerrainKind): TerrainKind {
  if (kind === "ocean") {
    return "riverlands";
  }
  return biomeProfiles[biomeId]?.terrain ?? fallback;
}

function biomeForKind(samples: readonly PlanetHexSectorSample[], kind: PlanetHexKind, fallback: BiomeKey): BiomeKey {
  if (kind === "ocean") {
    return "lowMarch";
  }
  const hasLandSamples = samples.some((sample) => sample.sector.kind !== "ocean");
  return dominantSampleValue(
    samples,
    fallback,
    (sector) => sector.biomeId,
    (sample) => {
      if (hasLandSamples && sample.sector.kind === "ocean") {
        return sample.weight * 0.18;
      }
      if (sample.sector.kind === kind) {
        return sample.weight * 1.22;
      }
      return sample.weight;
    }
  );
}

function draftTileForCoord(
  coord: PlanetHexCoord,
  radius: number,
  sectors: readonly WorldSector[],
  geography: WorldGeography,
  config: WorldGenConfig,
  seed: number
): PlanetHexTileDraft {
  const point = normalizedPointForCoord(coord, radius);
  const samples = sectorSamplesFor(sectors, point.x, point.y);
  const nearest = samples[0]?.sector;
  const continent = continentMetrics(geography, point.x, point.y);
  const ocean = oceanMetrics(geography, point.x, point.y);
  const field = coherentField(point.x, point.y, seed);
  const nearestKind = nearest?.kind ?? "ocean";
  const sampleLand = weightedAverage(samples, (sample) => kindLandScores[sample.sector.kind], 0);
  const sampleOcean = weightedAverage(samples, (sample) => kindOceanScores[sample.sector.kind], 1);
  const sampleCoast = weightedAverage(samples, (sample) => kindCoastScores[sample.sector.kind], 0);
  const targetLand = config.landmass / 100;
  const landScore = clamp(sampleLand * 0.58 + continent.influence * 0.34 + targetLand * 0.08 + field * 0.07 - ocean.influence * 0.18, 0, 1);
  const oceanScore = clamp(sampleOcean * 0.64 + ocean.influence * 0.3 + (config.ocean / 100) * 0.06 - continent.influence * 0.14 - field * 0.035, 0, 1);
  const coastScore = clamp(sampleCoast * 0.72 + Math.max(0, 1 - Math.abs(landScore - oceanScore) * 1.6) * 0.28, 0, 1);
  const kind = kindFromScores(nearestKind, config, landScore, oceanScore, coastScore, continent.influence);
  const baseElevation = weightedAverage(samples, (sample) => elevationScores[sample.sector.elevationBand], kind === "ocean" ? 0.08 : 0.42);
  const elevationScore = clamp(
    baseElevation * 0.64 + continent.influence * 0.17 + (landScore - 0.5) * 0.18 + field * 0.09 - oceanScore * 0.22,
    0,
    kind === "coast" || kind === "island" ? 0.72 : 1
  );
  const elevationBand = elevationBandFromScore(elevationScore, kind);
  const fallbackBiome = nearest?.biomeId ?? "lowMarch";
  const biomeId = biomeForKind(samples, kind, fallbackBiome);
  const fallbackTerrain = nearest?.terrain ?? "riverlands";
  const terrain = terrainForKind(kind, biomeId, fallbackTerrain);
  const climateFactors = climateFactorsFor({
    config,
    x: point.x,
    y: point.y,
    kind,
    continentDistance: continent.distance,
    oceanDistance: ocean.distance,
    regionName: continent.name,
    continentHumidity: continent.humidity,
    continentTemperature: continent.temperature,
    elevationBand,
    anchorBiomeId: biomeId,
    neighborBiomeIds: samples.map((sample) => sample.sector.biomeId)
  });
  const sampledHumidity = weightedAverage(samples, (sample) => sample.sector.humidity, config.climate);
  const sampledTemperature = weightedAverage(samples, (sample) => sample.sector.temperature, 52);
  const coastMoistureBoost = kind === "ocean" ? 8 : kind === "coast" || kind === "island" ? 5 : 0;
  const humidity = Math.round(clamp(sampledHumidity * 0.68 + climateFactors.moisture * 100 * 0.32 + coastMoistureBoost - elevationScore * 4, 0, 100));
  const temperature = Math.round(clamp(sampledTemperature * 0.62 + climateFactors.temperature * 100 * 0.38 - elevationScore * 6, 0, 100));

  return {
    id: planetHexId(coord),
    q: coord.q,
    r: coord.r,
    x: point.x,
    y: point.y,
    radialDistance: point.radialDistance,
    kind,
    biomeId,
    terrain,
    elevationBand,
    humidity,
    temperature,
    nearestSectorId: nearest?.id ?? "",
    sampledSectorIds: samples.map((sample) => sample.sector.id),
    landScore: rounded(landScore, 4),
    oceanScore: rounded(oceanScore, 4),
    coastScore: rounded(coastScore, 4),
    continentInfluence: rounded(continent.influence, 4)
  };
}

function neighborCoordsFor(coord: PlanetHexCoord, draftByCoord: Readonly<Record<string, PlanetHexTileDraft>>): PlanetHexCoord[] {
  return PLANET_HEX_NEIGHBOR_DIRECTIONS.map((direction) => ({ q: coord.q + direction.q, r: coord.r + direction.r })).filter(
    (neighbor) => draftByCoord[planetHexCoordKey(neighbor)]
  );
}

function correctedKindFor(draft: PlanetHexTileDraft, neighbors: readonly PlanetHexTileDraft[]): PlanetHexKind {
  const oceanNeighbors = neighbors.filter((neighbor) => neighbor.kind === "ocean").length;
  const landNeighbors = neighbors.filter((neighbor) => isLandKind(neighbor.kind)).length;

  if (draft.kind === "continent" && oceanNeighbors > 0) {
    return "coast";
  }
  if (draft.kind === "coast" && oceanNeighbors === 0 && draft.landScore > 0.76 && draft.continentInfluence > 0.35) {
    return "continent";
  }
  if (draft.kind === "island" && landNeighbors >= 3 && draft.continentInfluence > 0.32) {
    return oceanNeighbors > 0 ? "coast" : "continent";
  }
  if (draft.kind === "ocean" && landNeighbors >= 5 && draft.landScore > draft.oceanScore + 0.18) {
    return "coast";
  }
  return draft.kind;
}

function finalizeTile(draft: PlanetHexTileDraft, draftByCoord: Readonly<Record<string, PlanetHexTileDraft>>): PlanetHexTileBase {
  const neighborCoords = neighborCoordsFor(draft, draftByCoord);
  const neighbors = neighborCoords.map((coord) => draftByCoord[planetHexCoordKey(coord)]).filter((neighbor): neighbor is PlanetHexTileDraft => Boolean(neighbor));
  const kind = correctedKindFor(draft, neighbors);
  const biomeId = kind === "ocean" ? "lowMarch" : draft.biomeId;
  const terrain = terrainForKind(kind, biomeId, draft.terrain);
  return {
    id: draft.id,
    q: draft.q,
    r: draft.r,
    x: draft.x,
    y: draft.y,
    radialDistance: draft.radialDistance,
    kind,
    biomeId,
    terrain,
    elevationBand: kind === "ocean" ? "low" : draft.elevationBand,
    humidity: draft.humidity,
    temperature: draft.temperature,
    nearestSectorId: draft.nearestSectorId,
    sampledSectorIds: draft.sampledSectorIds,
    neighborIds: neighborCoords.map((coord) => planetHexId(coord)),
    neighborCoords
  };
}

export function createPlanetHexGrid(world: PlanetHexWorldSource, options?: PlanetHexGridOptions): PlanetHexGrid;
export function createPlanetHexGrid(geography: WorldGeography, config: WorldGenConfig, options?: PlanetHexGridOptions): PlanetHexGrid;
export function createPlanetHexGrid(
  source: PlanetHexWorldSource | WorldGeography,
  configOrOptions?: WorldGenConfig | PlanetHexGridOptions,
  options: PlanetHexGridOptions = {}
): PlanetHexGrid {
  const worldSource = isWorldSource(source);
  const geography = worldSource ? source.geography : source;
  const config = normalizeWorldGenConfig(worldSource ? source.generation : isWorldGenConfig(configOrOptions) ? configOrOptions : undefined);
  const gridOptions = worldSource ? (isWorldGenConfig(configOrOptions) ? options : configOrOptions) : options;
  const radius = radiusForConfig(config, gridOptions);
  const sectors = sortedSectors(geography);
  const seedKey = gridOptions?.seedKey ?? (worldSource ? source.seedName : undefined) ?? sourceFingerprint(geography, config);
  const seed = hashSeed(seedKey);
  const draftByCoord: Record<string, PlanetHexTileDraft> = {};
  const drafts = planetHexCoordsForRadius(radius).map((coord) => draftTileForCoord(coord, radius, sectors, geography, config, seed));
  for (const draft of drafts) {
    draftByCoord[planetHexCoordKey(draft)] = draft;
  }

  const baseTiles = drafts.map((draft) => finalizeTile(draft, draftByCoord));
  const baseByCoord: Record<string, PlanetHexTileBase> = {};
  for (const tile of baseTiles) {
    baseByCoord[planetHexCoordKey(tile)] = tile;
  }
  const edgeFields = derivePlanetHexEdgeFields(baseTiles, baseByCoord, geography, worldSource ? source : undefined);
  const tiles = baseTiles.map((tile): PlanetHexTile => ({ ...tile, ...edgeFields[tile.id] }));
  const byId: Record<Id, PlanetHexTile> = {};
  const byCoord: Record<string, PlanetHexTile> = {};
  for (const tile of tiles) {
    byId[tile.id] = tile;
    byCoord[planetHexCoordKey(tile)] = tile;
  }

  return {
    radius,
    tileCount: tiles.length,
    generation: { ...config },
    source: {
      sectorCount: sectors.length,
      continentCount: geography.continents.length,
      oceanCount: geography.oceans.length
    },
    tiles,
    byId,
    byCoord
  };
}

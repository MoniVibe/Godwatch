import { clamp } from "../core/math";
import type { Band, Id, LingeringEffect, MediumLayer, Person, RemainsRecord, Settlement, TravelState, World } from "../types";

export type OccupancySubjectKind = "person" | "band" | "remains" | "settlement" | "effect";
export type OccupancyAnchorKind = "settlement" | "tile" | "route" | "coordinate" | "unknown";
export type PositionPrecision = "exact" | "anchored" | "estimated" | "unknown";

export interface WorldCoordinate {
  x: number;
  y: number;
  layer: MediumLayer;
}

export interface EntityPositionSnapshot extends WorldCoordinate {
  id: Id;
  subjectId: Id;
  subjectKind: OccupancySubjectKind;
  name: string;
  anchorKind: OccupancyAnchorKind;
  occupancyKey: string;
  precision: PositionPrecision;
  factionId?: Id;
  bandId?: Id;
  personId?: Id;
  settlementId?: Id;
  sectorId?: Id;
  tileId?: Id;
  routeId?: Id;
  originLocationId?: Id;
  targetLocationId?: Id;
  progress?: number;
  alive?: boolean;
  radius?: number;
  intensity?: number;
  tags: string[];
}

export interface OccupancyBucket extends WorldCoordinate {
  key: string;
  anchorKind: OccupancyAnchorKind;
  label: string;
  settlementId?: Id;
  sectorId?: Id;
  tileId?: Id;
  routeId?: Id;
  originLocationId?: Id;
  targetLocationId?: Id;
  entries: EntityPositionSnapshot[];
  counts: Record<OccupancySubjectKind, number>;
  factionIds: Id[];
  tags: string[];
}

export interface WorldOccupancySnapshot {
  tick: number;
  entries: EntityPositionSnapshot[];
  buckets: OccupancyBucket[];
  bySubjectId: Record<string, EntityPositionSnapshot>;
  byOccupancyKey: Record<string, OccupancyBucket>;
  settlementKeys: Record<Id, string[]>;
  tileKeys: Record<Id, string[]>;
  routeKeys: Record<Id, string[]>;
}

export interface OccupancyOptions {
  includeSettlements?: boolean;
  includePersons?: boolean;
  includeDeadPersons?: boolean;
  includeBands?: boolean;
  includeRemains?: boolean;
  includeEffects?: boolean;
  includeExpiredEffects?: boolean;
  localTileDrift?: number;
  coordinateBucketSize?: number;
  maxEntries?: number;
}

const defaultCoordinateBucketSize = 0.025;
const tileOffsetXQ = 0.018;
const tileOffsetXR = 0.009;
const tileOffsetYR = 0.022;

function stableSubjectId(kind: OccupancySubjectKind, id: Id): Id {
  return `${kind}:${id}`;
}

function subjectLookupKey(kind: OccupancySubjectKind, id: Id): string {
  return `${kind}:${id}`;
}

function normalized(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0.5, 0, 1);
}

function roundedCoordinate(value: number, bucketSize: number): number {
  const size = Math.max(0.001, bucketSize);
  return Math.round(normalized(value) / size) * size;
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function personName(person: Person): string {
  return `${person.name} ${person.familyName}`.trim();
}

function routeProgress(travel: TravelState): number {
  return travel.total > 0 ? clamp(travel.progress / travel.total, 0, 1) : 0;
}

function settlementCoordinate(settlement: Settlement, layer: MediumLayer = "surface"): WorldCoordinate {
  return { x: normalized(settlement.x), y: normalized(settlement.y), layer };
}

function routeCoordinate(world: World, routeId: Id, progress: number, fallback?: Pick<TravelState, "originId" | "destinationId">): WorldCoordinate | undefined {
  const route = world.planet.routes[routeId];
  const originId = fallback?.originId ?? route?.fromId;
  const destinationId = fallback?.destinationId ?? route?.toId;
  const origin = originId ? world.settlements[originId] : undefined;
  const destination = destinationId ? world.settlements[destinationId] : undefined;
  if (!origin || !destination) {
    return undefined;
  }
  const t = clamp(progress, 0, 1);
  return {
    x: normalized(origin.x + (destination.x - origin.x) * t),
    y: normalized(origin.y + (destination.y - origin.y) * t),
    layer: "surface"
  };
}

function tileCoordinate(world: World, tileId: Id, layerOverride?: MediumLayer): (WorldCoordinate & { sectorId?: Id }) | undefined {
  const tile = world.geography?.tiles?.[tileId];
  const sector = tile ? world.geography?.sectors?.[tile.sectorId] : undefined;
  if (!tile || !sector) {
    return undefined;
  }
  return {
    x: normalized(sector.x + tile.q * tileOffsetXQ + tile.r * tileOffsetXR),
    y: normalized(sector.y + tile.r * tileOffsetYR),
    layer: layerOverride ?? tile.layer,
    sectorId: sector.id
  };
}

function nearestTileId(world: World, x: number, y: number, layer?: MediumLayer, sectorId?: Id): Id | undefined {
  const tiles = Object.values(world.geography?.tiles ?? {}).filter((tile) => (!sectorId || tile.sectorId === sectorId) && (!layer || tile.layer === layer));
  let nearest: { id: Id; distance: number } | undefined;
  for (const tile of tiles) {
    const coordinate = tileCoordinate(world, tile.id);
    if (!coordinate) {
      continue;
    }
    const distance = Math.hypot(coordinate.x - x, coordinate.y - y);
    if (!nearest || distance < nearest.distance) {
      nearest = { id: tile.id, distance };
    }
  }
  return nearest?.id;
}

function coordinateOccupancyKey(coordinate: WorldCoordinate, options: OccupancyOptions): string {
  const bucketSize = options.coordinateBucketSize ?? defaultCoordinateBucketSize;
  const x = roundedCoordinate(coordinate.x, bucketSize).toFixed(3);
  const y = roundedCoordinate(coordinate.y, bucketSize).toFixed(3);
  return `coordinate:${coordinate.layer}:${x}:${y}`;
}

function occupancyKeyFor(anchorKind: OccupancyAnchorKind, layer: MediumLayer, id?: Id, coordinate?: WorldCoordinate, options: OccupancyOptions = {}): string {
  if (anchorKind === "settlement" && id) return `settlement:${layer}:${id}`;
  if (anchorKind === "tile" && id) return `tile:${layer}:${id}`;
  if (anchorKind === "route" && id) return `route:${layer}:${id}`;
  if (coordinate) return coordinateOccupancyKey(coordinate, options);
  return `unknown:${layer}`;
}

function positionFromSettlement(world: World, settlementId: Id, layer: MediumLayer = "surface"): (WorldCoordinate & { settlement: Settlement }) | undefined {
  const settlement = world.settlements[settlementId];
  return settlement ? { ...settlementCoordinate(settlement, layer), settlement } : undefined;
}

function bandTilePosition(world: World, band: Band, options: OccupancyOptions): EntityPositionSnapshot | undefined {
  if (!band.localTileId) {
    return undefined;
  }
  const tilePosition = tileCoordinate(world, band.localTileId);
  if (!tilePosition) {
    return undefined;
  }
  const settlement = world.settlements[band.locationId];
  const drift = clamp(options.localTileDrift ?? 0.35, 0, 1);
  const progress = clamp(band.localTileProgress ?? 0, 0, 1);
  const anchor = settlement ? settlementCoordinate(settlement, tilePosition.layer) : tilePosition;
  const x = normalized(anchor.x + (tilePosition.x - anchor.x) * Math.max(drift, progress));
  const y = normalized(anchor.y + (tilePosition.y - anchor.y) * Math.max(drift, progress));
  return {
    id: stableSubjectId("band", band.id),
    subjectId: band.id,
    subjectKind: "band",
    name: band.name,
    anchorKind: "tile",
    occupancyKey: occupancyKeyFor("tile", tilePosition.layer, band.localTileId, tilePosition, options),
    precision: "estimated",
    factionId: settlement?.factionId,
    settlementId: settlement?.id ?? band.locationId,
    sectorId: tilePosition.sectorId,
    tileId: band.localTileId,
    progress,
    x,
    y,
    layer: tilePosition.layer,
    tags: uniqueText(["band", "local-tile", band.purpose, settlement?.biomeId])
  };
}

export function deriveSettlementPosition(world: World, settlement: Settlement, options: OccupancyOptions = {}): EntityPositionSnapshot {
  const coordinate = settlementCoordinate(settlement);
  const sector = world.geography?.sectors?.[settlement.sectorId];
  return {
    id: stableSubjectId("settlement", settlement.id),
    subjectId: settlement.id,
    subjectKind: "settlement",
    name: settlement.name,
    anchorKind: "settlement",
    occupancyKey: occupancyKeyFor("settlement", coordinate.layer, settlement.id, coordinate, options),
    precision: "exact",
    factionId: settlement.factionId,
    settlementId: settlement.id,
    sectorId: settlement.sectorId,
    x: coordinate.x,
    y: coordinate.y,
    layer: coordinate.layer,
    radius: clamp(settlement.population / 500, 0.04, 0.16),
    intensity: clamp((settlement.population + settlement.defense + settlement.prosperity) / 4, 0, 100),
    tags: uniqueText(["settlement", settlement.biomeId, settlement.terrain, settlement.topography, settlement.elevationBand, sector?.kind, ...settlement.tags])
  };
}

export function deriveBandPosition(world: World, band: Band, options: OccupancyOptions = {}): EntityPositionSnapshot | undefined {
  if (band.travel) {
    const progress = routeProgress(band.travel);
    const coordinate = routeCoordinate(world, band.travel.routeId, progress, band.travel);
    if (coordinate) {
      return {
        id: stableSubjectId("band", band.id),
        subjectId: band.id,
        subjectKind: "band",
        name: band.name,
        anchorKind: "route",
        occupancyKey: occupancyKeyFor("route", coordinate.layer, band.travel.routeId, coordinate, options),
        precision: "estimated",
        settlementId: band.locationId,
        routeId: band.travel.routeId,
        originLocationId: band.travel.originId,
        targetLocationId: band.travel.destinationId,
        progress,
        x: coordinate.x,
        y: coordinate.y,
        layer: coordinate.layer,
        tags: uniqueText(["band", "traveling", band.purpose, band.travel.purpose])
      };
    }
  }

  const tilePosition = bandTilePosition(world, band, options);
  if (tilePosition) {
    return tilePosition;
  }

  const settled = positionFromSettlement(world, band.locationId);
  if (!settled) {
    return undefined;
  }
  return {
    id: stableSubjectId("band", band.id),
    subjectId: band.id,
    subjectKind: "band",
    name: band.name,
    anchorKind: "settlement",
    occupancyKey: occupancyKeyFor("settlement", settled.layer, settled.settlement.id, settled, options),
    precision: "anchored",
    factionId: settled.settlement.factionId,
    settlementId: settled.settlement.id,
    sectorId: settled.settlement.sectorId,
    x: settled.x,
    y: settled.y,
    layer: settled.layer,
    tags: uniqueText(["band", "settled", band.purpose, settled.settlement.biomeId])
  };
}

export function derivePersonPosition(world: World, person: Person, options: OccupancyOptions = {}): EntityPositionSnapshot | undefined {
  if (!person.alive && !(options.includeDeadPersons ?? false)) {
    return undefined;
  }

  const band = person.bandId ? world.bands[person.bandId] : undefined;
  const bandPosition = band ? deriveBandPosition(world, band, options) : undefined;
  if (bandPosition) {
    return {
      ...bandPosition,
      id: stableSubjectId("person", person.id),
      subjectId: person.id,
      subjectKind: "person",
      name: personName(person),
      factionId: person.factionId,
      bandId: person.bandId,
      personId: person.id,
      alive: person.alive,
      tags: uniqueText(["person", person.role, person.archetype, person.ancestry, ...person.status, ...bandPosition.tags])
    };
  }

  const settled = positionFromSettlement(world, person.locationId);
  if (!settled) {
    return undefined;
  }
  return {
    id: stableSubjectId("person", person.id),
    subjectId: person.id,
    subjectKind: "person",
    name: personName(person),
    anchorKind: "settlement",
    occupancyKey: occupancyKeyFor("settlement", settled.layer, settled.settlement.id, settled, options),
    precision: person.alive ? "anchored" : "unknown",
    factionId: person.factionId,
    personId: person.id,
    settlementId: settled.settlement.id,
    sectorId: settled.settlement.sectorId,
    x: settled.x,
    y: settled.y,
    layer: settled.layer,
    alive: person.alive,
    tags: uniqueText(["person", person.role, person.archetype, person.ancestry, ...person.status, settled.settlement.biomeId])
  };
}

export function deriveRemainsPosition(world: World, remains: RemainsRecord, options: OccupancyOptions = {}): EntityPositionSnapshot | undefined {
  const burialLocationId = remains.burialStatus === "buried" ? remains.burialLocationId : undefined;
  const locationId = burialLocationId ?? remains.locationId;
  const settled = locationId ? positionFromSettlement(world, locationId) : undefined;
  const layer: MediumLayer = remains.tags.includes("underground") ? "underground" : "surface";
  const coordinate: WorldCoordinate | undefined =
    remains.x !== undefined && remains.y !== undefined ? { x: normalized(remains.x), y: normalized(remains.y), layer } : settled ? { x: settled.x, y: settled.y, layer } : undefined;
  if (!coordinate) {
    return undefined;
  }
  const nearestTile = nearestTileId(world, coordinate.x, coordinate.y, layer, settled?.settlement.sectorId);
  const anchorKind: OccupancyAnchorKind = settled ? "settlement" : nearestTile ? "tile" : "coordinate";
  const occupancyKey =
    anchorKind === "settlement"
      ? occupancyKeyFor("settlement", layer, settled?.settlement.id, coordinate, options)
      : anchorKind === "tile"
        ? occupancyKeyFor("tile", layer, nearestTile, coordinate, options)
        : occupancyKeyFor("coordinate", layer, undefined, coordinate, options);
  return {
    id: stableSubjectId("remains", remains.id),
    subjectId: remains.id,
    subjectKind: "remains",
    name: remains.personName,
    anchorKind,
    occupancyKey,
    precision: remains.x !== undefined && remains.y !== undefined ? "exact" : "anchored",
    factionId: remains.factionId,
    personId: remains.personId,
    settlementId: settled?.settlement.id ?? remains.locationId,
    sectorId: settled?.settlement.sectorId,
    tileId: nearestTile,
    x: coordinate.x,
    y: coordinate.y,
    layer: coordinate.layer,
    intensity: remains.retrievalPriority,
    tags: uniqueText(["remains", remains.kind, remains.claimStatus, remains.burialStatus, remains.hauntingStatus, ...remains.tags])
  };
}

export function deriveEffectPosition(world: World, effect: LingeringEffect, options: OccupancyOptions = {}): EntityPositionSnapshot | undefined {
  if (effect.remainingTicks <= 0 && !(options.includeExpiredEffects ?? false)) {
    return undefined;
  }
  const coordinate = { x: normalized(effect.x), y: normalized(effect.y), layer: effect.layer };
  const settlement = effect.locationId ? world.settlements[effect.locationId] : undefined;
  const tileId = !effect.routeId && !settlement ? nearestTileId(world, coordinate.x, coordinate.y, coordinate.layer) : undefined;
  const anchorKind: OccupancyAnchorKind = effect.routeId ? "route" : settlement ? "settlement" : tileId ? "tile" : "coordinate";
  const occupancyKey =
    anchorKind === "route"
      ? occupancyKeyFor("route", coordinate.layer, effect.routeId, coordinate, options)
      : anchorKind === "settlement"
        ? occupancyKeyFor("settlement", coordinate.layer, settlement?.id, coordinate, options)
        : anchorKind === "tile"
          ? occupancyKeyFor("tile", coordinate.layer, tileId, coordinate, options)
          : occupancyKeyFor("coordinate", coordinate.layer, undefined, coordinate, options);
  return {
    id: stableSubjectId("effect", effect.id),
    subjectId: effect.id,
    subjectKind: "effect",
    name: effect.name,
    anchorKind,
    occupancyKey,
    precision: "exact",
    factionId: effect.factionIds[0],
    settlementId: settlement?.id ?? effect.locationId,
    sectorId: settlement?.sectorId,
    tileId,
    routeId: effect.routeId,
    originLocationId: effect.originLocationId,
    targetLocationId: effect.targetLocationId,
    progress: effect.progress,
    x: coordinate.x,
    y: coordinate.y,
    layer: coordinate.layer,
    radius: effect.radius,
    intensity: effect.intensity,
    tags: uniqueText(["effect", effect.kind, ...effect.tags])
  };
}

export function collectPositionSnapshots(world: World, options: OccupancyOptions = {}): EntityPositionSnapshot[] {
  const entries: EntityPositionSnapshot[] = [];
  if (options.includeSettlements ?? true) {
    entries.push(...Object.values(world.settlements).map((settlement) => deriveSettlementPosition(world, settlement, options)));
  }
  if (options.includeBands ?? true) {
    entries.push(...Object.values(world.bands).map((band) => deriveBandPosition(world, band, options)).filter((entry): entry is EntityPositionSnapshot => Boolean(entry)));
  }
  if (options.includePersons ?? true) {
    entries.push(...Object.values(world.persons).map((person) => derivePersonPosition(world, person, options)).filter((entry): entry is EntityPositionSnapshot => Boolean(entry)));
  }
  if (options.includeRemains ?? true) {
    entries.push(...Object.values(world.remains ?? {}).map((remains) => deriveRemainsPosition(world, remains, options)).filter((entry): entry is EntityPositionSnapshot => Boolean(entry)));
  }
  if (options.includeEffects ?? true) {
    entries.push(...Object.values(world.lingeringEffects ?? {}).map((effect) => deriveEffectPosition(world, effect, options)).filter((entry): entry is EntityPositionSnapshot => Boolean(entry)));
  }

  const limit = options.maxEntries;
  const sorted = entries.sort(
    (left, right) =>
      left.occupancyKey.localeCompare(right.occupancyKey) ||
      left.subjectKind.localeCompare(right.subjectKind) ||
      left.subjectId.localeCompare(right.subjectId)
  );
  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
}

export function groupOccupancy(entries: readonly EntityPositionSnapshot[], world: World): OccupancyBucket[] {
  const buckets = new Map<string, OccupancyBucket>();
  for (const entry of entries) {
    const existing = buckets.get(entry.occupancyKey);
    const bucket =
      existing ??
      ({
        key: entry.occupancyKey,
        anchorKind: entry.anchorKind,
        label: occupancyLabel(world, entry),
        settlementId: entry.settlementId,
        sectorId: entry.sectorId,
        tileId: entry.tileId,
        routeId: entry.routeId,
        originLocationId: entry.originLocationId,
        targetLocationId: entry.targetLocationId,
        x: entry.x,
        y: entry.y,
        layer: entry.layer,
        entries: [],
        counts: { person: 0, band: 0, remains: 0, settlement: 0, effect: 0 },
        factionIds: [],
        tags: []
      } satisfies OccupancyBucket);
    bucket.entries.push(entry);
    bucket.counts[entry.subjectKind] += 1;
    bucket.factionIds = uniqueText([...bucket.factionIds, entry.factionId]);
    bucket.tags = uniqueText([...bucket.tags, ...entry.tags]).slice(0, 20);
    buckets.set(entry.occupancyKey, bucket);
  }
  return [...buckets.values()].sort(
    (left, right) =>
      right.entries.length - left.entries.length ||
      left.anchorKind.localeCompare(right.anchorKind) ||
      left.key.localeCompare(right.key)
  );
}

export function collectOccupancySnapshot(world: World, options: OccupancyOptions = {}): WorldOccupancySnapshot {
  const entries = collectPositionSnapshots(world, options);
  const buckets = groupOccupancy(entries, world);
  const bySubjectId: Record<string, EntityPositionSnapshot> = {};
  const byOccupancyKey: Record<string, OccupancyBucket> = {};
  const settlementKeys: Record<Id, string[]> = {};
  const tileKeys: Record<Id, string[]> = {};
  const routeKeys: Record<Id, string[]> = {};

  for (const entry of entries) {
    bySubjectId[subjectLookupKey(entry.subjectKind, entry.subjectId)] = entry;
    if (entry.settlementId) settlementKeys[entry.settlementId] = uniqueText([...(settlementKeys[entry.settlementId] ?? []), entry.occupancyKey]);
    if (entry.tileId) tileKeys[entry.tileId] = uniqueText([...(tileKeys[entry.tileId] ?? []), entry.occupancyKey]);
    if (entry.routeId) routeKeys[entry.routeId] = uniqueText([...(routeKeys[entry.routeId] ?? []), entry.occupancyKey]);
  }

  for (const bucket of buckets) {
    byOccupancyKey[bucket.key] = bucket;
  }

  return {
    tick: world.tick,
    entries,
    buckets,
    bySubjectId,
    byOccupancyKey,
    settlementKeys,
    tileKeys,
    routeKeys
  };
}

export function lookupPosition(world: World, subjectKind: OccupancySubjectKind, subjectId: Id, options: OccupancyOptions = {}): EntityPositionSnapshot | undefined {
  return collectOccupancySnapshot(world, options).bySubjectId[subjectLookupKey(subjectKind, subjectId)];
}

function occupancyLabel(world: World, entry: EntityPositionSnapshot): string {
  if (entry.anchorKind === "settlement" && entry.settlementId) {
    return world.settlements[entry.settlementId]?.name ?? entry.settlementId;
  }
  if (entry.anchorKind === "route" && entry.routeId) {
    const origin = entry.originLocationId ? world.settlements[entry.originLocationId]?.name : undefined;
    const target = entry.targetLocationId ? world.settlements[entry.targetLocationId]?.name : undefined;
    return origin && target ? `${origin} to ${target}` : entry.routeId;
  }
  if (entry.anchorKind === "tile" && entry.tileId) {
    const tile = world.geography?.tiles?.[entry.tileId];
    const sector = tile ? world.geography?.sectors?.[tile.sectorId] : undefined;
    return sector ? `${sector.id} ${tile?.terrain ?? "tile"}` : entry.tileId;
  }
  if (entry.anchorKind === "coordinate") {
    return `${entry.layer} ${entry.x.toFixed(2)}, ${entry.y.toFixed(2)}`;
  }
  return "unknown";
}

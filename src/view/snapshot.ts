import { collectOccupancySnapshot, type EntityPositionSnapshot, type OccupancyBucket, type WorldOccupancySnapshot } from "../sim/world/occupancy";
import { deriveWorldClock, type WorldClockSnapshot } from "../sim/world/calendar";
import { createPlanetHexGrid, type PlanetHexTile } from "../sim/environment/planetHexGrid";
import type {
  Id,
  LingeringEffect,
  MediumLayer,
  Settlement,
  SettlementBuilding,
  SettlementBuildingFootprint,
  SettlementLocalMap,
  TravelRoute,
  World,
  WorldSector,
  OverworldTile
} from "../sim/types";
import {
  activeEffectsFor,
  allWorldSectors,
  allWorldTiles,
  buildingsForSettlement,
  localMapForSettlement,
  regionSectorsFor,
  routesForSettlement,
  selectedBandIdFor,
  selectedPersonIdFor,
  selectedSettlementFor,
  tilesForSectors,
  type RenderMode,
  type RenderOverlay,
  type SnapshotSelectionInput
} from "./selectors";

export interface RenderCameraSnapshot {
  mode: RenderMode;
  overlay: RenderOverlay;
  selectedSettlementId: Id;
  targetSectorId?: Id;
  x: number;
  y: number;
  zoom: number;
  layer: MediumLayer;
}

export interface RenderSelectionSnapshot {
  settlementId: Id;
  bandId: Id;
  personId: Id;
}

export interface LocalSettlementSnapshot {
  settlementId: Id;
  map?: SettlementLocalMap;
  buildings: SettlementBuilding[];
  buildingFootprints: LocalBuildingFootprintSnapshot[];
  occupiedTileIds: Id[];
}

export interface LocalBuildingFootprintSnapshot {
  buildingId: Id;
  catalogId: SettlementBuilding["catalogId"];
  name: string;
  status: SettlementBuilding["status"];
  occupantIds: Id[];
  footprint: SettlementBuildingFootprint;
}

export interface RenderSnapshot {
  tick: number;
  day: number;
  clock: WorldClockSnapshot;
  mode: RenderMode;
  camera: RenderCameraSnapshot;
  selections: RenderSelectionSnapshot;
  settlements: Settlement[];
  sectors: WorldSector[];
  tiles: OverworldTile[];
  planetHexes: readonly PlanetHexTile[];
  routes: TravelRoute[];
  entities: EntityPositionSnapshot[];
  occupancyBuckets: OccupancyBucket[];
  occupancy: WorldOccupancySnapshot;
  effects: LingeringEffect[];
  local?: LocalSettlementSnapshot;
}

export interface RenderSnapshotOptions extends SnapshotSelectionInput {
  mode?: RenderMode;
  overlay?: RenderOverlay;
  camera?: Partial<Pick<RenderCameraSnapshot, "x" | "y" | "zoom" | "layer" | "targetSectorId" | "selectedSettlementId">>;
  regionRadius?: number;
  includeEffects?: boolean;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function normalized(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, finiteNumber(value, fallback)));
}

function zoomForMode(mode: RenderMode): number {
  if (mode === "local") {
    return 6;
  }
  if (mode === "region") {
    return 2.5;
  }
  return 1;
}

function cameraFor(world: World, mode: RenderMode, overlay: RenderOverlay, settlement: Settlement, input?: RenderSnapshotOptions["camera"]): RenderCameraSnapshot {
  const targetSettlement = input?.selectedSettlementId ? (world.settlements[input.selectedSettlementId] ?? settlement) : settlement;
  return {
    mode,
    overlay,
    selectedSettlementId: targetSettlement.id,
    targetSectorId: input?.targetSectorId ?? targetSettlement.sectorId,
    x: normalized(input?.x, targetSettlement.x),
    y: normalized(input?.y, targetSettlement.y),
    zoom: Math.max(0.001, finiteNumber(input?.zoom, zoomForMode(mode))),
    layer: input?.layer ?? targetSettlement.localMap?.layer ?? "surface"
  };
}

function copiedFootprint(footprint: SettlementBuildingFootprint): SettlementBuildingFootprint {
  return {
    tileIds: [...footprint.tileIds],
    width: footprint.width,
    height: footprint.height,
    anchorQ: footprint.anchorQ,
    anchorR: footprint.anchorR,
    layer: footprint.layer
  };
}

function buildingFootprintsForSettlement(settlement: Settlement): LocalBuildingFootprintSnapshot[] {
  return buildingsForSettlement(settlement)
    .filter((building) => Boolean(building.footprint))
    .map((building) => ({
      buildingId: building.id,
      catalogId: building.catalogId,
      name: building.name,
      status: building.status,
      occupantIds: [...(building.occupantIds ?? [])],
      footprint: copiedFootprint(building.footprint as SettlementBuildingFootprint)
    }));
}

function localSnapshotForSettlement(settlement: Settlement): LocalSettlementSnapshot | undefined {
  const map = localMapForSettlement(settlement);
  const buildingFootprints = buildingFootprintsForSettlement(settlement);
  if (!map && buildingFootprints.length === 0) {
    return undefined;
  }
  return {
    settlementId: settlement.id,
    map,
    buildings: buildingsForSettlement(settlement),
    buildingFootprints,
    occupiedTileIds: [...new Set(buildingFootprints.flatMap((building) => building.footprint.tileIds))]
  };
}

export function createRenderSnapshot(world: World, options: RenderSnapshotOptions = {}): RenderSnapshot {
  const mode = options.mode ?? "world";
  const overlay = options.overlay ?? "biomes";
  const selectedSettlement = selectedSettlementFor(world, options);
  const selectedBandId = selectedBandIdFor(world, options);
  const selectedPersonId = selectedPersonIdFor(world, options);
  const sectors = mode === "world" ? allWorldSectors(world) : regionSectorsFor(world, selectedSettlement, options.regionRadius ?? 2);
  const tiles = mode === "world" ? allWorldTiles(world) : tilesForSectors(world, sectors);
  const planetHexes = mode === "world" ? createPlanetHexGrid(world).tiles : [];
  const occupancy = collectOccupancySnapshot(world, { includeEffects: options.includeEffects ?? true });

  return {
    tick: world.tick,
    day: world.day,
    clock: deriveWorldClock(world.tick, { day: world.day }),
    mode,
    camera: cameraFor(world, mode, overlay, selectedSettlement, options.camera),
    selections: {
      settlementId: selectedSettlement.id,
      bandId: selectedBandId,
      personId: selectedPersonId
    },
    settlements: Object.values(world.settlements).sort((left, right) => left.id.localeCompare(right.id)),
    sectors,
    tiles,
    planetHexes,
    routes: routesForSettlement(world, mode === "world" ? undefined : selectedSettlement),
    entities: occupancy.entries,
    occupancyBuckets: occupancy.buckets,
    occupancy,
    effects: activeEffectsFor(world),
    local: localSnapshotForSettlement(selectedSettlement)
  };
}

export function snapshotDebugSummary(snapshot: RenderSnapshot): Record<string, number | string> {
  return {
    tick: snapshot.tick,
    day: snapshot.day,
    time: snapshot.clock.timeLabel,
    phase: snapshot.clock.phase,
    mode: snapshot.camera.mode,
    overlay: snapshot.camera.overlay,
    settlementId: snapshot.selections.settlementId,
    settlements: snapshot.settlements.length,
    sectors: snapshot.sectors.length,
    tiles: snapshot.tiles.length,
    planetHexes: snapshot.planetHexes.length,
    routes: snapshot.routes.length,
    entities: snapshot.entities.length,
    occupancyBuckets: snapshot.occupancyBuckets.length,
    effects: snapshot.effects.length,
    localBuildings: snapshot.local?.buildings.length ?? 0
  };
}

import { collectOccupancySnapshot, type EntityPositionSnapshot, type OccupancyBucket } from "../sim/world/occupancy";
import type {
  Id,
  LingeringEffect,
  Settlement,
  SettlementBuilding,
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
}

export interface RenderSnapshot {
  tick: number;
  day: number;
  camera: RenderCameraSnapshot;
  selections: RenderSelectionSnapshot;
  settlements: Settlement[];
  sectors: WorldSector[];
  tiles: OverworldTile[];
  routes: TravelRoute[];
  entities: EntityPositionSnapshot[];
  occupancyBuckets: OccupancyBucket[];
  effects: LingeringEffect[];
  local?: LocalSettlementSnapshot;
}

export interface RenderSnapshotOptions extends SnapshotSelectionInput {
  mode?: RenderMode;
  overlay?: RenderOverlay;
  regionRadius?: number;
  includeEffects?: boolean;
}

export function createRenderSnapshot(world: World, options: RenderSnapshotOptions = {}): RenderSnapshot {
  const mode = options.mode ?? "world";
  const overlay = options.overlay ?? "biomes";
  const selectedSettlement = selectedSettlementFor(world, options);
  const selectedBandId = selectedBandIdFor(world, options);
  const selectedPersonId = selectedPersonIdFor(world, options);
  const sectors = mode === "world" ? allWorldSectors(world) : regionSectorsFor(world, selectedSettlement, options.regionRadius ?? 2);
  const tiles = mode === "world" ? allWorldTiles(world) : tilesForSectors(world, sectors);
  const occupancy = collectOccupancySnapshot(world, { includeEffects: options.includeEffects ?? true });

  return {
    tick: world.tick,
    day: world.day,
    camera: {
      mode,
      overlay,
      selectedSettlementId: selectedSettlement.id
    },
    selections: {
      settlementId: selectedSettlement.id,
      bandId: selectedBandId,
      personId: selectedPersonId
    },
    settlements: Object.values(world.settlements).sort((left, right) => left.id.localeCompare(right.id)),
    sectors,
    tiles,
    routes: routesForSettlement(world, mode === "world" ? undefined : selectedSettlement),
    entities: occupancy.entries,
    occupancyBuckets: occupancy.buckets,
    effects: activeEffectsFor(world),
    local:
      mode === "local"
        ? {
            settlementId: selectedSettlement.id,
            map: localMapForSettlement(selectedSettlement),
            buildings: buildingsForSettlement(selectedSettlement)
          }
        : undefined
  };
}

export function snapshotDebugSummary(snapshot: RenderSnapshot): Record<string, number | string> {
  return {
    tick: snapshot.tick,
    day: snapshot.day,
    mode: snapshot.camera.mode,
    overlay: snapshot.camera.overlay,
    settlementId: snapshot.selections.settlementId,
    settlements: snapshot.settlements.length,
    sectors: snapshot.sectors.length,
    tiles: snapshot.tiles.length,
    routes: snapshot.routes.length,
    entities: snapshot.entities.length,
    occupancyBuckets: snapshot.occupancyBuckets.length,
    effects: snapshot.effects.length,
    localBuildings: snapshot.local?.buildings.length ?? 0
  };
}

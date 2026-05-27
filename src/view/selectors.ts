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

export type RenderMode = "world" | "region" | "local";
export type RenderOverlay = "biomes" | "elevation" | "threat" | "political";

export interface SnapshotSelectionInput {
  selectedSettlementId?: Id;
  selectedBandId?: Id;
  selectedPersonId?: Id;
}

export function selectedBandIdFor(world: World, input: SnapshotSelectionInput = {}): Id {
  return input.selectedBandId && world.bands[input.selectedBandId] ? input.selectedBandId : world.selectedBandId;
}

export function selectedPersonIdFor(world: World, input: SnapshotSelectionInput = {}): Id {
  return input.selectedPersonId && world.persons[input.selectedPersonId] ? input.selectedPersonId : world.selectedPersonId;
}

export function selectedSettlementFor(world: World, input: SnapshotSelectionInput = {}): Settlement {
  const selectedBand = world.bands[selectedBandIdFor(world, input)];
  const fallbackId = selectedBand?.travel?.destinationId ?? selectedBand?.locationId;
  return (
    (input.selectedSettlementId ? world.settlements[input.selectedSettlementId] : undefined) ??
    (fallbackId ? world.settlements[fallbackId] : undefined) ??
    Object.values(world.settlements).sort((left, right) => left.id.localeCompare(right.id))[0]
  );
}

export function sectorForSettlement(world: World, settlement: Settlement): WorldSector | undefined {
  return world.geography.sectors[settlement.sectorId];
}

function hexDistance(left: Pick<WorldSector, "q" | "r">, right: Pick<WorldSector, "q" | "r">): number {
  return Math.max(Math.abs(left.q - right.q), Math.abs(left.r - right.r), Math.abs(left.q + left.r - (right.q + right.r)));
}

export function regionSectorsFor(world: World, settlement: Settlement, radius = 2): WorldSector[] {
  const center = sectorForSettlement(world, settlement);
  if (!center) {
    return [];
  }
  return Object.values(world.geography.sectors)
    .filter((sector) => hexDistance(center, sector) <= radius)
    .sort((left, right) => left.r - right.r || left.q - right.q || left.id.localeCompare(right.id));
}

export function tilesForSectors(world: World, sectors: readonly WorldSector[]): OverworldTile[] {
  const sectorIds = new Set(sectors.map((sector) => sector.id));
  return Object.values(world.geography.tiles)
    .filter((tile) => sectorIds.has(tile.sectorId))
    .sort((left, right) => left.sectorId.localeCompare(right.sectorId) || left.r - right.r || left.q - right.q || left.id.localeCompare(right.id));
}

export function allWorldSectors(world: World): WorldSector[] {
  return Object.values(world.geography.sectors).sort((left, right) => left.r - right.r || left.q - right.q || left.id.localeCompare(right.id));
}

export function allWorldTiles(world: World): OverworldTile[] {
  return Object.values(world.geography.tiles).sort((left, right) => left.sectorId.localeCompare(right.sectorId) || left.r - right.r || left.q - right.q || left.id.localeCompare(right.id));
}

export function routesForSettlement(world: World, settlement?: Settlement): TravelRoute[] {
  const routes = Object.values(world.planet.routes);
  const filtered = settlement ? routes.filter((route) => route.fromId === settlement.id || route.toId === settlement.id) : routes;
  return filtered.sort((left, right) => left.fromId.localeCompare(right.fromId) || left.toId.localeCompare(right.toId) || left.id.localeCompare(right.id));
}

export function localMapForSettlement(settlement: Settlement): SettlementLocalMap | undefined {
  return settlement.localMap;
}

export function buildingsForSettlement(settlement: Settlement): SettlementBuilding[] {
  return [...(settlement.buildings ?? [])].sort((left, right) => left.builtTick - right.builtTick || left.catalogId.localeCompare(right.catalogId) || left.id.localeCompare(right.id));
}

export function activeEffectsFor(world: World): LingeringEffect[] {
  return Object.values(world.lingeringEffects)
    .filter((effect) => effect.remainingTicks > 0)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

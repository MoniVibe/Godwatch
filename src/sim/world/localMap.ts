import { clamp } from "../core/math";
import type {
  Id,
  MediumLayer,
  Settlement,
  SettlementBuildingFootprint,
  SettlementLocalMap,
  SettlementLocalMapKind
} from "../types";
import { defaultLocalLayer, makeLocalCoord, makeLocalTileId, parseLocalTileId, type LocalCoord } from "./spatial";

export interface FootprintRepairResult {
  footprint: SettlementBuildingFootprint;
  repaired: boolean;
  reason?: string;
}

function stableLocalMapId(settlementId: Id): Id {
  return `local-map:${encodeURIComponent(settlementId)}`;
}

export function localMapKindForSettlement(settlement: Pick<Settlement, "population" | "prosperity" | "defense">): SettlementLocalMapKind {
  if (settlement.population >= 2200 || settlement.prosperity >= 72 || settlement.defense >= 78) return "city";
  if (settlement.population >= 1000 || settlement.prosperity >= 52 || settlement.defense >= 54) return "town";
  if (settlement.population >= 220) return "village";
  return "camp";
}

export function localMapSizeForKind(kind: SettlementLocalMapKind): number {
  if (kind === "camp") return 32;
  if (kind === "village") return 64;
  return 96;
}

export function localMapEntranceCoord(map: Pick<SettlementLocalMap, "width" | "height" | "layer">): LocalCoord {
  return makeLocalCoord(Math.floor(map.width / 2), Math.max(0, map.height - 3), map.layer);
}

export function localMapCenterCoord(map: Pick<SettlementLocalMap, "width" | "height" | "layer">): LocalCoord {
  return makeLocalCoord(Math.floor(map.width / 2), Math.floor(map.height / 2), map.layer);
}

export function isLocalCoordInMap(map: Pick<SettlementLocalMap, "width" | "height">, coord: Pick<LocalCoord, "x" | "y">): boolean {
  return Number.isInteger(coord.x) && Number.isInteger(coord.y) && coord.x >= 0 && coord.y >= 0 && coord.x < map.width && coord.y < map.height;
}

export function clampLocalCoordToMap(map: Pick<SettlementLocalMap, "width" | "height" | "layer">, coord: Pick<LocalCoord, "x" | "y"> & { layer?: MediumLayer }): LocalCoord {
  return makeLocalCoord(clamp(Math.round(coord.x), 0, map.width - 1), clamp(Math.round(coord.y), 0, map.height - 1), coord.layer ?? map.layer);
}

export function ensureLocalMapForSettlement(settlement: Settlement, tick = 0): SettlementLocalMap {
  const kind = localMapKindForSettlement(settlement);
  const size = localMapSizeForKind(kind);
  const existing = settlement.localMap;
  const repairFlags = [...(existing?.repairFlags ?? [])];
  if (!existing || existing.width !== size || existing.height !== size || existing.settlementId !== settlement.id) {
    if (existing) {
      repairFlags.push("resized-local-map");
    }
    const draft = {
      id: stableLocalMapId(settlement.id),
      settlementId: settlement.id,
      kind,
      width: size,
      height: size,
      layer: existing?.layer ?? defaultLocalLayer,
      entranceTileId: "",
      centerTileId: "",
      generatedTick: Math.max(0, Math.round(existing?.generatedTick ?? tick)),
      repairFlags,
      tags: [kind, settlement.biomeId, settlement.terrain, settlement.topography]
    } satisfies SettlementLocalMap;
    draft.entranceTileId = makeLocalTileId(settlement.id, localMapEntranceCoord(draft));
    draft.centerTileId = makeLocalTileId(settlement.id, localMapCenterCoord(draft));
    settlement.localMap = draft;
    return draft;
  }

  existing.kind = kind;
  existing.layer = existing.layer ?? defaultLocalLayer;
  existing.entranceTileId = validLocalTileIdForMap(settlement.id, existing, existing.entranceTileId)
    ? existing.entranceTileId
    : makeLocalTileId(settlement.id, localMapEntranceCoord(existing));
  existing.centerTileId = validLocalTileIdForMap(settlement.id, existing, existing.centerTileId)
    ? existing.centerTileId
    : makeLocalTileId(settlement.id, localMapCenterCoord(existing));
  existing.tags = [...new Set([...(existing.tags ?? []), kind, settlement.biomeId, settlement.terrain, settlement.topography])];
  existing.repairFlags = repairFlags;
  return existing;
}

export function validLocalTileIdForMap(settlementId: Id, map: Pick<SettlementLocalMap, "width" | "height" | "layer">, tileId: Id | undefined): boolean {
  if (!tileId) {
    return false;
  }
  const parsed = parseLocalTileId(tileId);
  return Boolean(parsed && parsed.settlementId === settlementId && parsed.layer === map.layer && isLocalCoordInMap(map, parsed));
}

function footprintOrigin(map: SettlementLocalMap, footprint: Pick<SettlementBuildingFootprint, "anchorQ" | "anchorR" | "width" | "height">): LocalCoord {
  const center = localMapCenterCoord(map);
  const width = clamp(Math.round(footprint.width), 1, map.width);
  const height = clamp(Math.round(footprint.height), 1, map.height);
  return makeLocalCoord(
    clamp(center.x + Math.round(footprint.anchorQ), 0, Math.max(0, map.width - width)),
    clamp(center.y + Math.round(footprint.anchorR), 0, Math.max(0, map.height - height)),
    map.layer
  );
}

export function tileIdsForFootprint(settlementId: Id, map: SettlementLocalMap, footprint: Pick<SettlementBuildingFootprint, "anchorQ" | "anchorR" | "width" | "height">): Id[] {
  const width = clamp(Math.round(footprint.width), 1, map.width);
  const height = clamp(Math.round(footprint.height), 1, map.height);
  const origin = footprintOrigin(map, { ...footprint, width, height });
  const tileIds: Id[] = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      tileIds.push(makeLocalTileId(settlementId, origin.x + x, origin.y + y, map.layer));
    }
  }
  return tileIds;
}

export function repairBuildingFootprintForLocalMap(settlement: Settlement, footprint: SettlementBuildingFootprint, tick = 0): FootprintRepairResult {
  const map = ensureLocalMapForSettlement(settlement, tick);
  const width = clamp(Math.round(footprint.width), 1, map.width);
  const height = clamp(Math.round(footprint.height), 1, map.height);
  const origin = footprintOrigin(map, { ...footprint, width, height });
  const repaired: SettlementBuildingFootprint = {
    ...footprint,
    width,
    height,
    anchorQ: origin.x - localMapCenterCoord(map).x,
    anchorR: origin.y - localMapCenterCoord(map).y,
    layer: map.layer,
    tileIds: tileIdsForFootprint(settlement.id, map, { ...footprint, width, height, anchorQ: origin.x - localMapCenterCoord(map).x, anchorR: origin.y - localMapCenterCoord(map).y })
  };
  const repairedTiles = repaired.tileIds.length !== footprint.tileIds.length || repaired.tileIds.some((tileId, index) => tileId !== footprint.tileIds[index]);
  const repairedGeometry =
    repaired.width !== footprint.width ||
    repaired.height !== footprint.height ||
    repaired.anchorQ !== footprint.anchorQ ||
    repaired.anchorR !== footprint.anchorR ||
    repaired.layer !== footprint.layer;
  const changed = repairedTiles || repairedGeometry;
  if (changed) {
    map.repairFlags = [...new Set([...(map.repairFlags ?? []), "repaired-building-footprint"])];
  }
  return {
    footprint: repaired,
    repaired: changed,
    reason: changed ? "footprint normalized to local map bounds" : undefined
  };
}

export function repairPersonLocalTileForSettlement(settlement: Settlement, localTileId: Id | undefined, fallbackTileId?: Id): Id | undefined {
  const map = ensureLocalMapForSettlement(settlement);
  if (validLocalTileIdForMap(settlement.id, map, localTileId)) {
    return localTileId;
  }
  if (validLocalTileIdForMap(settlement.id, map, fallbackTileId)) {
    map.repairFlags = [...new Set([...(map.repairFlags ?? []), "repaired-person-local-tile"])];
    return fallbackTileId;
  }
  map.repairFlags = [...new Set([...(map.repairFlags ?? []), "repaired-person-local-tile"])];
  return map.entranceTileId;
}

export function validateSettlementLocalMap(settlement: Settlement): string[] {
  const map = ensureLocalMapForSettlement(settlement);
  const issues: string[] = [];
  if (map.width <= 0 || map.height <= 0) {
    issues.push(`${settlement.name} has invalid local map dimensions ${map.width}x${map.height}`);
  }
  if (!validLocalTileIdForMap(settlement.id, map, map.entranceTileId)) {
    issues.push(`${settlement.name} has invalid local map entrance`);
  }
  for (const building of settlement.buildings ?? []) {
    const footprint = building.footprint;
    if (!footprint) {
      continue;
    }
    for (const tileId of footprint.tileIds) {
      if (!validLocalTileIdForMap(settlement.id, map, tileId)) {
        issues.push(`${settlement.name} building ${building.name} has out-of-bounds local footprint tile`);
        break;
      }
    }
  }
  return issues;
}

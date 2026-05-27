import { clamp } from "../core/math";
import type { Id, MediumLayer, Settlement } from "../types";

export interface HexCoord {
  q: number;
  r: number;
}

export interface PlanetCoord {
  planetId?: Id;
  x: number;
  y: number;
  layer: MediumLayer;
}

export interface LocalCoord {
  siteId?: Id;
  x: number;
  y: number;
  layer: MediumLayer;
}

export type EntityPositionAnchor = "planet" | "settlement" | "local-tile" | "route" | "unknown";

export interface EntityPosition {
  entityId: Id;
  anchor: EntityPositionAnchor;
  planet?: PlanetCoord;
  local?: LocalCoord;
  settlementId?: Id;
  localTileId?: Id;
  routeId?: Id;
  progress?: number;
}

export interface ParsedLocalTileId {
  settlementId: Id;
  layer: MediumLayer;
  x: number;
  y: number;
}

export const defaultLocalLayer: MediumLayer = "surface";

const localTilePrefix = "local-tile";
const mediumLayers = new Set<MediumLayer>(["surface", "underground", "deep", "sky"]);

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeGridValue(value: number): number {
  return Math.max(0, Math.round(finiteOr(value, 0)));
}

function isMediumLayer(value: string): value is MediumLayer {
  return mediumLayers.has(value as MediumLayer);
}

export function makeHexCoord(q: number, r: number): HexCoord {
  return { q: Math.round(finiteOr(q, 0)), r: Math.round(finiteOr(r, 0)) };
}

export function hexS(coord: HexCoord): number {
  return -coord.q - coord.r;
}

export function hexDistance(left: HexCoord, right: HexCoord): number {
  return Math.max(Math.abs(left.q - right.q), Math.abs(left.r - right.r), Math.abs(hexS(left) - hexS(right)));
}

export function makePlanetCoord(x: number, y: number, layer: MediumLayer = defaultLocalLayer): PlanetCoord {
  return {
    x: clamp(finiteOr(x, 0.5), 0, 1),
    y: clamp(finiteOr(y, 0.5), 0, 1),
    layer
  };
}

export function makePlanetHexCoord(planetId: Id, q: number, r: number): PlanetCoord & { planetId: Id; hex: HexCoord } {
  return {
    planetId,
    hex: makeHexCoord(q, r),
    x: 0,
    y: 0,
    layer: defaultLocalLayer
  };
}

export function planetCoordForSettlement(settlement: Pick<Settlement, "x" | "y">, layer: MediumLayer = defaultLocalLayer): PlanetCoord {
  return makePlanetCoord(settlement.x, settlement.y, layer);
}

export function makeLocalCoord(x: number, y: number, layer: MediumLayer = defaultLocalLayer): LocalCoord {
  return {
    x: normalizeGridValue(x),
    y: normalizeGridValue(y),
    layer
  };
}

export function makeSiteLocalCoord(siteId: Id, x: number, y: number, layer: MediumLayer = defaultLocalLayer): LocalCoord {
  return {
    siteId,
    ...makeLocalCoord(x, y, layer)
  };
}

export function localCoordKey(coord: Pick<LocalCoord, "x" | "y">): string {
  return `${normalizeGridValue(coord.x)},${normalizeGridValue(coord.y)}`;
}

export function makeLocalTileId(settlementId: Id, x: number, y: number, layer?: MediumLayer): Id;
export function makeLocalTileId(settlementId: Id, coord: Pick<LocalCoord, "x" | "y"> & { layer?: MediumLayer }): Id;
export function makeLocalTileId(
  settlementId: Id,
  xOrCoord: number | (Pick<LocalCoord, "x" | "y"> & { layer?: MediumLayer }),
  y?: number,
  layer: MediumLayer = defaultLocalLayer
): Id {
  const coord =
    typeof xOrCoord === "number"
      ? makeLocalCoord(xOrCoord, y ?? 0, layer)
      : makeLocalCoord(xOrCoord.x, xOrCoord.y, xOrCoord.layer ?? defaultLocalLayer);
  return `${localTilePrefix}:${encodeURIComponent(settlementId)}:${coord.layer}:${coord.x}:${coord.y}`;
}

export function parseLocalTileId(tileId: Id): ParsedLocalTileId | undefined {
  const parts = tileId.split(":");
  if (parts.length !== 5 || parts[0] !== localTilePrefix) {
    return undefined;
  }

  const [, encodedSettlementId, layerValue, xValue, yValue] = parts;
  if (!encodedSettlementId || !isMediumLayer(layerValue)) {
    return undefined;
  }

  const x = Number(xValue);
  const y = Number(yValue);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    return undefined;
  }

  try {
    return {
      settlementId: decodeURIComponent(encodedSettlementId),
      layer: layerValue,
      x,
      y
    };
  } catch {
    return undefined;
  }
}

export function sameLocalTileId(settlementId: Id, coord: LocalCoord, tileId: Id): boolean {
  const parsed = parseLocalTileId(tileId);
  return Boolean(parsed && parsed.settlementId === settlementId && parsed.layer === coord.layer && parsed.x === coord.x && parsed.y === coord.y);
}

export function entityPositionAtSettlement(entityId: Id, settlement: Settlement, layer: MediumLayer = defaultLocalLayer): EntityPosition {
  return {
    entityId,
    anchor: "settlement",
    planet: planetCoordForSettlement(settlement, layer),
    settlementId: settlement.id
  };
}

export function entityPositionAtLocalTile(entityId: Id, settlementId: Id, coord: LocalCoord): EntityPosition {
  return {
    entityId,
    anchor: "local-tile",
    local: makeLocalCoord(coord.x, coord.y, coord.layer),
    settlementId,
    localTileId: makeLocalTileId(settlementId, coord)
  };
}

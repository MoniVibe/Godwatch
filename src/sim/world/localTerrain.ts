import type { ElevationBand, LocalTerrainKind, MediumLayer, Settlement, TopographyKind } from "../types";
import type { LocalCoord } from "./spatial";

export interface LocalTerrainSample {
  kind: LocalTerrainKind;
  layer: MediumLayer;
  passability: number;
  elevationBand: ElevationBand;
  tags: string[];
}

function terrainFromTopography(topography: TopographyKind, x: number, y: number): LocalTerrainKind {
  const roughness = Math.abs(Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233));
  if (topography === "mountain" || topography === "ridge") {
    return roughness > 0.72 ? "rock" : "cliff";
  }
  if (topography === "valley") {
    return roughness > 0.82 ? "water" : "soil";
  }
  if (topography === "wetland" || topography === "lowland") {
    return roughness > 0.56 ? "forest" : "soil";
  }
  return roughness > 0.9 ? "rock" : "soil";
}

function passabilityFor(kind: LocalTerrainKind): number {
  if (kind === "water") return 18;
  if (kind === "cliff") return 8;
  if (kind === "rock") return 42;
  if (kind === "forest") return 58;
  if (kind === "road") return 96;
  return 76;
}

export function localTerrainForSettlement(settlement: Settlement, coord: LocalCoord): LocalTerrainSample {
  const kind = coord.layer === "surface" ? terrainFromTopography(settlement.topography, coord.x, coord.y) : "rock";
  return {
    kind,
    layer: coord.layer,
    passability: passabilityFor(kind),
    elevationBand: settlement.elevationBand,
    tags: [kind, settlement.biomeId, settlement.terrain, settlement.topography, settlement.elevationBand]
  };
}

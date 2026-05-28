export type MapMarkerSemanticId =
  | "settlement"
  | "watched-band"
  | "selected-active-route"
  | "route-context-danger"
  | "site-resource"
  | "threat-crisis"
  | "territory-claim"
  | "weather-front"
  | "settlement-border"
  | "local-building"
  | "lingering-effect";

export type MapMarkerLayer = "world" | "region" | "local";

export type MapMarkerVisualKind = "point" | "diamond" | "line" | "area" | "border" | "footprint" | "effect";

export interface MapMarkerLegendEntry {
  id: MapMarkerSemanticId;
  label: string;
  layer: MapMarkerLayer;
  visualKind: MapMarkerVisualKind;
  description: string;
}

export const MAP_MARKER_LEGEND_ENTRIES = [
  {
    id: "settlement",
    label: "Settlement dot",
    layer: "world",
    visualKind: "point",
    description: "Named population center anchored to sim settlement truth; size and labels can vary by zoom or selection."
  },
  {
    id: "watched-band",
    label: "Band diamond",
    layer: "world",
    visualKind: "diamond",
    description: "Band and traveling-group positions render as diamond markers so they stay distinct from settlement points."
  },
  {
    id: "selected-active-route",
    label: "Selected route",
    layer: "world",
    visualKind: "line",
    description: "Highlighted route for the selected band or settlement context; it should not imply movement unless backed by band travel state."
  },
  {
    id: "route-context-danger",
    label: "Route risk line",
    layer: "world",
    visualKind: "line",
    description: "Red or yellow route lines communicate route context and danger level, not necessarily active movement."
  },
  {
    id: "site-resource",
    label: "Site/resource",
    layer: "region",
    visualKind: "point",
    description: "Regional feature, ruin, holding, or resource node that can be inspected without becoming a settlement."
  },
  {
    id: "threat-crisis",
    label: "Story threat",
    layer: "region",
    visualKind: "point",
    description: "Localized danger, battle, monster pressure, or crisis marker; danger overlays should explain severity without rewriting sim state."
  },
  {
    id: "territory-claim",
    label: "Territory area",
    layer: "world",
    visualKind: "area",
    description: "Faction or settlement influence shown as quiet area tint or political mask derived from claim data."
  },
  {
    id: "weather-front",
    label: "Weather area",
    layer: "world",
    visualKind: "area",
    description: "Weather or climate pressure shown as a translucent front or wash, separate from terrain biome truth."
  },
  {
    id: "settlement-border",
    label: "Local border",
    layer: "local",
    visualKind: "border",
    description: "Wall, palisade, district edge, or watched perimeter from settlement border data."
  },
  {
    id: "local-building",
    label: "Local building",
    layer: "local",
    visualKind: "footprint",
    description: "Building footprint on square local subtiles; occupancy and services come from settlement-local data."
  },
  {
    id: "lingering-effect",
    label: "Lingering effect",
    layer: "local",
    visualKind: "effect",
    description: "Projectile, impact, status zone, trail, or weather remnant witnessed from effect packets."
  }
] as const satisfies readonly MapMarkerLegendEntry[];

export const REQUIRED_MAP_MARKER_SEMANTIC_IDS = MAP_MARKER_LEGEND_ENTRIES.map((entry) => entry.id);

const MAP_MARKER_LEGEND_BY_ID: Readonly<Record<MapMarkerSemanticId, MapMarkerLegendEntry>> = Object.freeze(
  Object.fromEntries(MAP_MARKER_LEGEND_ENTRIES.map((entry) => [entry.id, entry])) as Record<MapMarkerSemanticId, MapMarkerLegendEntry>
);

export function mapMarkerLegendEntries(): readonly MapMarkerLegendEntry[] {
  return MAP_MARKER_LEGEND_ENTRIES;
}

export function mapMarkerLegendEntry(id: MapMarkerSemanticId): MapMarkerLegendEntry {
  return MAP_MARKER_LEGEND_BY_ID[id];
}

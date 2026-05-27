import { clamp } from "../core/math";
import {
  ensureLocalMapForSettlement,
  repairBuildingFootprintForLocalMap,
  repairPersonLocalTileForSettlement,
  validateSettlementLocalMap
} from "./localMap";
import type {
  Id,
  Asset,
  AssetKind,
  BuildingServiceKind,
  LegalEntityRef,
  Person,
  Settlement,
  SettlementBorder,
  SettlementBorderKind,
  SettlementBorderStatus,
  SettlementBuildOrder,
  SettlementBuildOrderStatus,
  SettlementBuilding,
  SettlementBuildingCategory,
  SettlementBuildingFootprint,
  SettlementBuildingKind,
  SettlementBuildingService,
  SettlementBuildingStatus,
  World
} from "../types";

type SettlementBuildingEffectKind = "defense" | "prosperity" | "unrest" | "threat" | "culture";

export interface SettlementBuildingDefinition {
  id: SettlementBuildingKind;
  name: string;
  category: SettlementBuildingCategory;
  labor: number;
  cost: number;
  upkeep: number;
  effects: Partial<Record<SettlementBuildingEffectKind, number>>;
  tags: string[];
}

export interface SettlementBuildSignal {
  id: Id;
  settlementId: Id;
  catalogId: SettlementBuildingKind;
  priority: number;
  pressure: number;
  reason: string;
  tags: string[];
}

export interface SettlementBuildSignalOptions {
  minPressure?: number;
  maxSignals?: number;
  maxPerSettlement?: number;
  includeQueued?: boolean;
}

export interface SettlementBuildOrderOptions extends SettlementBuildSignalOptions {
  maxNewOrders?: number;
}

export interface SettlementConstructionOptions {
  maxActivePerSettlement?: number;
}

export interface SettlementDevelopmentUpdateOptions extends SettlementBuildOrderOptions, SettlementConstructionOptions {
  issueCadenceTicks?: number;
  buildCadenceTicks?: number;
  serviceCadenceTicks?: number;
}

export interface SettlementConstructionUpdate {
  issued: SettlementBuildOrder[];
  started: number;
  completed: SettlementBuildOrder[];
  servicedBuildings: number;
  occupiedServiceSlots: number;
  affectedPeople: number;
}

export interface SettlementServiceSimulationOptions {
  cadenceTicks?: number;
  maxOccupantsPerBuilding?: number;
}

export interface SettlementServiceSimulationResult {
  servicedBuildings: number;
  occupiedServiceSlots: number;
  affectedPeople: number;
}

export interface SettlementDevelopmentSnapshot {
  settlements: number;
  catalogSize: number;
  buildings: number;
  activeBuildings: number;
  damagedBuildings: number;
  borders: number;
  fortifiedBorders: number;
  fortifiedSettlements: number;
  buildOrders: number;
  queuedBuildOrders: number;
  activeBuildOrders: number;
  completedBuildOrders: number;
  serviceSlots: number;
  serviceCapacity: number;
  occupiedServiceSlots: number;
  housedPeople: number;
}

export const buildingCatalog: Record<SettlementBuildingKind, SettlementBuildingDefinition> = {
  housing: {
    id: "housing",
    name: "housing block",
    category: "housing",
    labor: 58,
    cost: 24,
    upkeep: 2,
    effects: { prosperity: 1, unrest: -1 },
    tags: ["shelter", "population"]
  },
  well: {
    id: "well",
    name: "well",
    category: "water",
    labor: 44,
    cost: 18,
    upkeep: 1,
    effects: { prosperity: 1, unrest: -2 },
    tags: ["water", "health"]
  },
  granary: {
    id: "granary",
    name: "granary",
    category: "food",
    labor: 72,
    cost: 32,
    upkeep: 2,
    effects: { prosperity: 2, unrest: -1, threat: -1 },
    tags: ["food", "storage", "siege"]
  },
  palisade: {
    id: "palisade",
    name: "palisade",
    category: "defense",
    labor: 96,
    cost: 38,
    upkeep: 3,
    effects: { defense: 8, threat: -2 },
    tags: ["fortification", "wood", "border"]
  },
  watchtower: {
    id: "watchtower",
    name: "watchtower",
    category: "defense",
    labor: 82,
    cost: 34,
    upkeep: 3,
    effects: { defense: 6, threat: -2 },
    tags: ["watch", "warning", "border"]
  },
  wall: {
    id: "wall",
    name: "stone wall",
    category: "defense",
    labor: 188,
    cost: 96,
    upkeep: 6,
    effects: { defense: 14, threat: -4 },
    tags: ["fortification", "stone", "border"]
  },
  gatehouse: {
    id: "gatehouse",
    name: "gatehouse",
    category: "defense",
    labor: 128,
    cost: 62,
    upkeep: 4,
    effects: { defense: 7, prosperity: 1 },
    tags: ["fortification", "route", "border"]
  },
  barracks: {
    id: "barracks",
    name: "barracks",
    category: "defense",
    labor: 118,
    cost: 56,
    upkeep: 5,
    effects: { defense: 9, unrest: 1 },
    tags: ["soldiers", "training", "garrison"]
  },
  market: {
    id: "market",
    name: "market square",
    category: "trade",
    labor: 84,
    cost: 42,
    upkeep: 3,
    effects: { prosperity: 5, unrest: -1 },
    tags: ["trade", "goods", "meeting-place"]
  },
  caravanserai: {
    id: "caravanserai",
    name: "caravanserai",
    category: "trade",
    labor: 102,
    cost: 58,
    upkeep: 4,
    effects: { prosperity: 4, threat: -1 },
    tags: ["trade", "routes", "lodging"]
  },
  forge: {
    id: "forge",
    name: "forge",
    category: "craft",
    labor: 112,
    cost: 62,
    upkeep: 4,
    effects: { prosperity: 3, defense: 2 },
    tags: ["craft", "metal", "weapons"]
  },
  workshop: {
    id: "workshop",
    name: "workshop",
    category: "craft",
    labor: 92,
    cost: 46,
    upkeep: 3,
    effects: { prosperity: 3 },
    tags: ["craft", "tools", "repairs"]
  },
  apothecary: {
    id: "apothecary",
    name: "apothecary",
    category: "medicine",
    labor: 76,
    cost: 38,
    upkeep: 3,
    effects: { prosperity: 1, unrest: -2 },
    tags: ["medicine", "herbs", "healing"]
  },
  temple: {
    id: "temple",
    name: "temple",
    category: "faith",
    labor: 108,
    cost: 54,
    upkeep: 4,
    effects: { unrest: -4, culture: 2 },
    tags: ["faith", "ritual", "legitimacy"]
  },
  graveyard: {
    id: "graveyard",
    name: "graveyard",
    category: "faith",
    labor: 64,
    cost: 24,
    upkeep: 2,
    effects: { unrest: -3, threat: -1 },
    tags: ["dead", "rest", "haunting"]
  },
  school: {
    id: "school",
    name: "school",
    category: "knowledge",
    labor: 98,
    cost: 48,
    upkeep: 4,
    effects: { culture: 3, prosperity: 1 },
    tags: ["children", "learning", "culture"]
  },
  library: {
    id: "library",
    name: "library",
    category: "knowledge",
    labor: 132,
    cost: 78,
    upkeep: 5,
    effects: { culture: 4, prosperity: 1 },
    tags: ["records", "research", "culture"]
  },
  guildhall: {
    id: "guildhall",
    name: "guildhall",
    category: "governance",
    labor: 124,
    cost: 68,
    upkeep: 5,
    effects: { prosperity: 3, unrest: -1, culture: 1 },
    tags: ["guild", "charter", "politics"]
  },
  dock: {
    id: "dock",
    name: "dock",
    category: "infrastructure",
    labor: 118,
    cost: 66,
    upkeep: 4,
    effects: { prosperity: 4 },
    tags: ["water", "trade", "travel"]
  }
};

export const buildingCatalogList = Object.values(buildingCatalog);

const buildingStatuses = new Set<SettlementBuildingStatus>(["planned", "building", "active", "damaged", "ruined"]);
const orderStatuses = new Set<SettlementBuildOrderStatus>(["queued", "building", "complete", "blocked"]);
const borderKinds = new Set<SettlementBorderKind>(["hamlet-edge", "village-edge", "town-edge", "city-edge", "palisade", "wall", "district"]);
const borderStatuses = new Set<SettlementBorderStatus>(["open", "watched", "fortified", "breached", "ruined"]);

const foodPattern = /grain|fish|reed|honey|goat|trout|eel|milk|orchard|mushroom|root|berry|fruit/i;
const medicinePattern = /herb|moss|mushroom|mint|willow|oil|honey|thyme|sage|lichen|flower|orchid|bell|pearlwort|leech/i;
const craftPattern = /ore|iron|wood|amber|quartz|glass|ash|salt|clay|wool|bone|hide|resin|copper|silver|stone|crystal/i;
const metalPattern = /ore|iron|copper|silver|steel|metal|living-iron/i;
const waterPattern = /river|coast|fish|trout|eel|reed|marsh|dock|ford/i;
const sacredPattern = /shrine|temple|saint|barrow|cairn|crypt|spirit|grave|old stones/i;
const threatPattern = /warg|wolf|bear|spider|adder|serpent|raider|bandit|undead|wraith|demon|beast/i;

const assetKindByBuilding: Partial<Record<SettlementBuildingKind, AssetKind>> = {
  apothecary: "apothecary",
  barracks: "fortress",
  caravanserai: "caravan",
  dock: "dock",
  forge: "forge",
  gatehouse: "fortress",
  graveyard: "graveyard",
  guildhall: "guildhall",
  palisade: "fortress",
  temple: "temple",
  wall: "fortress",
  watchtower: "fortress"
};

const assetOutputsByKind: Record<AssetKind, string[]> = {
  mine: ["ore", "stone", "hazard"],
  forge: ["arms", "tools", "craft"],
  apothecary: ["medicine", "poisons", "care"],
  caravan: ["trade", "news", "supply"],
  graveyard: ["ancestry", "rites", "memory"],
  temple: ["faith", "healing", "sanctuary"],
  guildhall: ["labor", "training", "contracts"],
  vault: ["coin", "records", "secrets"],
  farm: ["grain", "livestock", "tithes"],
  dock: ["fish", "passage", "cargo"],
  road: ["travel", "tolls", "patrols"],
  fortress: ["defense", "authority", "garrison"]
};

const serviceCadenceTicksByKind: Record<BuildingServiceKind, number> = {
  shelter: 12,
  rest: 6,
  craft: 12,
  repair: 12,
  medicine: 6,
  ritual: 12,
  burial: 12,
  training: 12,
  trade: 12,
  governance: 18,
  learning: 18,
  watch: 6,
  travel: 12
};

const serviceTagsByKind: Record<BuildingServiceKind, string[]> = {
  shelter: ["indoors", "safety"],
  rest: ["recovery", "sleep"],
  craft: ["work", "production"],
  repair: ["tools", "maintenance"],
  medicine: ["healing", "care"],
  ritual: ["faith", "morale"],
  burial: ["dead", "memory"],
  training: ["drill", "skills"],
  trade: ["goods", "coin"],
  governance: ["charters", "disputes"],
  learning: ["study", "apprenticeship"],
  watch: ["warning", "guard"],
  travel: ["routes", "lodging"]
};

const serviceKindsByBuilding: Partial<Record<SettlementBuildingKind, BuildingServiceKind[]>> = {
  apothecary: ["medicine", "trade"],
  barracks: ["training", "shelter"],
  caravanserai: ["travel", "rest", "trade"],
  dock: ["travel", "trade", "repair"],
  forge: ["craft", "repair"],
  gatehouse: ["watch", "travel"],
  granary: ["shelter", "trade"],
  graveyard: ["burial", "ritual"],
  guildhall: ["governance", "trade", "learning"],
  housing: ["shelter", "rest"],
  library: ["learning"],
  market: ["trade"],
  palisade: ["watch"],
  school: ["learning"],
  temple: ["ritual", "medicine"],
  wall: ["watch"],
  watchtower: ["watch"],
  well: ["rest"],
  workshop: ["craft", "repair"]
};

const footprintSizeByBuilding: Partial<Record<SettlementBuildingKind, { width: number; height: number }>> = {
  barracks: { width: 2, height: 2 },
  caravanserai: { width: 2, height: 2 },
  dock: { width: 2, height: 1 },
  forge: { width: 1, height: 2 },
  gatehouse: { width: 1, height: 1 },
  granary: { width: 1, height: 2 },
  graveyard: { width: 2, height: 2 },
  guildhall: { width: 2, height: 2 },
  housing: { width: 2, height: 2 },
  library: { width: 2, height: 2 },
  market: { width: 2, height: 2 },
  palisade: { width: 3, height: 1 },
  school: { width: 2, height: 1 },
  temple: { width: 2, height: 2 },
  wall: { width: 3, height: 1 },
  workshop: { width: 1, height: 2 }
};

function stableCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return code;
}

function stableId(prefix: string, parts: readonly string[]): Id {
  return `${prefix}-${stableCode(parts.join("|")).toString(36)}`;
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function footprintFor(settlement: Settlement, catalogId: SettlementBuildingKind, level: number): SettlementBuildingFootprint {
  const size = footprintSizeByBuilding[catalogId] ?? { width: 1, height: 1 };
  const code = stableCode(`${settlement.id}:${catalogId}`);
  const anchorQ = (code % 13) - 6;
  const anchorR = (Math.floor(code / 13) % 13) - 6;
  const width = Math.max(1, size.width + (catalogId === "housing" ? Math.max(0, level - 2) : 0));
  const height = Math.max(1, size.height);
  return repairBuildingFootprintForLocalMap(settlement, { tileIds: [], width, height, anchorQ, anchorR, layer: "surface" }).footprint;
}

function serviceCapacityFor(settlement: Settlement, catalogId: SettlementBuildingKind, kind: BuildingServiceKind, level: number): number {
  const populationScale = kind === "shelter" || kind === "rest" ? Math.max(2, Math.round(settlement.population / 180)) : 0;
  const base =
    kind === "shelter"
      ? 3 + populationScale
      : kind === "rest"
        ? 2 + Math.ceil(populationScale / 2)
        : kind === "trade" || kind === "governance"
          ? 3
          : kind === "learning" || kind === "training"
            ? 4
            : kind === "watch"
              ? 2
              : kind === "travel"
                ? 5
                : 3;
  const buildingBonus = catalogId === "guildhall" || catalogId === "market" || catalogId === "caravanserai" ? 2 : 0;
  return rounded(base + level + buildingBonus, 1, 32);
}

function serviceQualityFor(settlement: Settlement, building: Pick<SettlementBuilding, "catalogId" | "level" | "integrity">, kind: BuildingServiceKind): number {
  const categoryBonus = kind === "medicine" ? settlement.prosperity * 0.08 : kind === "watch" ? settlement.defense * 0.08 : settlement.prosperity * 0.05;
  return rounded(42 + building.level * 8 + building.integrity * 0.22 + categoryBonus, 10, 100);
}

function servicesFor(settlement: Settlement, building: Pick<SettlementBuilding, "catalogId" | "level" | "integrity">, previous: readonly Partial<SettlementBuildingService>[] = []): SettlementBuildingService[] {
  const previousByKind = new Map(previous.filter((service) => typeof service.kind === "string").map((service) => [service.kind as BuildingServiceKind, service]));
  return (serviceKindsByBuilding[building.catalogId] ?? ["shelter"]).map((kind) => {
    const prior = previousByKind.get(kind);
    const capacity = serviceCapacityFor(settlement, building.catalogId, kind, building.level);
    return {
      kind,
      capacity,
      quality: rounded(prior?.quality ?? serviceQualityFor(settlement, building, kind), 1, 100),
      occupantIds: [...new Set((prior?.occupantIds ?? []).filter((id): id is Id => typeof id === "string" && id.length > 0))].slice(0, capacity),
      lastSimulatedTick: Math.max(0, Math.round(prior?.lastSimulatedTick ?? 0)),
      cadenceTicks: Math.max(1, Math.round(prior?.cadenceTicks ?? serviceCadenceTicksByKind[kind])),
      tags: uniqueText([...(prior?.tags ?? []), ...serviceTagsByKind[kind]])
    };
  });
}

function isBuildingKind(value: unknown): value is SettlementBuildingKind {
  return typeof value === "string" && value in buildingCatalog;
}

function isBuildingStatus(value: unknown): value is SettlementBuildingStatus {
  return typeof value === "string" && buildingStatuses.has(value as SettlementBuildingStatus);
}

function isOrderStatus(value: unknown): value is SettlementBuildOrderStatus {
  return typeof value === "string" && orderStatuses.has(value as SettlementBuildOrderStatus);
}

function isBorderKind(value: unknown): value is SettlementBorderKind {
  return typeof value === "string" && borderKinds.has(value as SettlementBorderKind);
}

function isBorderStatus(value: unknown): value is SettlementBorderStatus {
  return typeof value === "string" && borderStatuses.has(value as SettlementBorderStatus);
}

export function hasBuildingDefinition(value: unknown): value is SettlementBuildingKind {
  return isBuildingKind(value);
}

function settlementText(settlement: Settlement): string {
  return [
    settlement.region,
    settlement.biomeId,
    settlement.terrain,
    settlement.topography,
    ...settlement.resources,
    ...settlement.flora,
    ...settlement.fauna,
    ...settlement.localThreats,
    ...settlement.tags
  ].join(" ");
}

function textMatches(settlement: Settlement, pattern: RegExp): boolean {
  return pattern.test(settlementText(settlement));
}

function routeCountFor(world: World, settlementId: Id): number {
  return Object.values(world.planet?.routes ?? {}).filter((route) => route.fromId === settlementId || route.toId === settlementId).length;
}

function organizationsAt(world: World, settlementId: Id): number {
  return Object.values(world.organizations ?? {}).filter((organization) => organization.homeSettlementId === settlementId).length;
}

function woundedAt(world: World, settlementId: Id): number {
  return Object.values(world.persons).filter(
    (person) =>
      person.alive &&
      person.locationId === settlementId &&
      ((person.injuries ?? []).length > 0 || person.status.includes("wounded") || person.status.includes("bleeding"))
  ).length;
}

function remainsAt(world: World, settlementId: Id): number {
  return Object.values(world.remains ?? {}).filter(
    (record) =>
      record.locationId === settlementId &&
      (record.burialStatus === "unburied" || record.burialStatus === "retrieving" || record.hauntingStatus === "haunted" || record.hauntingStatus === "restless")
  ).length;
}

function hasFunctionalBuilding(settlement: Settlement, catalogId: SettlementBuildingKind): boolean {
  return (settlement.buildings ?? []).some(
    (building) => building.catalogId === catalogId && (building.status === "active" || building.status === "damaged")
  );
}

function hasOpenOrder(settlement: Settlement, catalogId: SettlementBuildingKind): boolean {
  return (settlement.buildOrders ?? []).some(
    (order) => order.catalogId === catalogId && (order.status === "queued" || order.status === "building" || order.status === "blocked")
  );
}

function buildingLevelFor(settlement: Settlement, catalogId: SettlementBuildingKind): number {
  if (catalogId === "housing") {
    return rounded(settlement.population / 330, 1, 5);
  }
  if (catalogId === "wall" || catalogId === "market" || catalogId === "guildhall") {
    return settlement.population >= 900 || settlement.prosperity >= 74 ? 2 : 1;
  }
  return 1;
}

function buildingIntegrityFor(settlement: Settlement, catalogId: SettlementBuildingKind): number {
  const defensiveBoost = buildingCatalog[catalogId].category === "defense" ? settlement.defense * 0.18 : settlement.prosperity * 0.12;
  return rounded(68 + defensiveBoost - settlement.threat * 0.1 - settlement.unrest * 0.06, 35, 100);
}

function createBuilding(settlement: Settlement, catalogId: SettlementBuildingKind, builtTick: number, progress = 100): SettlementBuilding {
  const definition = buildingCatalog[catalogId];
  const level = buildingLevelFor(settlement, catalogId);
  const integrity = buildingIntegrityFor(settlement, catalogId);
  const draft = { catalogId, level, integrity };
  return {
    id: stableId("building", [settlement.id, catalogId]),
    catalogId,
    kind: catalogId,
    category: definition.category,
    name: `${settlement.name} ${definition.name}`,
    status: "active",
    level,
    integrity,
    progress,
    upkeep: definition.upkeep,
    builtTick,
    tags: uniqueText([...definition.tags, settlement.biomeId, settlement.terrain, settlement.topography]),
    footprint: footprintFor(settlement, catalogId, level),
    occupantIds: [],
    services: servicesFor(settlement, draft),
    lastServiceTick: 0
  };
}

function initialBuildingIds(world: World, settlement: Settlement): SettlementBuildingKind[] {
  const ids: SettlementBuildingKind[] = ["housing", "well"];
  const routes = routeCountFor(world, settlement.id);
  const sector = world.geography?.sectors?.[settlement.sectorId];
  if (settlement.population >= 180 || textMatches(settlement, foodPattern)) {
    ids.push("granary");
  }
  if (settlement.prosperity >= 40 || routes > 0 || settlement.resources.length >= 3) {
    ids.push("market");
  }
  if (textMatches(settlement, craftPattern)) {
    ids.push("workshop");
  }
  if (textMatches(settlement, metalPattern) || settlement.tags.includes("mine")) {
    ids.push("forge");
  }
  if (textMatches(settlement, medicinePattern)) {
    ids.push("apothecary");
  }
  if (textMatches(settlement, sacredPattern) || settlement.unrest >= 28) {
    ids.push("temple");
  }
  if (settlement.threat >= 32 || textMatches(settlement, threatPattern)) {
    ids.push("watchtower");
  }
  if (settlement.defense >= 48 || settlement.threat >= 46) {
    ids.push("palisade");
  }
  if (routes >= 2 && settlement.prosperity >= 44) {
    ids.push("caravanserai");
  }
  if (settlement.population >= 640 || organizationsAt(world, settlement.id) > 0) {
    ids.push("guildhall");
  }
  if (sector?.kind === "coast" || sector?.kind === "island" || settlement.terrain === "riverlands" || textMatches(settlement, waterPattern)) {
    ids.push("dock");
  }
  return [...new Set(ids)];
}

function repairBuilding(settlement: Settlement, value: Partial<SettlementBuilding>): SettlementBuilding | undefined {
  const catalogId = isBuildingKind(value.catalogId) ? value.catalogId : isBuildingKind(value.kind) ? value.kind : undefined;
  if (!catalogId) {
    return undefined;
  }
  const definition = buildingCatalog[catalogId];
  const level = rounded(value.level ?? buildingLevelFor(settlement, catalogId), 1, 9);
  const integrity = rounded(value.integrity ?? buildingIntegrityFor(settlement, catalogId), 0, 100);
  const rawFootprint = value.footprint?.tileIds?.length ? value.footprint : footprintFor(settlement, catalogId, level);
  const footprint = repairBuildingFootprintForLocalMap(settlement, {
    tileIds: [...new Set((rawFootprint.tileIds ?? []).filter((id): id is Id => typeof id === "string" && id.length > 0))],
    width: Math.max(1, Math.round(rawFootprint.width)),
    height: Math.max(1, Math.round(rawFootprint.height)),
    anchorQ: Math.round(rawFootprint.anchorQ),
    anchorR: Math.round(rawFootprint.anchorR),
    layer: rawFootprint.layer ?? "surface"
  }).footprint;
  const services = servicesFor(settlement, { catalogId, level, integrity }, value.services ?? []);
  return {
    id: value.id || stableId("building", [settlement.id, catalogId]),
    catalogId,
    kind: catalogId,
    category: definition.category,
    name: value.name || `${settlement.name} ${definition.name}`,
    status: isBuildingStatus(value.status) ? value.status : "active",
    level,
    integrity,
    progress: rounded(value.progress ?? 100, 0, 100),
    upkeep: rounded(value.upkeep ?? definition.upkeep, 0, 999),
    builtTick: Math.max(0, Math.round(value.builtTick ?? 0)),
    tags: uniqueText([...(value.tags ?? []), ...definition.tags]),
    footprint,
    occupantIds: [...new Set((value.occupantIds ?? []).filter((id): id is Id => typeof id === "string" && id.length > 0))],
    services,
    lastServiceTick: Math.max(0, Math.round(value.lastServiceTick ?? 0))
  };
}

function borderTier(settlement: Settlement): SettlementBorderKind {
  if (settlement.population >= 1100 || settlement.prosperity >= 78) {
    return "city-edge";
  }
  if (settlement.population >= 700 || settlement.prosperity >= 62) {
    return "town-edge";
  }
  if (settlement.population >= 260 || settlement.prosperity >= 38) {
    return "village-edge";
  }
  return "hamlet-edge";
}

function borderStatusFor(settlement: Settlement, kind: SettlementBorderKind): SettlementBorderStatus {
  if (kind === "wall" || settlement.defense >= 72) {
    return "fortified";
  }
  if (kind === "palisade" || settlement.defense >= 42 || settlement.threat >= 45) {
    return "watched";
  }
  if (settlement.threat >= 82 && settlement.defense < 35) {
    return "breached";
  }
  return "open";
}

function makeBorder(settlement: Settlement, kind: SettlementBorderKind, existing?: Partial<SettlementBorder>): SettlementBorder {
  const name =
    kind === "wall"
      ? `${settlement.name} walls`
      : kind === "palisade"
        ? `${settlement.name} palisade`
        : kind === "district"
          ? existing?.name || `${settlement.name} district`
          : `${settlement.name} boundary`;
  const baseRadius = 0.022 + Math.min(0.055, settlement.population / 24000) + settlement.prosperity / 5000;
  const fortBonus = kind === "wall" ? 0.014 : kind === "palisade" ? 0.008 : 0;
  return {
    id: existing?.id || stableId("border", [settlement.id, kind]),
    kind,
    name,
    radius: Number(clamp(existing?.radius ?? baseRadius + fortBonus, 0.015, 0.12).toFixed(4)),
    integrity: rounded(existing?.integrity ?? 58 + settlement.defense * 0.34 - settlement.threat * 0.1, 0, 100),
    coverage: rounded(existing?.coverage ?? 52 + settlement.defense * 0.32 + fortBonus * 420 - settlement.unrest * 0.08, 0, 100),
    gateCount: rounded(existing?.gateCount ?? 1 + routeCountFallback(settlement) + settlement.population / 900, 1, 8),
    status: isBorderStatus(existing?.status) ? existing.status : borderStatusFor(settlement, kind),
    tags: uniqueText([...(existing?.tags ?? []), kind, settlement.terrain, settlement.topography])
  };
}

function routeCountFallback(settlement: Settlement): number {
  return settlement.tags.includes("market") || settlement.tags.includes("ford") ? 2 : 1;
}

function settlementRef(settlement: Settlement): LegalEntityRef {
  return { kind: "settlement", id: settlement.id };
}

function factionRef(settlement: Settlement): LegalEntityRef {
  return settlement.factionId ? { kind: "faction", id: settlement.factionId } : settlementRef(settlement);
}

function assetForCompletedBuilding(world: World, settlement: Settlement, building: SettlementBuilding): Asset | undefined {
  const kind = assetKindByBuilding[building.catalogId];
  if (!kind) {
    return undefined;
  }
  world.assets ??= {};
  const existing = Object.values(world.assets).find((asset) => asset.locationId === settlement.id && asset.kind === kind);
  const definition = buildingCatalog[building.catalogId];
  const outputTags = uniqueText([...assetOutputsByKind[kind], ...definition.tags, ...settlement.resources.slice(0, 3)]).slice(0, 8);
  if (existing) {
    existing.status = "active";
    existing.integrity = Math.max(existing.integrity, building.integrity);
    existing.value = Math.max(existing.value, Math.round(definition.cost + building.level * 12 + settlement.prosperity * 0.35));
    existing.outputTags = uniqueText([...existing.outputTags, ...outputTags]).slice(0, 8);
    existing.tags = uniqueText([...existing.tags, "settlement-building", building.catalogId, building.category]);
    return existing;
  }
  const asset: Asset = {
    id: stableId("asset", [settlement.id, kind, building.catalogId]),
    name: building.name,
    kind,
    status: "active",
    owner: factionRef(settlement),
    operator: settlementRef(settlement),
    locationId: settlement.id,
    value: Math.round(definition.cost + building.level * 12 + settlement.prosperity * 0.35),
    integrity: building.integrity,
    outputTags,
    tags: uniqueText(["settlement-building", building.catalogId, building.category, settlement.biomeId, settlement.terrain]),
    foundedTick: Math.max(0, building.builtTick)
  };
  world.assets[asset.id] = asset;
  return asset;
}

function refreshSettlementBorders(settlement: Settlement): void {
  const repaired = (settlement.borders ?? [])
    .map((border) => {
      const kind = isBorderKind(border.kind) ? border.kind : undefined;
      return kind ? makeBorder(settlement, kind, border) : undefined;
    })
    .filter((border): border is SettlementBorder => Boolean(border));
  const byKind = new Map(repaired.map((border) => [border.kind, border]));
  const baseKind = borderTier(settlement);
  const borders: SettlementBorder[] = [makeBorder(settlement, baseKind, byKind.get(baseKind))];
  if (hasFunctionalBuilding(settlement, "wall")) {
    borders.push(makeBorder(settlement, "wall", byKind.get("wall")));
  } else if (hasFunctionalBuilding(settlement, "palisade")) {
    borders.push(makeBorder(settlement, "palisade", byKind.get("palisade")));
  }
  const districts = repaired.filter((border) => border.kind === "district" && !borders.some((candidate) => candidate.id === border.id));
  settlement.borders = [...borders, ...districts];
}

function normalizeSettlementBuildingOccupants(world: World, settlement: Settlement): void {
  ensureLocalMapForSettlement(settlement, world.tick);
  const buildings = settlement.buildings ?? [];
  const buildingIds = new Set(buildings.map((building) => building.id));
  const retained = new Set<Id>();
  for (const building of buildings) {
    const footprint = building.footprint ?? footprintFor(settlement, building.catalogId, building.level);
    building.footprint = footprint;
    for (const service of building.services ?? []) {
      service.occupantIds = [...new Set(service.occupantIds)].filter((personId) => {
        const person = world.persons[personId];
        return Boolean(person?.alive && person.locationId === settlement.id);
      });
      service.occupantIds = service.occupantIds.slice(0, service.capacity);
      for (const personId of service.occupantIds) {
        const person = world.persons[personId];
        if (!person) {
          continue;
        }
        person.buildingId = building.id;
        person.currentService = service.kind;
        person.localTileId = repairPersonLocalTileForSettlement(settlement, person.localTileId, footprint.tileIds[0]);
        retained.add(person.id);
      }
    }
    building.occupantIds = [...new Set((building.services ?? []).flatMap((service) => service.occupantIds))];
  }
  for (const person of Object.values(world.persons)) {
    if (person.buildingId && buildingIds.has(person.buildingId) && !retained.has(person.id)) {
      delete person.buildingId;
      delete person.localTileId;
      delete person.currentService;
    }
  }
}

function repairLooseSettlementLocalTiles(world: World, settlement: Settlement): void {
  for (const person of Object.values(world.persons)) {
    if (!person.alive || person.locationId !== settlement.id || person.buildingId || !person.localTileId) {
      continue;
    }
    person.localTileId = repairPersonLocalTileForSettlement(settlement, person.localTileId);
  }
}

function repairBuildOrder(settlement: Settlement, value: Partial<SettlementBuildOrder>): SettlementBuildOrder | undefined {
  const catalogId = isBuildingKind(value.catalogId) ? value.catalogId : isBuildingKind(value.kind) ? value.kind : undefined;
  if (!catalogId) {
    return undefined;
  }
  const definition = buildingCatalog[catalogId];
  const laborRequired = Math.max(1, Math.round(value.laborRequired ?? definition.labor));
  const status = isOrderStatus(value.status) ? value.status : "queued";
  const laborInvested =
    status === "complete" ? laborRequired : clamp(Math.round(value.laborInvested ?? 0), 0, laborRequired);
  return {
    id: value.id || stableId("build-order", [settlement.id, catalogId, String(value.createdTick ?? 0)]),
    catalogId,
    kind: catalogId,
    category: definition.category,
    name: value.name || `Build ${definition.name}`,
    status,
    priority: rounded(value.priority ?? value.pressure ?? 50, 0, 150),
    pressure: rounded(value.pressure ?? value.priority ?? 50, 0, 150),
    reason: value.reason || `${settlement.name} needs ${definition.name}.`,
    progress: rounded(value.progress ?? (laborInvested / laborRequired) * 100, 0, 100),
    laborRequired,
    laborInvested,
    cost: rounded(value.cost ?? definition.cost, 0, 9999),
    createdTick: Math.max(0, Math.round(value.createdTick ?? 0)),
    startedTick: value.startedTick,
    completedTick: value.completedTick,
    tags: uniqueText([...(value.tags ?? []), ...definition.tags])
  };
}

function ensureFoundationBuildings(world: World, settlement: Settlement): void {
  if ((settlement.buildings ?? []).length > 0) {
    return;
  }
  const existing = new Set((settlement.buildings ?? []).map((building) => building.catalogId));
  const seeded = settlement.buildings ?? [];
  for (const catalogId of initialBuildingIds(world, settlement)) {
    if (!existing.has(catalogId)) {
      seeded.push(createBuilding(settlement, catalogId, 0));
      existing.add(catalogId);
    }
  }
  settlement.buildings = seeded;
}

export function ensureSettlementDevelopment(world: World): SettlementDevelopmentSnapshot {
  for (const settlement of Object.values(world.settlements)) {
    ensureLocalMapForSettlement(settlement, world.tick);
    const repairedBuildings = (settlement.buildings ?? [])
      .map((building) => repairBuilding(settlement, building))
      .filter((building): building is SettlementBuilding => Boolean(building));
    settlement.buildings = repairedBuildings;
    ensureFoundationBuildings(world, settlement);
    settlement.buildOrders = (settlement.buildOrders ?? [])
      .map((order) => repairBuildOrder(settlement, order))
      .filter((order): order is SettlementBuildOrder => Boolean(order));
    refreshSettlementBorders(settlement);
    normalizeSettlementBuildingOccupants(world, settlement);
    repairLooseSettlementLocalTiles(world, settlement);
  }
  return collectSettlementDevelopmentSnapshot(world);
}

function pressureSignal(
  settlement: Settlement,
  catalogId: SettlementBuildingKind,
  pressure: number,
  reason: string,
  tags: readonly string[]
): SettlementBuildSignal | undefined {
  const roundedPressure = rounded(pressure, 0, 150);
  if (roundedPressure <= 0) {
    return undefined;
  }
  const effects = buildingCatalog[catalogId].effects;
  const defenseCrisisBoost =
    buildingCatalog[catalogId].category === "defense" ? Math.max(0, settlement.threat - settlement.defense) * 0.45 : 0;
  return {
    id: stableId("build-signal", [settlement.id, catalogId, reason]),
    settlementId: settlement.id,
    catalogId,
    pressure: roundedPressure,
    priority: rounded(roundedPressure + (effects.defense ?? 0) * 0.4 + (effects.prosperity ?? 0) * 0.35 + defenseCrisisBoost, 0, 150),
    reason,
    tags: uniqueText([...tags, ...buildingCatalog[catalogId].tags])
  };
}

function candidateSignalsForSettlement(world: World, settlement: Settlement): SettlementBuildSignal[] {
  const signals: SettlementBuildSignal[] = [];
  const routes = routeCountFor(world, settlement.id);
  const faction = world.factions[settlement.factionId];
  const culture = faction ? world.cultures[faction.cultureId] : undefined;
  const sector = world.geography?.sectors?.[settlement.sectorId];
  const warPressure = (faction?.activeWars.length ?? 0) * 11;
  const injured = woundedAt(world, settlement.id);
  const restlessDead = remainsAt(world, settlement.id);
  const organizations = organizationsAt(world, settlement.id);
  const foodFit = textMatches(settlement, foodPattern);
  const craftFit = textMatches(settlement, craftPattern);
  const medicineFit = textMatches(settlement, medicinePattern);
  const sacredFit = textMatches(settlement, sacredPattern);
  const waterFit = textMatches(settlement, waterPattern) || sector?.kind === "coast" || sector?.kind === "island";
  const localThreatFit = textMatches(settlement, threatPattern) || settlement.localThreats.length > 2;
  const housingCapacity = (settlement.buildings ?? [])
    .filter((building) => building.catalogId === "housing" && building.status !== "ruined")
    .reduce((sum, building) => sum + building.level * 360, 0);

  signals.push(
    ...[
      pressureSignal(
        settlement,
        "housing",
        settlement.population > housingCapacity * 0.92 ? 48 + (settlement.population - housingCapacity) / 9 + settlement.unrest * 0.14 : 0,
        "population is pressing against available housing",
        ["housing", "population"]
      ),
      pressureSignal(
        settlement,
        "well",
        36 + settlement.population / 42 + (waterFit ? 6 : 0) + settlement.unrest * 0.08,
        "clean water keeps the settlement stable",
        ["water", "health"]
      ),
      pressureSignal(
        settlement,
        "granary",
        28 + settlement.population / 36 + settlement.threat * 0.22 + (foodFit ? 14 : 0) - settlement.prosperity * 0.04,
        "food storage would steady the settlement through shortages",
        ["food", "storage"]
      ),
      pressureSignal(
        settlement,
        "watchtower",
        24 + settlement.threat * 0.62 + (localThreatFit ? 16 : 0) + warPressure - settlement.defense * 0.12,
        "local threats need earlier warning",
        ["watch", "threat"]
      ),
      pressureSignal(
        settlement,
        "palisade",
        18 + settlement.threat * 0.72 + warPressure - settlement.defense * 0.18,
        "the border needs a first defensive ring",
        ["border", "defense"]
      ),
      pressureSignal(
        settlement,
        "wall",
        (hasFunctionalBuilding(settlement, "palisade") ? 20 : -24) + settlement.population / 28 + settlement.threat * 0.44 + warPressure,
        "the settlement is large or threatened enough to justify stone defenses",
        ["border", "defense", "stone"]
      ),
      pressureSignal(
        settlement,
        "gatehouse",
        (hasFunctionalBuilding(settlement, "wall") ? 28 : -16) + routes * 12 + settlement.threat * 0.22,
        "routes through the walls need controlled gates",
        ["border", "route"]
      ),
      pressureSignal(
        settlement,
        "barracks",
        12 + settlement.threat * 0.7 + warPressure + settlement.population / 55 - settlement.defense * 0.08,
        "organized fighters are needed for defense and patrols",
        ["soldiers", "defense"]
      ),
      pressureSignal(
        settlement,
        "market",
        22 + routes * 12 + settlement.resources.length * 5 + settlement.prosperity * 0.22,
        "resources and travelers need a place to trade",
        ["trade", "resources"]
      ),
      pressureSignal(
        settlement,
        "caravanserai",
        routes >= 2 ? 28 + routes * 15 + settlement.threat * 0.15 + settlement.prosperity * 0.08 : 0,
        "long routes need beds, stables, and guards",
        ["trade", "routes"]
      ),
      pressureSignal(
        settlement,
        "dock",
        waterFit ? 34 + routes * 5 + settlement.prosperity * 0.15 + settlement.population / 60 : 0,
        "water access can become a working harbor",
        ["water", "travel"]
      ),
      pressureSignal(
        settlement,
        "workshop",
        28 + (craftFit ? 22 : 0) + settlement.resources.length * 4 + settlement.prosperity * 0.12,
        "craft goods and repairs need dedicated benches",
        ["craft", "tools"]
      ),
      pressureSignal(
        settlement,
        "forge",
        12 + (textMatches(settlement, metalPattern) ? 34 : 0) + (craftFit ? 10 : 0) + settlement.defense * 0.08,
        "metal goods and weapons need a proper forge",
        ["craft", "metal"]
      ),
      pressureSignal(
        settlement,
        "apothecary",
        24 + injured * 18 + (medicineFit ? 18 : 0) + settlement.threat * 0.14,
        "wounds and useful herbs justify a healer's shop",
        ["medicine", "health"]
      ),
      pressureSignal(
        settlement,
        "temple",
        22 + settlement.unrest * 0.52 + (sacredFit ? 18 : 0) + (culture?.tradition ?? 0) * 0.08,
        "ritual authority could calm unrest and preserve culture",
        ["faith", "culture"]
      ),
      pressureSignal(
        settlement,
        "graveyard",
        24 + restlessDead * 22 + settlement.unrest * 0.16 + (sacredFit ? 8 : 0),
        "the dead need a place to be claimed and kept quiet",
        ["dead", "rest"]
      ),
      pressureSignal(
        settlement,
        "school",
        18 + settlement.population / 42 + (culture ? Math.max(0, 38 - culture.level * 6) : 12) + settlement.prosperity * 0.08,
        "children and apprentices need organized instruction",
        ["children", "learning"]
      ),
      pressureSignal(
        settlement,
        "library",
        (hasFunctionalBuilding(settlement, "school") ? 16 : -18) + (culture?.research.progress ?? 0) * 0.08 + settlement.prosperity * 0.28,
        "research and records need a protected archive",
        ["records", "research"]
      ),
      pressureSignal(
        settlement,
        "guildhall",
        18 + organizations * 18 + settlement.prosperity * 0.28 + routes * 5,
        "collective interests need a hall for charters and disputes",
        ["guild", "politics"]
      )
    ].filter((signal): signal is SettlementBuildSignal => Boolean(signal))
  );
  return signals;
}

export function collectSettlementBuildSignals(world: World, options: SettlementBuildSignalOptions = {}): SettlementBuildSignal[] {
  ensureSettlementDevelopment(world);
  const minPressure = options.minPressure ?? 52;
  const maxSignals = options.maxSignals ?? 12;
  const maxPerSettlement = options.maxPerSettlement ?? 2;
  const counts = new Map<Id, number>();
  const signals = Object.values(world.settlements)
    .flatMap((settlement) =>
      candidateSignalsForSettlement(world, settlement).filter((signal) => {
        if (signal.pressure < minPressure) {
          return false;
        }
        if (hasFunctionalBuilding(settlement, signal.catalogId)) {
          return false;
        }
        if (!options.includeQueued && hasOpenOrder(settlement, signal.catalogId)) {
          return false;
        }
        return true;
      })
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.pressure - left.pressure ||
        left.settlementId.localeCompare(right.settlementId) ||
        left.catalogId.localeCompare(right.catalogId)
    );
  const selected: SettlementBuildSignal[] = [];
  for (const signal of signals) {
    const count = counts.get(signal.settlementId) ?? 0;
    if (count >= maxPerSettlement) {
      continue;
    }
    selected.push(signal);
    counts.set(signal.settlementId, count + 1);
    if (selected.length >= maxSignals) {
      break;
    }
  }
  return selected;
}

function orderFromSignal(world: World, signal: SettlementBuildSignal): SettlementBuildOrder | undefined {
  const settlement = world.settlements[signal.settlementId];
  if (!settlement) {
    return undefined;
  }
  const definition = buildingCatalog[signal.catalogId];
  return {
    id: stableId("build-order", [settlement.id, signal.catalogId, String(world.tick)]),
    catalogId: signal.catalogId,
    kind: signal.catalogId,
    category: definition.category,
    name: `Build ${definition.name}`,
    status: "queued",
    priority: signal.priority,
    pressure: signal.pressure,
    reason: signal.reason,
    progress: 0,
    laborRequired: definition.labor,
    laborInvested: 0,
    cost: definition.cost,
    createdTick: world.tick,
    tags: uniqueText([...signal.tags, "collective-ai"])
  };
}

export function issueSettlementBuildOrders(world: World, options: SettlementBuildOrderOptions = {}): SettlementBuildOrder[] {
  ensureSettlementDevelopment(world);
  const maxNewOrders = options.maxNewOrders ?? 3;
  const issued: SettlementBuildOrder[] = [];
  for (const signal of collectSettlementBuildSignals(world, options)) {
    if (issued.length >= maxNewOrders) {
      break;
    }
    const settlement = world.settlements[signal.settlementId];
    if (!settlement || hasFunctionalBuilding(settlement, signal.catalogId) || hasOpenOrder(settlement, signal.catalogId)) {
      continue;
    }
    const order = orderFromSignal(world, signal);
    if (!order) {
      continue;
    }
    settlement.buildOrders = [...(settlement.buildOrders ?? []), order];
    issued.push(order);
  }
  return issued;
}

function constructionLaborFor(world: World, settlement: Settlement): number {
  const organizations = organizationsAt(world, settlement.id);
  const labor = 6 + settlement.population / 150 + settlement.prosperity / 18 + organizations * 1.5 - settlement.threat / 32 - settlement.unrest / 46;
  return clamp(Math.round(labor), 2, 24);
}

function personAvailableForBuilding(world: World, person: Person, settlementId: Id): boolean {
  const band = person.bandId ? world.bands[person.bandId] : undefined;
  return person.alive && person.locationId === settlementId && !band?.travel;
}

function clearSettlementBuildingAssignments(world: World, settlement: Settlement): void {
  const buildingIds = new Set((settlement.buildings ?? []).map((building) => building.id));
  for (const person of Object.values(world.persons)) {
    if (person.buildingId && buildingIds.has(person.buildingId)) {
      delete person.buildingId;
      delete person.localTileId;
      delete person.currentService;
    }
  }
  for (const building of settlement.buildings ?? []) {
    building.occupantIds = [];
    for (const service of building.services ?? []) {
      service.occupantIds = [];
    }
  }
}

function serviceNeedScore(person: Person, service: SettlementBuildingService, building: SettlementBuilding): number {
  const missingHp = Math.max(0, person.maxHp - person.hp);
  const wounded = (person.injuries ?? []).length > 0 || person.status.includes("wounded") || person.status.includes("bleeding");
  const child = person.age < 16 || person.status.includes("child");
  if (service.kind === "medicine") {
    return (wounded ? 90 : 0) + missingHp * 2 + person.skills.medicine * 0.08;
  }
  if (service.kind === "rest") {
    return person.fatigue * 0.9 + missingHp * 0.45 + (child ? 10 : 0);
  }
  if (service.kind === "shelter") {
    return 35 + person.fatigue * 0.35 + (child ? 24 : 0) + (person.morale < 45 ? 18 : 0);
  }
  if (service.kind === "watch") {
    return person.skills.survival * 0.24 + person.skills.command * 0.14 + person.stats.derived.perception * 0.14 + (building.category === "defense" ? 8 : 0);
  }
  if (service.kind === "training") {
    return person.skills.blade * 0.16 + person.skills.command * 0.2 + person.traits.ambition * 0.12;
  }
  if (service.kind === "craft" || service.kind === "repair") {
    return person.skills.survival * 0.18 + person.stats.derived.dexterity * 0.16 + person.stats.derived.intelligence * 0.14 + person.traits.curiosity * 0.08;
  }
  if (service.kind === "learning") {
    return person.stats.derived.intelligence * 0.26 + person.stats.derived.wisdom * 0.16 + person.traits.curiosity * 0.18 + (child ? 18 : 0);
  }
  if (service.kind === "ritual" || service.kind === "burial") {
    return person.skills.ward * 0.22 + person.skills.sorcery * 0.12 + person.stats.derived.wisdom * 0.16 + (person.morale < 40 ? 14 : 0);
  }
  if (service.kind === "trade" || service.kind === "governance") {
    return person.skills.diplomacy * 0.22 + person.skills.command * 0.16 + person.stats.derived.charisma * 0.16 + person.traits.ambition * 0.08;
  }
  if (service.kind === "travel") {
    return person.skills.survival * 0.18 + person.stats.derived.endurance * 0.14 + person.fatigue * 0.2;
  }
  return 1;
}

function applyServiceEffect(person: Person, settlement: Settlement, service: SettlementBuildingService): boolean {
  const before = `${person.hp}:${person.fatigue}:${person.morale}:${person.gold}:${settlement.unrest}`;
  const quality = service.quality / 100;
  if (service.kind === "medicine") {
    person.hp = rounded(person.hp + 1 + quality * 3, 0, person.maxHp);
    person.fatigue = rounded(person.fatigue - 1, 0, 100);
    if (person.hp > person.maxHp * 0.35) {
      person.status = person.status.filter((status) => status !== "bleeding");
    }
  } else if (service.kind === "rest" || service.kind === "shelter") {
    person.fatigue = rounded(person.fatigue - (service.kind === "rest" ? 5 : 3) - quality * 2, 0, 100);
    person.morale = rounded(person.morale + 1 + quality, 0, 100);
    if (person.hp < person.maxHp && service.kind === "rest") {
      person.hp = rounded(person.hp + 1, 0, person.maxHp);
    }
  } else if (service.kind === "training") {
    person.skills.blade = rounded(person.skills.blade + quality * 0.35, 0, 100);
    person.skills.command = rounded(person.skills.command + quality * 0.2, 0, 100);
    person.fatigue = rounded(person.fatigue + 1, 0, 100);
  } else if (service.kind === "learning") {
    person.skills.ward = rounded(person.skills.ward + quality * 0.18, 0, 100);
    person.skills.medicine = rounded(person.skills.medicine + quality * 0.12, 0, 100);
    person.morale = rounded(person.morale + (person.traits.curiosity > 55 ? 1 : 0), 0, 100);
  } else if (service.kind === "craft" || service.kind === "repair") {
    person.gold = Math.max(0, person.gold + (service.kind === "craft" ? 1 : 0));
    person.fatigue = rounded(person.fatigue + 1, 0, 100);
  } else if (service.kind === "trade") {
    person.gold = Math.max(0, person.gold + 1);
    person.morale = rounded(person.morale + 1, 0, 100);
  } else if (service.kind === "ritual" || service.kind === "burial") {
    person.morale = rounded(person.morale + 1 + quality, 0, 100);
    settlement.unrest = rounded(settlement.unrest - quality, 0, 100);
  } else if (service.kind === "governance") {
    settlement.unrest = rounded(settlement.unrest - quality * 0.7, 0, 100);
  } else if (service.kind === "watch") {
    settlement.threat = rounded(settlement.threat - quality * 0.3, 0, 100);
  } else if (service.kind === "travel") {
    person.fatigue = rounded(person.fatigue - 1, 0, 100);
  }
  return before !== `${person.hp}:${person.fatigue}:${person.morale}:${person.gold}:${settlement.unrest}`;
}

export function updateSettlementBuildingServices(world: World, options: SettlementServiceSimulationOptions = {}): SettlementServiceSimulationResult {
  ensureSettlementDevelopment(world);
  const cadenceTicks = Math.max(1, Math.round(options.cadenceTicks ?? 12));
  if (world.tick % cadenceTicks !== 0) {
    return { servicedBuildings: 0, occupiedServiceSlots: 0, affectedPeople: 0 };
  }
  const maxOccupantsPerBuilding = options.maxOccupantsPerBuilding ?? 32;
  let servicedBuildings = 0;
  let occupiedServiceSlots = 0;
  let affectedPeople = 0;

  for (const settlement of Object.values(world.settlements)) {
    const localPeople = Object.values(world.persons)
      .filter((person) => personAvailableForBuilding(world, person, settlement.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    clearSettlementBuildingAssignments(world, settlement);
    if (!localPeople.length) {
      continue;
    }
    const assigned = new Set<Id>();
    const buildings = (settlement.buildings ?? [])
      .filter((building) => building.status === "active" || building.status === "damaged")
      .sort((a, b) => b.level - a.level || a.catalogId.localeCompare(b.catalogId));

    for (const building of buildings) {
      const footprint = building.footprint ?? footprintFor(settlement, building.catalogId, building.level);
      building.footprint = footprint;
      building.services = servicesFor(settlement, building, building.services ?? []);
      let buildingOccupants = 0;
      for (const service of building.services) {
        if (world.tick - service.lastSimulatedTick < service.cadenceTicks && service.lastSimulatedTick !== 0) {
          continue;
        }
        const capacity = Math.min(service.capacity, maxOccupantsPerBuilding - buildingOccupants);
        if (capacity <= 0) {
          break;
        }
        const occupants = localPeople
          .filter((person) => !assigned.has(person.id))
          .map((person) => ({ person, score: serviceNeedScore(person, service, building) }))
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score || left.person.id.localeCompare(right.person.id))
          .slice(0, capacity)
          .map((entry) => entry.person);
        service.occupantIds = occupants.map((person) => person.id);
        service.lastSimulatedTick = world.tick;
        for (const person of occupants) {
          assigned.add(person.id);
          person.buildingId = building.id;
          person.localTileId = footprint.tileIds[0];
          person.currentService = service.kind;
          if (applyServiceEffect(person, settlement, service)) {
            affectedPeople += 1;
          }
        }
        buildingOccupants += occupants.length;
        occupiedServiceSlots += occupants.length;
      }
      building.occupantIds = [...new Set((building.services ?? []).flatMap((service) => service.occupantIds))];
      if (building.occupantIds.length > 0) {
        building.lastServiceTick = world.tick;
        servicedBuildings += 1;
      }
    }
  }

  return { servicedBuildings, occupiedServiceSlots, affectedPeople };
}

function completeOrder(world: World, settlement: Settlement, order: SettlementBuildOrder): void {
  const definition = buildingCatalog[order.catalogId];
  order.status = "complete";
  order.completedTick = world.tick;
  order.progress = 100;
  order.laborInvested = order.laborRequired;
  const building = createBuilding(settlement, order.catalogId, world.tick);
  settlement.buildings = [...(settlement.buildings ?? []).filter((candidate) => candidate.catalogId !== order.catalogId), building];
  assetForCompletedBuilding(world, settlement, building);
  settlement.defense = rounded(settlement.defense + (definition.effects.defense ?? 0), 0, 100);
  settlement.prosperity = rounded(settlement.prosperity + (definition.effects.prosperity ?? 0), 0, 100);
  settlement.unrest = rounded(settlement.unrest + (definition.effects.unrest ?? 0), 0, 100);
  settlement.threat = rounded(settlement.threat + (definition.effects.threat ?? 0), 0, 100);
  const cultureId = world.factions[settlement.factionId]?.cultureId;
  const culture = cultureId ? world.cultures[cultureId] : undefined;
  if (culture && definition.effects.culture) {
    culture.research.progress = Math.max(0, culture.research.progress + definition.effects.culture);
  }
  refreshSettlementBorders(settlement);
}

export function advanceSettlementConstruction(
  world: World,
  options: SettlementConstructionOptions = {}
): Pick<SettlementConstructionUpdate, "started" | "completed"> {
  ensureSettlementDevelopment(world);
  const maxActivePerSettlement = options.maxActivePerSettlement ?? 1;
  let started = 0;
  const completed: SettlementBuildOrder[] = [];
  for (const settlement of Object.values(world.settlements)) {
    const orders = settlement.buildOrders ?? [];
    const activeCount = orders.filter((order) => order.status === "building").length;
    if (activeCount < maxActivePerSettlement) {
      const next = orders
        .filter((order) => order.status === "queued")
        .sort((left, right) => right.priority - left.priority || left.createdTick - right.createdTick || left.id.localeCompare(right.id))[0];
      if (next) {
        next.status = "building";
        next.startedTick ??= world.tick;
        started += 1;
      }
    }
    const labor = constructionLaborFor(world, settlement);
    for (const order of orders.filter((candidate) => candidate.status === "building")) {
      if (hasFunctionalBuilding(settlement, order.catalogId)) {
        order.status = "complete";
        order.completedTick ??= world.tick;
        order.progress = 100;
        continue;
      }
      order.laborInvested = clamp(order.laborInvested + labor, 0, order.laborRequired);
      order.progress = rounded((order.laborInvested / order.laborRequired) * 100, 0, 100);
      if (order.laborInvested >= order.laborRequired) {
        completeOrder(world, settlement, order);
        completed.push(order);
      }
    }
  }
  return { started, completed };
}

export function updateSettlementDevelopment(world: World, options: SettlementDevelopmentUpdateOptions = {}): SettlementConstructionUpdate {
  ensureSettlementDevelopment(world);
  const issueCadenceTicks = Math.max(1, Math.round(options.issueCadenceTicks ?? 30));
  const buildCadenceTicks = Math.max(1, Math.round(options.buildCadenceTicks ?? 6));
  const serviceCadenceTicks = Math.max(1, Math.round(options.serviceCadenceTicks ?? 12));
  const issued = world.tick % issueCadenceTicks === 0 ? issueSettlementBuildOrders(world, options) : [];
  const progress =
    world.tick % buildCadenceTicks === 0 ? advanceSettlementConstruction(world, options) : { started: 0, completed: [] as SettlementBuildOrder[] };
  const services = updateSettlementBuildingServices(world, { cadenceTicks: serviceCadenceTicks });
  return {
    issued,
    started: progress.started,
    completed: progress.completed,
    servicedBuildings: services.servicedBuildings,
    occupiedServiceSlots: services.occupiedServiceSlots,
    affectedPeople: services.affectedPeople
  };
}

export function collectSettlementDevelopmentSnapshot(world: World): SettlementDevelopmentSnapshot {
  const settlements = Object.values(world.settlements);
  const buildingSettlementIds = new Map<Id, Id>();
  const buildings = settlements.flatMap((settlement) =>
    (settlement.buildings ?? []).map((building) => {
      buildingSettlementIds.set(building.id, settlement.id);
      return building;
    })
  );
  const serviceBuildingIds = new Map<SettlementBuildingService, Id>();
  const services = buildings.flatMap((building) =>
    (building.services ?? []).map((service) => {
      serviceBuildingIds.set(service, building.id);
      return service;
    })
  );
  const borders = settlements.flatMap((settlement) => settlement.borders ?? []);
  const orders = settlements.flatMap((settlement) => settlement.buildOrders ?? []);
  return {
    settlements: settlements.length,
    catalogSize: buildingCatalogList.length,
    buildings: buildings.length,
    activeBuildings: buildings.filter((building) => building.status === "active").length,
    damagedBuildings: buildings.filter((building) => building.status === "damaged" || building.status === "ruined").length,
    borders: borders.length,
    fortifiedBorders: borders.filter((border) => border.status === "fortified" || border.kind === "wall" || border.kind === "palisade").length,
    fortifiedSettlements: settlements.filter((settlement) => (settlement.borders ?? []).some((border) => border.kind === "wall" || border.kind === "palisade")).length,
    buildOrders: orders.length,
    queuedBuildOrders: orders.filter((order) => order.status === "queued").length,
    activeBuildOrders: orders.filter((order) => order.status === "building").length,
    completedBuildOrders: orders.filter((order) => order.status === "complete").length,
    serviceSlots: services.length,
    serviceCapacity: services.reduce((sum, service) => sum + service.capacity, 0),
    occupiedServiceSlots: services.reduce(
      (sum, service) =>
        sum +
        service.occupantIds.filter((personId) => {
          const person = world.persons[personId];
          const buildingId = serviceBuildingIds.get(service);
          return Boolean(person?.alive && buildingId && person.locationId === buildingSettlementIds.get(buildingId));
        }).length,
      0
    ),
    housedPeople: new Set(
      buildings.flatMap((building) =>
        (building.occupantIds ?? []).filter((personId) => {
          const person = world.persons[personId];
          return Boolean(person?.alive && person.buildingId === building.id && person.locationId === buildingSettlementIds.get(building.id));
        })
      )
    ).size
  };
}

export function validateSettlementDevelopment(world: World): string[] {
  const issues: string[] = [];
  const buildingFootprints = new Map<Id, Set<Id>>();
  for (const settlement of Object.values(world.settlements)) {
    issues.push(...validateSettlementLocalMap(settlement));
    const buildingIds = new Set<Id>();
    for (const building of settlement.buildings ?? []) {
      if (!hasBuildingDefinition(building.catalogId)) {
        issues.push(`${settlement.name} has unknown building ${building.catalogId}`);
      }
      if (buildingIds.has(building.id)) {
        issues.push(`${settlement.name} has duplicate building id ${building.id}`);
      }
      buildingIds.add(building.id);
      if (!Number.isFinite(building.integrity) || building.integrity < 0 || building.integrity > 100) {
        issues.push(`${settlement.name} building ${building.name} has invalid integrity ${building.integrity}`);
      }
      if (!building.footprint?.tileIds.length || building.footprint.width <= 0 || building.footprint.height <= 0) {
        issues.push(`${settlement.name} building ${building.name} has invalid footprint`);
      } else {
        buildingFootprints.set(building.id, new Set(building.footprint.tileIds));
      }
      for (const service of building.services ?? []) {
        if (service.capacity < 0 || service.occupantIds.length > service.capacity) {
          issues.push(`${settlement.name} building ${building.name} overfills ${service.kind}`);
        }
        for (const occupantId of service.occupantIds) {
          const person = world.persons[occupantId];
          if (!person || !person.alive) {
            issues.push(`${settlement.name} building ${building.name} houses missing occupant ${occupantId}`);
          }
        }
      }
    }
    for (const order of settlement.buildOrders ?? []) {
      if (!hasBuildingDefinition(order.catalogId)) {
        issues.push(`${settlement.name} has unknown build order ${order.catalogId}`);
      }
      if (order.laborRequired <= 0 || order.laborInvested < 0 || order.laborInvested > order.laborRequired) {
        issues.push(`${settlement.name} build order ${order.name} has invalid labor ${order.laborInvested}/${order.laborRequired}`);
      }
    }
    for (const border of settlement.borders ?? []) {
      if (!isBorderKind(border.kind)) {
        issues.push(`${settlement.name} has unknown border ${border.kind}`);
      }
      if (!Number.isFinite(border.radius) || border.radius <= 0 || border.coverage < 0 || border.coverage > 100) {
        issues.push(`${settlement.name} border ${border.name} has invalid geometry`);
      }
    }
  }
  for (const person of Object.values(world.persons)) {
    if (!person.alive || !person.buildingId) {
      continue;
    }
    const footprint = buildingFootprints.get(person.buildingId);
    if (!footprint) {
      issues.push(`${person.name} ${person.familyName} points at missing building ${person.buildingId}`);
    } else if (person.localTileId && !footprint.has(person.localTileId)) {
      issues.push(`${person.name} ${person.familyName} points at non-footprint tile ${person.localTileId}`);
    }
  }
  return issues.slice(0, 24);
}

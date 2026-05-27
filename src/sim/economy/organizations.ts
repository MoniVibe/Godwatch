import { average, clamp } from "../core/math";
import type {
  CultureState,
  Faction,
  Id,
  IdentityAxes,
  IdentityAxisKey,
  Person,
  QuestKind,
  Settlement,
  TerrainHolding,
  TravelRoute,
  World,
  WorldFeature
} from "../types";

// Integration assumptions:
// - Godwatch does not yet persist organization economy state on World.
// - These helpers are pure snapshots over existing world data and can be called from createWorld, repairLoadedWorld, or tickWorld later.
// - The lane models ownership pressure, asset risk, and outlook. It intentionally does not model prices, inventories, or a full market.

export type OrganizationKind =
  | "miners-guild"
  | "caravan-league"
  | "temple-chapter"
  | "apothecary-circle"
  | "gravewarden-order"
  | "craft-guild"
  | "charter-company";

export type BusinessAssetKind =
  | "mine"
  | "outpost"
  | "underground-fortress"
  | "cavern-town"
  | "sky-dock"
  | "sealed-vault"
  | "resource-prospect"
  | "caravan-route"
  | "temple"
  | "apothecary"
  | "graveyard"
  | "workshop"
  | "charter-hall";

export type BusinessAssetPressureKind =
  | "worker-shortage"
  | "guard-shortage"
  | "repair-backlog"
  | "claim-survey"
  | "charter-sanction"
  | "waystation-support"
  | "ritual-calm"
  | "offering-shortfall"
  | "herb-supply"
  | "glassware-supply"
  | "mine-fauna"
  | "haunted-graveyard"
  | "caravan-route-danger"
  | "temple-unrest"
  | "apothecary-herb-shortage"
  | "resource-depletion"
  | "wildcat-claim"
  | "weather-exposure"
  | "public-distrust";

export type OrganizationSignalKind =
  | "request-guards"
  | "request-escorts"
  | "request-herbs"
  | "request-wardens"
  | "call-mediation"
  | "repair-asset"
  | "settle-charter"
  | "recruit-labor"
  | "survey-claim";

export interface BusinessAssetPressure {
  kind: BusinessAssetPressureKind;
  severity: number;
  reason: string;
  sourceIds: Id[];
  tags: string[];
}

export interface BusinessAsset {
  id: Id;
  name: string;
  kind: BusinessAssetKind;
  factionId: Id;
  cultureId?: Id;
  settlementId?: Id;
  routeId?: Id;
  featureId?: Id;
  holdingId?: Id;
  outputFocus: string;
  value: number;
  reliability: number;
  needs: BusinessAssetPressure[];
  threats: BusinessAssetPressure[];
  tags: string[];
}

export interface OrganizationCharter {
  text: string;
  riskTolerance: number;
  publicMandate: number;
  secrecy: number;
  extraction: number;
  tradition: number;
  tradeReach: number;
  axes: Partial<Record<IdentityAxisKey, number>>;
  tags: string[];
}

export interface OrganizationOutlookDriver {
  kind: "charter" | "culture" | "leader" | "members" | "assets";
  sourceId?: Id;
  weight: number;
  axes: Partial<Record<IdentityAxisKey, number>>;
  reason: string;
}

export interface OrganizationOutlook {
  axes: IdentityAxes;
  pressure: number;
  dominant: string[];
  drivers: OrganizationOutlookDriver[];
}

export interface GuildOrganization {
  id: Id;
  name: string;
  kind: OrganizationKind;
  factionId: Id;
  cultureId?: Id;
  homeSettlementId: Id;
  charter: OrganizationCharter;
  leaderPersonId?: Id;
  memberPersonIds: Id[];
  assetIds: Id[];
  influence: number;
  solvency: number;
  outlook: OrganizationOutlook;
  tags: string[];
}

export interface OrganizationEconomyState {
  generatedAtTick: number;
  assets: Record<Id, BusinessAsset>;
  organizations: Record<Id, GuildOrganization>;
  integrationAssumptions: string[];
}

export interface OrganizationSeedOptions {
  includeHiddenFeatures?: boolean;
  includeSettlementServiceAssets?: boolean;
  maxSignals?: number;
  signalThreshold?: number;
}

export interface OrganizationTickSignal {
  id: Id;
  organizationId: Id;
  assetId: Id;
  factionId: Id;
  settlementId?: Id;
  kind: OrganizationSignalKind;
  priority: "low" | "medium" | "high";
  pressure: number;
  questKind: QuestKind;
  text: string;
  tags: string[];
}

export interface OrganizationTickResult {
  previousTick?: number;
  next: OrganizationEconomyState;
  signals: OrganizationTickSignal[];
}

export const organizationIntegrationAssumptions = [
  "Organization state is locally derived until World gains a persistent organizations field.",
  "Assets point at existing settlement, route, feature, holding, faction, culture, and person ids.",
  "Tick helpers emit deterministic signals for future quest/event hooks and do not mutate World.",
  "No price, wage, supply-chain, or full market simulation is implemented in this lane."
];

const axisKeys: IdentityAxisKey[] = [
  "evilGood",
  "corruptPure",
  "authoritarianEgalitarian",
  "warlikePeaceful",
  "materialistSpiritualist",
  "vengefulForgiving",
  "cravenBold",
  "mightMagic"
];

const axisLabels: Record<IdentityAxisKey, { negative: string; positive: string }> = {
  evilGood: { negative: "self-serving", positive: "public-minded" },
  corruptPure: { negative: "compromised", positive: "clean-handed" },
  authoritarianEgalitarian: { negative: "hierarchical", positive: "member-led" },
  warlikePeaceful: { negative: "hard-handed", positive: "peaceable" },
  materialistSpiritualist: { negative: "materialist", positive: "spiritualist" },
  vengefulForgiving: { negative: "punitive", positive: "reconciliatory" },
  cravenBold: { negative: "risk-averse", positive: "bold" },
  mightMagic: { negative: "practical", positive: "arcane" }
};

const organizationKindLabels: Record<OrganizationKind, string> = {
  "miners-guild": "Miners Guild",
  "caravan-league": "Caravan League",
  "temple-chapter": "Temple Chapter",
  "apothecary-circle": "Apothecary Circle",
  "gravewarden-order": "Gravewarden Order",
  "craft-guild": "Craft Guild",
  "charter-company": "Charter Company"
};

const organizationRoots: Record<OrganizationKind, string[]> = {
  "miners-guild": ["Deep Ledger", "Stone Bell", "Vein Compact", "Hammer Table"],
  "caravan-league": ["Road Bell", "Waymark League", "Bridge Ledger", "Wagon Oath"],
  "temple-chapter": ["Witness House", "Ash Chapter", "Candle Court", "Bell Rite"],
  "apothecary-circle": ["Green Mortar", "Root Glass", "Amber Bowl", "Quiet Cure"],
  "gravewarden-order": ["Last Gate", "Moon Spade", "Silent Ward", "Salt Lantern"],
  "craft-guild": ["Brass Measure", "Hearth Loom", "Seven Tools", "Kiln Oath"],
  "charter-company": ["Ink Seal", "Toll House", "Public Measure", "Market Bell"]
};

function neutralAxes(): IdentityAxes {
  return {
    evilGood: 0,
    corruptPure: 0,
    authoritarianEgalitarian: 0,
    warlikePeaceful: 0,
    materialistSpiritualist: 0,
    vengefulForgiving: 0,
    cravenBold: 0,
    mightMagic: 0
  };
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableId(prefix: string, parts: readonly string[]): Id {
  return `${prefix}-${stableHash(parts.join("|")).toString(36)}`;
}

function stablePick<T>(items: readonly T[], key: string): T {
  return items[stableHash(key) % items.length];
}

function byId<T extends { id: Id }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function bySeverity(left: BusinessAssetPressure, right: BusinessAssetPressure): number {
  return right.severity - left.severity || left.kind.localeCompare(right.kind);
}

function keyed<T extends { id: Id }>(items: readonly T[]): Record<Id, T> {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<Id, T>;
}

function rounded(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function cultureForFaction(world: World, factionId: Id | undefined): CultureState | undefined {
  const faction = factionId ? world.factions[factionId] : undefined;
  return faction ? world.cultures[faction.cultureId] : undefined;
}

function settlementForAsset(world: World, asset: Pick<BusinessAsset, "settlementId" | "routeId" | "featureId">): Settlement | undefined {
  if (asset.settlementId) {
    return world.settlements[asset.settlementId];
  }
  if (asset.featureId) {
    const feature = world.planet.features[asset.featureId];
    return feature ? world.settlements[feature.nearestSettlementId] : undefined;
  }
  if (asset.routeId) {
    const route = world.planet.routes[asset.routeId];
    return route ? world.settlements[route.fromId] : undefined;
  }
  return undefined;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function listText(values: readonly string[], fallback: string): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) {
    return fallback;
  }
  return unique.slice(0, 3).join(", ");
}

function hasAnyText(values: readonly string[], patterns: readonly RegExp[]): boolean {
  const text = values.join(" ").toLowerCase();
  return patterns.some((pattern) => pattern.test(text));
}

function pressure(
  kind: BusinessAssetPressureKind,
  severity: number,
  reason: string,
  sourceIds: Id[],
  tags: string[],
  minimum = 12
): BusinessAssetPressure | undefined {
  const bounded = rounded(severity);
  if (bounded < minimum) {
    return undefined;
  }
  return {
    kind,
    severity: bounded,
    reason: cleanText(reason),
    sourceIds: [...new Set(sourceIds.filter(Boolean))],
    tags: [...new Set(tags.filter(Boolean))]
  };
}

function addPressure(
  list: BusinessAssetPressure[],
  kind: BusinessAssetPressureKind,
  severity: number,
  reason: string,
  sourceIds: Id[],
  tags: string[],
  minimum?: number
): void {
  const item = pressure(kind, severity, reason, sourceIds, tags, minimum);
  if (item) {
    list.push(item);
  }
}

function assetPressureScore(asset: Pick<BusinessAsset, "needs" | "threats">): number {
  const values = [...asset.needs.map((need) => need.severity * 0.55), ...asset.threats.map((threat) => threat.severity)];
  return rounded(average(values));
}

function reliabilityFor(needs: BusinessAssetPressure[], threats: BusinessAssetPressure[], base = 82): number {
  const needDrag = average(needs.map((need) => need.severity)) * 0.28;
  const threatDrag = average(threats.map((threat) => threat.severity)) * 0.48;
  return rounded(base - needDrag - threatDrag);
}

function routeSponsor(world: World, route: TravelRoute): Id {
  const from = world.settlements[route.fromId];
  const to = world.settlements[route.toId];
  if (!from || !to) {
    return "";
  }
  if (from.factionId === to.factionId) {
    return from.factionId;
  }
  const fromFaction = world.factions[from.factionId];
  const toFaction = world.factions[to.factionId];
  const fromScore = (fromFaction?.wealth ?? 0) + from.prosperity * 0.7 + (fromFaction?.kind === "guild" ? 16 : 0);
  const toScore = (toFaction?.wealth ?? 0) + to.prosperity * 0.7 + (toFaction?.kind === "guild" ? 16 : 0);
  if (fromScore === toScore) {
    return from.factionId.localeCompare(to.factionId) <= 0 ? from.factionId : to.factionId;
  }
  return fromScore > toScore ? from.factionId : to.factionId;
}

function assetCultureId(world: World, factionId: Id): Id | undefined {
  return world.factions[factionId]?.cultureId;
}

function holdingAsset(world: World, holding: TerrainHolding): BusinessAsset | undefined {
  const feature = world.planet.features[holding.featureId];
  const settlement = feature ? world.settlements[feature.nearestSettlementId] : undefined;
  const faction = world.factions[holding.factionId];
  if (!feature || !settlement || !faction) {
    return undefined;
  }

  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "worker-shortage",
    48 - holding.workers * 0.08 + holding.level * 2,
    `${holding.name} needs steadier crews to work ${feature.name}.`,
    [holding.id, feature.id, settlement.id],
    ["labor", holding.kind],
    18
  );
  addPressure(
    needs,
    "guard-shortage",
    feature.danger * 0.45 + Math.max(0, 24 - holding.garrison) * 1.6,
    `${holding.name} needs guards before ${listText(feature.threats, "local threats")} reach the work face.`,
    [holding.id, feature.id],
    ["guards", holding.kind],
    18
  );
  addPressure(
    needs,
    "repair-backlog",
    70 - holding.integrity,
    `${holding.name} has damaged works and loose supports.`,
    [holding.id],
    ["repair", holding.kind],
    20
  );

  if (holding.kind === "mine" || feature.kind === "ore-vein" || feature.kind === "crystal-seam") {
    addPressure(
      threats,
      "mine-fauna",
      feature.danger * 0.55 + feature.fauna.length * 6 + Math.max(0, 45 - holding.garrison) * 0.25,
      `${holding.name} is exposed to mine fauna: ${listText(feature.fauna, "deep vermin")}.`,
      [holding.id, feature.id],
      ["fauna", "mine", feature.layer],
      25
    );
  }
  addPressure(
    threats,
    "resource-depletion",
    feature.depletion * 0.8 + Math.max(0, 100 - feature.richness) * 0.18,
    `${feature.name} is losing yield around ${holding.outputResource}.`,
    [holding.id, feature.id],
    ["depletion", holding.outputResource],
    32
  );

  const value = rounded(holding.level * 16 + feature.richness * 0.62 + holding.stockpile * 0.08 + faction.wealth * 0.2);
  return {
    id: `asset-holding-${holding.id}`,
    name: holding.name,
    kind: holding.kind,
    factionId: holding.factionId,
    cultureId: assetCultureId(world, holding.factionId),
    settlementId: settlement.id,
    featureId: feature.id,
    holdingId: holding.id,
    outputFocus: holding.outputResource || feature.resources[0] || "ore",
    value,
    reliability: reliabilityFor(needs, threats, holding.status === "damaged" ? 58 : holding.status === "building" ? 64 : 82),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set([holding.kind, feature.kind, feature.layer, settlement.terrain, settlement.elevationBand, ...feature.resources.slice(0, 2)])]
  };
}

function featureProspectAsset(world: World, feature: WorldFeature, includeHiddenFeatures: boolean): BusinessAsset | undefined {
  if (feature.holdingId || feature.status === "depleted" || (!includeHiddenFeatures && feature.status === "hidden")) {
    return undefined;
  }
  const settlement = world.settlements[feature.nearestSettlementId];
  if (!settlement) {
    return undefined;
  }
  const factionId = feature.ownerFactionId ?? settlement.factionId;
  if (!world.factions[factionId]) {
    return undefined;
  }

  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "claim-survey",
    38 + Math.max(0, 64 - feature.exploration) * 0.55 + (feature.status === "hidden" ? 24 : 0),
    `${feature.name} needs a survey before claims and crews can be trusted.`,
    [feature.id, settlement.id],
    ["survey", feature.kind],
    18
  );
  if (!feature.ownerFactionId) {
    addPressure(
      needs,
      "charter-sanction",
      42 + settlement.unrest * 0.18,
      `${feature.name} lacks a settled charter near ${settlement.name}.`,
      [feature.id, settlement.id],
      ["charter", "claim"],
      20
    );
  }
  addPressure(
    threats,
    "wildcat-claim",
    (feature.status === "claimed" ? 18 : 42) + settlement.unrest * 0.34 + feature.richness * 0.18,
    `Unauthorised claimants circle ${feature.name}.`,
    [feature.id, settlement.id],
    ["claim", feature.kind],
    32
  );
  if (feature.kind === "ore-vein" || feature.kind === "crystal-seam" || feature.kind === "cavern") {
    addPressure(
      threats,
      "mine-fauna",
      feature.danger * 0.5 + feature.fauna.length * 5,
      `${feature.name} prospectors report ${listText(feature.fauna, "burrowing beasts")}.`,
      [feature.id],
      ["fauna", "prospect", feature.layer],
      25
    );
  }

  return {
    id: `asset-feature-${feature.id}`,
    name: `${feature.name} Claim`,
    kind: "resource-prospect",
    factionId,
    cultureId: assetCultureId(world, factionId),
    settlementId: settlement.id,
    featureId: feature.id,
    outputFocus: feature.resources[0] ?? feature.kind.replace("-", " "),
    value: rounded(feature.richness * 0.72 + feature.exploration * 0.22 + settlement.prosperity * 0.18),
    reliability: reliabilityFor(needs, threats, feature.status === "claimed" ? 78 : 62),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["prospect", feature.kind, feature.layer, feature.status, ...feature.resources.slice(0, 2)])]
  };
}

function routeAsset(world: World, route: TravelRoute): BusinessAsset | undefined {
  const from = world.settlements[route.fromId];
  const to = world.settlements[route.toId];
  if (!from || !to) {
    return undefined;
  }
  const factionId = routeSponsor(world, route);
  if (!factionId) {
    return undefined;
  }

  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "guard-shortage",
    route.danger * 0.48 + route.passDifficulty * 0.16,
    `Guards are needed on the road between ${from.name} and ${to.name}.`,
    [route.id, from.id, to.id],
    ["guards", "route"],
    22
  );
  addPressure(
    needs,
    "waystation-support",
    route.distance * 0.18 + route.passDifficulty * 0.24,
    `Waystations are thin along the ${route.terrain} route from ${from.name} to ${to.name}.`,
    [route.id, from.id, to.id],
    ["waystation", route.terrain, route.topography],
    24
  );
  addPressure(
    threats,
    "caravan-route-danger",
    route.danger * 0.78 + route.passDifficulty * 0.2 + Math.max(0, route.distance - 50) * 0.05,
    `Caravan route danger is high between ${from.name} and ${to.name}.`,
    [route.id, from.id, to.id],
    ["caravan", "route", route.terrain, route.elevationBand],
    26
  );
  addPressure(
    threats,
    "weather-exposure",
    route.elevationBand === "high" || route.elevationBand === "alpine" ? 44 + route.passDifficulty * 0.24 : route.passDifficulty * 0.22,
    `Weather and pass exposure threaten caravans on the ${route.topography} road.`,
    [route.id],
    ["weather", route.elevationBand],
    34
  );

  return {
    id: `asset-route-${route.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    name: `${from.name}-${to.name} Caravan Road`,
    kind: "caravan-route",
    factionId,
    cultureId: assetCultureId(world, factionId),
    settlementId: from.factionId === factionId ? from.id : to.factionId === factionId ? to.id : from.id,
    routeId: route.id,
    outputFocus: "safe passage",
    value: rounded((from.population + to.population) / 50 + (from.prosperity + to.prosperity) * 0.24 + route.distance * 0.05),
    reliability: reliabilityFor(needs, threats, 78),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["route", "caravan", route.terrain, route.topography, route.elevationBand, from.factionId === to.factionId ? "internal" : "cross-border"])]
  };
}

function templeAsset(world: World, settlement: Settlement): BusinessAsset {
  const culture = cultureForFaction(world, settlement.factionId);
  const faction = world.factions[settlement.factionId];
  const spiritualPressure = culture?.values.materialistSpiritualist ?? (faction?.kind === "cult" ? 32 : 0);
  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "ritual-calm",
    settlement.unrest * 0.54 + Math.max(0, 42 - (culture?.cohesion ?? 50)) * 0.48,
    `${settlement.name}'s temple needs public rites to quiet faction strain.`,
    [settlement.id, culture?.id ?? ""],
    ["temple", "ritual"],
    18
  );
  addPressure(
    needs,
    "offering-shortfall",
    Math.max(0, 48 - settlement.prosperity) * 0.62 + Math.max(0, 24 - spiritualPressure) * 0.18,
    `${settlement.name}'s offerings lag behind temple obligations.`,
    [settlement.id],
    ["temple", "offerings"],
    24
  );
  addPressure(
    threats,
    "temple-unrest",
    settlement.unrest * 0.86 + Math.max(0, 44 - (culture?.cohesion ?? 50)) * 0.3 + Math.max(0, 34 - (faction?.stability ?? 50)) * 0.34,
    `Temple unrest is rising in ${settlement.name}.`,
    [settlement.id, faction?.id ?? ""],
    ["temple", "unrest"],
    28
  );
  addPressure(
    threats,
    "public-distrust",
    Math.max(0, settlement.unrest - settlement.prosperity) * 0.7 + Math.max(0, 40 - (culture?.tradition ?? 50)) * 0.28,
    `Public trust around the temple in ${settlement.name} is brittle.`,
    [settlement.id],
    ["trust", "temple"],
    30
  );

  return {
    id: `asset-temple-${settlement.id}`,
    name: `${settlement.name} Temple Chapter House`,
    kind: "temple",
    factionId: settlement.factionId,
    cultureId: culture?.id,
    settlementId: settlement.id,
    outputFocus: "rites and legitimacy",
    value: rounded(settlement.population / 55 + settlement.prosperity * 0.3 + Math.max(0, spiritualPressure) * 0.22),
    reliability: reliabilityFor(needs, threats, 82),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["temple", settlement.terrain, faction?.kind ?? "", spiritualPressure > 20 ? "spiritualist" : "civic"])]
  };
}

function apothecaryAsset(world: World, settlement: Settlement): BusinessAsset {
  const herbPatterns = [/herb/, /root/, /moss/, /mushroom/, /poppy/, /amber/, /ash/, /reed/, /flower/, /resin/];
  const herbSources = [...settlement.flora, ...settlement.resources];
  const herbScore = herbSources.filter((item) => hasAnyText([item], herbPatterns)).length;
  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "herb-supply",
    Math.max(0, 4 - herbScore) * 16 + settlement.threat * 0.12 + Math.max(0, 44 - settlement.prosperity) * 0.24,
    `${settlement.name}'s apothecaries need steadier herb supply.`,
    [settlement.id],
    ["apothecary", "herbs"],
    16
  );
  addPressure(
    needs,
    "glassware-supply",
    Math.max(0, 54 - settlement.prosperity) * 0.35 + (settlement.resources.some((resource) => resource.toLowerCase().includes("glass")) ? 0 : 18),
    `${settlement.name}'s apothecaries lack reliable vessels and clean glass.`,
    [settlement.id],
    ["apothecary", "glassware"],
    26
  );
  addPressure(
    threats,
    "apothecary-herb-shortage",
    Math.max(0, 5 - herbScore) * 18 + settlement.threat * 0.2 + Math.max(0, 48 - settlement.prosperity) * 0.32,
    `Apothecary herb shortage threatens care in ${settlement.name}.`,
    [settlement.id],
    ["apothecary", "herb-shortage"],
    24
  );

  return {
    id: `asset-apothecary-${settlement.id}`,
    name: `${settlement.name} Apothecary Store`,
    kind: "apothecary",
    factionId: settlement.factionId,
    cultureId: assetCultureId(world, settlement.factionId),
    settlementId: settlement.id,
    outputFocus: herbScore > 0 ? listText(herbSources, "common remedies") : "common remedies",
    value: rounded(settlement.population / 70 + settlement.prosperity * 0.25 + herbScore * 9),
    reliability: reliabilityFor(needs, threats, 78),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["apothecary", "medicine", settlement.biomeId, ...herbSources.slice(0, 3)])]
  };
}

function graveyardAsset(world: World, settlement: Settlement): BusinessAsset {
  const culture = cultureForFaction(world, settlement.factionId);
  const deathPatterns = [/ghost/, /wight/, /ghoul/, /dead/, /grave/, /curse/, /haunt/, /shade/, /relic/, /ash/];
  const haunted = hasAnyText([...settlement.localThreats, ...settlement.tags, settlement.terrain, settlement.biomeId], deathPatterns);
  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "ritual-calm",
    settlement.unrest * 0.34 + Math.max(0, 44 - (culture?.tradition ?? 50)) * 0.38,
    `${settlement.name}'s burial ground needs witness rites and ward upkeep.`,
    [settlement.id, culture?.id ?? ""],
    ["graveyard", "rites"],
    16
  );
  addPressure(
    threats,
    "haunted-graveyard",
    (haunted ? 42 : 10) + settlement.threat * 0.52 + settlement.unrest * 0.22 + (settlement.terrain === "ruins" ? 18 : 0),
    `Haunted graveyard rumors gather around ${settlement.name}.`,
    [settlement.id],
    ["graveyard", "haunted", settlement.terrain],
    haunted ? 20 : 46
  );

  return {
    id: `asset-graveyard-${settlement.id}`,
    name: `${settlement.name} Burial Ground`,
    kind: "graveyard",
    factionId: settlement.factionId,
    cultureId: culture?.id,
    settlementId: settlement.id,
    outputFocus: "burial rights",
    value: rounded(settlement.population / 90 + (culture?.tradition ?? 40) * 0.22 + settlement.unrest * 0.08),
    reliability: reliabilityFor(needs, threats, 80),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["graveyard", settlement.terrain, settlement.biomeId, haunted ? "haunted" : "quiet"])]
  };
}

function workshopAsset(world: World, settlement: Settlement): BusinessAsset {
  const culture = cultureForFaction(world, settlement.factionId);
  const craftResources = settlement.resources.filter((resource) => /ore|iron|wood|amber|quartz|glass|ash|salt|hide|wool|bone/i.test(resource));
  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "worker-shortage",
    Math.max(0, 420 - settlement.population) * 0.04 + Math.max(0, 52 - settlement.prosperity) * 0.3,
    `${settlement.name}'s workshops need more trained hands.`,
    [settlement.id],
    ["workshop", "labor"],
    18
  );
  addPressure(
    threats,
    "public-distrust",
    settlement.unrest * 0.34 + Math.max(0, 36 - (culture?.cohesion ?? 50)) * 0.24,
    `Guild measures and workshop dues are disputed in ${settlement.name}.`,
    [settlement.id],
    ["workshop", "dues"],
    36
  );

  return {
    id: `asset-workshop-${settlement.id}`,
    name: `${settlement.name} Workshop Yards`,
    kind: "workshop",
    factionId: settlement.factionId,
    cultureId: culture?.id,
    settlementId: settlement.id,
    outputFocus: craftResources[0] ?? "tools",
    value: rounded(settlement.prosperity * 0.46 + settlement.population / 60 + craftResources.length * 8 + (culture?.level ?? 1) * 3),
    reliability: reliabilityFor(needs, threats, 84),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["workshop", "craft", settlement.terrain, ...craftResources.slice(0, 3)])]
  };
}

function charterHallAsset(world: World, settlement: Settlement): BusinessAsset {
  const faction = world.factions[settlement.factionId];
  const needs: BusinessAssetPressure[] = [];
  const threats: BusinessAssetPressure[] = [];
  addPressure(
    needs,
    "charter-sanction",
    Math.max(0, 54 - settlement.defense) * 0.18 + settlement.unrest * 0.4 + (faction?.kind === "guild" ? 0 : 12),
    `${settlement.name}'s charters need witnesses, seals, and enforcement.`,
    [settlement.id, faction?.id ?? ""],
    ["charter", "law"],
    18
  );
  addPressure(
    threats,
    "public-distrust",
    settlement.unrest * 0.62 + Math.max(0, 42 - (faction?.stability ?? 50)) * 0.34,
    `Business charters are losing public trust in ${settlement.name}.`,
    [settlement.id, faction?.id ?? ""],
    ["charter", "trust"],
    32
  );

  return {
    id: `asset-charter-${settlement.id}`,
    name: `${settlement.name} Charter Hall`,
    kind: "charter-hall",
    factionId: settlement.factionId,
    cultureId: assetCultureId(world, settlement.factionId),
    settlementId: settlement.id,
    outputFocus: "contracts and dues",
    value: rounded(settlement.population / 65 + settlement.prosperity * 0.42 + (faction?.wealth ?? 0) * 0.18),
    reliability: reliabilityFor(needs, threats, 86),
    needs: needs.sort(bySeverity),
    threats: threats.sort(bySeverity),
    tags: [...new Set(["charter", "business", faction?.kind ?? "", settlement.terrain])]
  };
}

function seedSettlementAssets(world: World): BusinessAsset[] {
  const assets: BusinessAsset[] = [];
  for (const settlement of byId(Object.values(world.settlements))) {
    assets.push(templeAsset(world, settlement));
    assets.push(apothecaryAsset(world, settlement));
    assets.push(graveyardAsset(world, settlement));
    if (settlement.resources.length > 0 || settlement.prosperity >= 45) {
      assets.push(workshopAsset(world, settlement));
    }
    if (settlement.prosperity >= 42 || world.factions[settlement.factionId]?.kind === "guild") {
      assets.push(charterHallAsset(world, settlement));
    }
  }
  return assets;
}

export function seedBusinessAssets(world: World, options: OrganizationSeedOptions = {}): BusinessAsset[] {
  const assets: BusinessAsset[] = [];
  for (const holding of byId(Object.values(world.planet.holdings ?? {}))) {
    const asset = holdingAsset(world, holding);
    if (asset) {
      assets.push(asset);
    }
  }
  for (const feature of byId(Object.values(world.planet.features ?? {}))) {
    const asset = featureProspectAsset(world, feature, Boolean(options.includeHiddenFeatures));
    if (asset) {
      assets.push(asset);
    }
  }
  for (const route of byId(Object.values(world.planet.routes ?? {}))) {
    const asset = routeAsset(world, route);
    if (asset) {
      assets.push(asset);
    }
  }
  if (options.includeSettlementServiceAssets ?? true) {
    assets.push(...seedSettlementAssets(world));
  }
  return byId(assets);
}

function charterAxes(kind: OrganizationKind, faction: Faction, assetPressure: number): Partial<Record<IdentityAxisKey, number>> {
  const factionAuthority = faction.kind === "barony" ? -16 : faction.kind === "freehold" ? 16 : faction.kind === "guild" ? 4 : faction.kind === "cult" ? -10 : -6;
  if (kind === "miners-guild") {
    return {
      evilGood: -4,
      authoritarianEgalitarian: factionAuthority - 8,
      warlikePeaceful: -12,
      materialistSpiritualist: -34,
      cravenBold: 16 + assetPressure * 0.08,
      mightMagic: -24
    };
  }
  if (kind === "caravan-league") {
    return {
      evilGood: 8,
      authoritarianEgalitarian: factionAuthority + 8,
      warlikePeaceful: 10,
      materialistSpiritualist: -22,
      vengefulForgiving: 8,
      cravenBold: 12,
      mightMagic: -10
    };
  }
  if (kind === "temple-chapter") {
    return {
      evilGood: 18,
      corruptPure: faction.kind === "cult" ? -6 : 16,
      authoritarianEgalitarian: factionAuthority - 4,
      warlikePeaceful: 8,
      materialistSpiritualist: 42,
      vengefulForgiving: 12,
      mightMagic: 18
    };
  }
  if (kind === "apothecary-circle") {
    return {
      evilGood: 24,
      corruptPure: 12,
      authoritarianEgalitarian: factionAuthority + 10,
      warlikePeaceful: 18,
      materialistSpiritualist: 4,
      vengefulForgiving: 22,
      cravenBold: -4,
      mightMagic: 6
    };
  }
  if (kind === "gravewarden-order") {
    return {
      evilGood: 12,
      corruptPure: 22,
      authoritarianEgalitarian: factionAuthority - 4,
      warlikePeaceful: 6,
      materialistSpiritualist: 28,
      vengefulForgiving: 18,
      cravenBold: 8,
      mightMagic: 18
    };
  }
  if (kind === "craft-guild") {
    return {
      evilGood: 2,
      corruptPure: 6,
      authoritarianEgalitarian: factionAuthority,
      warlikePeaceful: 2,
      materialistSpiritualist: -28,
      cravenBold: 6,
      mightMagic: -8
    };
  }
  return {
    evilGood: -2,
    corruptPure: 2,
    authoritarianEgalitarian: factionAuthority - 6,
    warlikePeaceful: 6,
    materialistSpiritualist: -18,
    vengefulForgiving: -2,
    cravenBold: 4,
    mightMagic: -12
  };
}

function makeCharter(kind: OrganizationKind, faction: Faction, assets: readonly BusinessAsset[]): OrganizationCharter {
  const pressureScore = rounded(average(assets.map(assetPressureScore)));
  const assetTags = [...new Set(assets.flatMap((asset) => asset.tags))];
  const extraction = kind === "miners-guild" ? 74 : kind === "charter-company" ? 62 : kind === "craft-guild" ? 48 : 28;
  const publicMandate = kind === "temple-chapter" || kind === "apothecary-circle" || kind === "gravewarden-order" ? 74 : kind === "caravan-league" ? 58 : 38;
  const tradeReach = kind === "caravan-league" ? 82 : kind === "charter-company" ? 66 : kind === "craft-guild" ? 48 : 24;
  const secrecy = kind === "gravewarden-order" ? 44 : kind === "temple-chapter" && faction.kind === "cult" ? 58 : kind === "miners-guild" ? 28 : 18;
  const riskTolerance = rounded(42 + pressureScore * 0.22 + (kind === "miners-guild" || kind === "caravan-league" ? 18 : 0));
  const tradition = rounded((kind === "temple-chapter" || kind === "gravewarden-order" ? 62 : 34) + (faction.stability - 50) * 0.18);
  const assetFocus = listText(assets.map((asset) => asset.outputFocus), "local business");
  return {
    text: `${organizationKindLabels[kind]} chartered under ${faction.name} to steward ${assetFocus}.`,
    riskTolerance,
    publicMandate,
    secrecy,
    extraction,
    tradition,
    tradeReach,
    axes: charterAxes(kind, faction, pressureScore),
    tags: [...new Set([kind, faction.kind, ...assetTags.slice(0, 6)])]
  };
}

function scorePersonForOrganization(person: Person, kind: OrganizationKind, homeSettlementId: Id): number {
  const local = person.locationId === homeSettlementId ? 18 : 0;
  const leader = person.role === "leader" ? 12 : 0;
  const commoner = person.role === "commoner" ? -8 : 0;
  if (kind === "miners-guild") {
    return local + leader + commoner + person.skills.survival * 0.8 + person.skills.command * 0.32 + person.traits.bravery * 0.22 + person.traits.ambition * 0.2 + person.renown * 0.4;
  }
  if (kind === "caravan-league") {
    return local + leader + commoner + person.skills.survival * 0.48 + person.skills.diplomacy * 0.62 + person.skills.command * 0.36 + person.traits.caution * 0.2 + person.renown * 0.35;
  }
  if (kind === "temple-chapter") {
    return local + leader + person.skills.ward * 0.62 + person.skills.diplomacy * 0.36 + person.skills.medicine * 0.26 + person.traits.mercy * 0.28 + person.traits.loyalty * 0.18 + person.renown * 0.36;
  }
  if (kind === "apothecary-circle") {
    return local + leader + commoner + person.skills.medicine * 0.82 + person.skills.survival * 0.36 + person.traits.curiosity * 0.22 + person.traits.mercy * 0.18 + person.renown * 0.2;
  }
  if (kind === "gravewarden-order") {
    return local + leader + person.skills.ward * 0.58 + person.skills.command * 0.28 + person.skills.medicine * 0.22 + person.traits.loyalty * 0.22 + person.traits.bravery * 0.18 + person.renown * 0.28;
  }
  if (kind === "craft-guild") {
    return local + leader + commoner + person.skills.survival * 0.48 + person.skills.medicine * 0.18 + person.skills.command * 0.24 + person.traits.curiosity * 0.2 + person.traits.ambition * 0.2 + person.renown * 0.24;
  }
  return local + leader + person.skills.diplomacy * 0.5 + person.skills.command * 0.48 + person.traits.ambition * 0.24 + person.traits.loyalty * 0.16 + person.renown * 0.32;
}

function rankedPeople(world: World, factionId: Id, kind: OrganizationKind, homeSettlementId: Id): Person[] {
  return Object.values(world.persons)
    .filter((person) => person.alive && person.factionId === factionId)
    .sort((left, right) => {
      const score = scorePersonForOrganization(right, kind, homeSettlementId) - scorePersonForOrganization(left, kind, homeSettlementId);
      return score || left.id.localeCompare(right.id);
    });
}

function chooseHomeSettlement(world: World, faction: Faction, assets: readonly BusinessAsset[]): Id {
  const counts = new Map<Id, number>();
  for (const asset of assets) {
    const settlement = settlementForAsset(world, asset);
    if (settlement) {
      counts.set(settlement.id, (counts.get(settlement.id) ?? 0) + Math.max(1, asset.value / 20));
    }
  }
  const best = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  return best ?? faction.capitalId;
}

function organizationName(kind: OrganizationKind, faction: Faction, home: Settlement | undefined): string {
  const root = stablePick(organizationRoots[kind], `${kind}|${faction.id}|${home?.id ?? ""}`);
  const place = home?.name ?? faction.name;
  if (kind === "charter-company") {
    return `${place} ${root}`;
  }
  return `${root} ${organizationKindLabels[kind]}`;
}

function averageAxes(people: readonly Person[]): Partial<Record<IdentityAxisKey, number>> {
  if (people.length === 0) {
    return {};
  }
  const axes: Partial<Record<IdentityAxisKey, number>> = {};
  for (const key of axisKeys) {
    axes[key] = Math.round(average(people.map((person) => person.identity[key] ?? 0)));
  }
  return axes;
}

function pressureAxesFor(kind: BusinessAssetPressureKind, severity: number): Partial<Record<IdentityAxisKey, number>> {
  const scale = severity / 100;
  if (kind === "mine-fauna") {
    return { warlikePeaceful: -34 * scale, cravenBold: 24 * scale, mightMagic: -10 * scale };
  }
  if (kind === "haunted-graveyard") {
    return { evilGood: -8 * scale, corruptPure: -32 * scale, materialistSpiritualist: 28 * scale, mightMagic: 22 * scale };
  }
  if (kind === "caravan-route-danger") {
    return { warlikePeaceful: -28 * scale, cravenBold: 18 * scale, materialistSpiritualist: -12 * scale };
  }
  if (kind === "temple-unrest") {
    return { corruptPure: -18 * scale, authoritarianEgalitarian: -12 * scale, vengefulForgiving: -18 * scale };
  }
  if (kind === "apothecary-herb-shortage") {
    return { evilGood: 18 * scale, warlikePeaceful: 12 * scale, vengefulForgiving: 18 * scale, cravenBold: -10 * scale };
  }
  if (kind === "public-distrust" || kind === "wildcat-claim") {
    return { corruptPure: -18 * scale, authoritarianEgalitarian: 12 * scale, vengefulForgiving: -12 * scale };
  }
  if (kind === "charter-sanction" || kind === "claim-survey") {
    return { authoritarianEgalitarian: -12 * scale, materialistSpiritualist: -8 * scale };
  }
  if (kind === "ritual-calm" || kind === "offering-shortfall") {
    return { materialistSpiritualist: 14 * scale, warlikePeaceful: 10 * scale };
  }
  if (kind === "resource-depletion" || kind === "repair-backlog") {
    return { materialistSpiritualist: -12 * scale, cravenBold: -8 * scale };
  }
  return { cravenBold: -6 * scale };
}

function assetOutlookAxes(assets: readonly BusinessAsset[]): Partial<Record<IdentityAxisKey, number>> {
  const pressures = assets.flatMap((asset) => [...asset.needs, ...asset.threats]);
  if (pressures.length === 0) {
    return {};
  }
  const totals: Partial<Record<IdentityAxisKey, number>> = {};
  const weights: Partial<Record<IdentityAxisKey, number>> = {};
  for (const item of pressures) {
    const axes = pressureAxesFor(item.kind, item.severity);
    for (const key of axisKeys) {
      const value = axes[key];
      if (value === undefined) {
        continue;
      }
      const weight = Math.max(1, item.severity / 20);
      totals[key] = (totals[key] ?? 0) + value * weight;
      weights[key] = (weights[key] ?? 0) + weight;
    }
  }
  const result: Partial<Record<IdentityAxisKey, number>> = {};
  for (const key of axisKeys) {
    const weight = weights[key] ?? 0;
    if (weight > 0) {
      result[key] = Math.round((totals[key] ?? 0) / weight);
    }
  }
  return result;
}

function weightedOutlook(drivers: OrganizationOutlookDriver[]): OrganizationOutlook {
  const axes = neutralAxes();
  for (const key of axisKeys) {
    let total = 0;
    let weightTotal = 0;
    for (const driver of drivers) {
      const value = driver.axes[key];
      if (value === undefined) {
        continue;
      }
      total += value * driver.weight;
      weightTotal += driver.weight;
    }
    axes[key] = weightTotal > 0 ? clamp(Math.round(total / weightTotal), -100, 100) : 0;
  }
  const dominant = axisKeys
    .map((key) => ({ key, value: axes[key] }))
    .filter((entry) => Math.abs(entry.value) >= 12)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value) || left.key.localeCompare(right.key))
    .slice(0, 3)
    .map((entry) => (entry.value < 0 ? axisLabels[entry.key].negative : axisLabels[entry.key].positive));
  return {
    axes,
    pressure: rounded(average(axisKeys.map((key) => Math.abs(axes[key])))),
    dominant,
    drivers
  };
}

export function deriveOrganizationOutlook(world: World, organization: Omit<GuildOrganization, "outlook">, assetsById: Record<Id, BusinessAsset>): OrganizationOutlook {
  const assets = organization.assetIds.map((id) => assetsById[id]).filter((asset): asset is BusinessAsset => Boolean(asset));
  const culture = organization.cultureId ? world.cultures[organization.cultureId] : cultureForFaction(world, organization.factionId);
  const leader = organization.leaderPersonId ? world.persons[organization.leaderPersonId] : undefined;
  const members = organization.memberPersonIds.map((id) => world.persons[id]).filter((person): person is Person => Boolean(person));
  const drivers: OrganizationOutlookDriver[] = [
    {
      kind: "charter",
      sourceId: organization.id,
      weight: 0.36,
      axes: organization.charter.axes,
      reason: organization.charter.text
    }
  ];
  if (culture) {
    drivers.push({
      kind: "culture",
      sourceId: culture.id,
      weight: 0.24,
      axes: culture.values,
      reason: `${culture.name} culture pressure`
    });
  }
  if (leader) {
    drivers.push({
      kind: "leader",
      sourceId: leader.id,
      weight: 0.22,
      axes: leader.identity,
      reason: `${leader.name} ${leader.familyName} leads the organization`
    });
  }
  if (members.length > 0) {
    drivers.push({
      kind: "members",
      weight: 0.14,
      axes: averageAxes(members),
      reason: `${members.length} named members shape practice`
    });
  }
  const assetAxes = assetOutlookAxes(assets);
  if (Object.keys(assetAxes).length > 0) {
    drivers.push({
      kind: "assets",
      weight: 0.12,
      axes: assetAxes,
      reason: "asset needs and threats create operating pressure"
    });
  }
  return weightedOutlook(drivers);
}

function makeOrganization(world: World, kind: OrganizationKind, faction: Faction, assets: readonly BusinessAsset[], assetsById: Record<Id, BusinessAsset>): GuildOrganization | undefined {
  if (assets.length === 0) {
    return undefined;
  }
  const homeSettlementId = chooseHomeSettlement(world, faction, assets);
  const home = world.settlements[homeSettlementId];
  const cultureId = faction.cultureId || assets.find((asset) => asset.cultureId)?.cultureId;
  const people = rankedPeople(world, faction.id, kind, homeSettlementId);
  const leader = people[0];
  const memberLimit = clamp(2 + Math.ceil(assets.length / 2), 2, 8);
  const members = people.filter((person) => person.id !== leader?.id).slice(0, memberLimit);
  const id = stableId("org", [kind, faction.id, homeSettlementId]);
  const charter = makeCharter(kind, faction, assets);
  const influence = rounded(faction.wealth * 0.28 + faction.stability * 0.18 + average(assets.map((asset) => asset.value)) * 0.48 + assets.length * 3);
  const solvency = rounded(faction.wealth * 0.38 + average(assets.map((asset) => asset.reliability)) * 0.52 - average(assets.map(assetPressureScore)) * 0.24);
  const withoutOutlook: Omit<GuildOrganization, "outlook"> = {
    id,
    name: organizationName(kind, faction, home),
    kind,
    factionId: faction.id,
    cultureId,
    homeSettlementId,
    charter,
    leaderPersonId: leader?.id,
    memberPersonIds: members.map((member) => member.id),
    assetIds: assets.map((asset) => asset.id).sort(),
    influence,
    solvency,
    tags: [...new Set([kind, faction.kind, ...(home ? [home.terrain, home.biomeId] : []), ...charter.tags.slice(0, 6)])]
  };
  return {
    ...withoutOutlook,
    outlook: deriveOrganizationOutlook(world, withoutOutlook, assetsById)
  };
}

function assetsForOrganization(kind: OrganizationKind, factionAssets: readonly BusinessAsset[]): BusinessAsset[] {
  if (kind === "miners-guild") {
    return factionAssets.filter((asset) => ["mine", "resource-prospect", "underground-fortress", "cavern-town", "sealed-vault"].includes(asset.kind));
  }
  if (kind === "caravan-league") {
    return factionAssets.filter((asset) => asset.kind === "caravan-route" || asset.kind === "sky-dock");
  }
  if (kind === "temple-chapter") {
    return factionAssets.filter((asset) => asset.kind === "temple");
  }
  if (kind === "apothecary-circle") {
    return factionAssets.filter((asset) => asset.kind === "apothecary");
  }
  if (kind === "gravewarden-order") {
    return factionAssets.filter((asset) => asset.kind === "graveyard");
  }
  if (kind === "craft-guild") {
    return factionAssets.filter((asset) => asset.kind === "workshop" || asset.kind === "outpost");
  }
  return factionAssets.filter((asset) => asset.kind === "charter-hall");
}

export function seedGuildOrganizations(world: World, assets: readonly BusinessAsset[] = seedBusinessAssets(world)): GuildOrganization[] {
  const assetsById = keyed(assets);
  const organizations: GuildOrganization[] = [];
  const kinds: OrganizationKind[] = [
    "miners-guild",
    "caravan-league",
    "temple-chapter",
    "apothecary-circle",
    "gravewarden-order",
    "craft-guild",
    "charter-company"
  ];

  for (const faction of byId(Object.values(world.factions))) {
    const factionAssets = assets.filter((asset) => asset.factionId === faction.id);
    for (const kind of kinds) {
      const groupAssets = assetsForOrganization(kind, factionAssets);
      const shouldSeed =
        groupAssets.length > 0 &&
        (kind !== "gravewarden-order" || groupAssets.some((asset) => asset.threats.some((threat) => threat.kind === "haunted-graveyard") || asset.value >= 18)) &&
        (kind !== "charter-company" || faction.kind === "guild" || groupAssets.some((asset) => asset.value >= 34));
      if (!shouldSeed) {
        continue;
      }
      const organization = makeOrganization(world, kind, faction, groupAssets, assetsById);
      if (organization) {
        organizations.push(organization);
      }
    }
  }

  return byId(organizations);
}

export function seedOrganizationEconomy(world: World, options: OrganizationSeedOptions = {}): OrganizationEconomyState {
  const assets = seedBusinessAssets(world, options);
  const organizations = seedGuildOrganizations(world, assets);
  return {
    generatedAtTick: world.tick,
    assets: keyed(assets),
    organizations: keyed(organizations),
    integrationAssumptions: [...organizationIntegrationAssumptions]
  };
}

export function repairOrganizationEconomy(world: World, existing?: Partial<OrganizationEconomyState>, options: OrganizationSeedOptions = {}): OrganizationEconomyState {
  if (!existing) {
    return seedOrganizationEconomy(world, options);
  }
  return seedOrganizationEconomy(world, options);
}

function signalKindForPressure(kind: BusinessAssetPressureKind): OrganizationSignalKind {
  if (kind === "mine-fauna" || kind === "guard-shortage") {
    return "request-guards";
  }
  if (kind === "caravan-route-danger" || kind === "waystation-support" || kind === "weather-exposure") {
    return "request-escorts";
  }
  if (kind === "apothecary-herb-shortage" || kind === "herb-supply" || kind === "glassware-supply") {
    return "request-herbs";
  }
  if (kind === "haunted-graveyard" || kind === "ritual-calm" || kind === "offering-shortfall") {
    return "request-wardens";
  }
  if (kind === "temple-unrest" || kind === "public-distrust") {
    return "call-mediation";
  }
  if (kind === "repair-backlog" || kind === "resource-depletion") {
    return "repair-asset";
  }
  if (kind === "charter-sanction" || kind === "wildcat-claim") {
    return "settle-charter";
  }
  if (kind === "claim-survey") {
    return "survey-claim";
  }
  return "recruit-labor";
}

function questKindForSignal(kind: OrganizationSignalKind): QuestKind {
  if (kind === "request-escorts" || kind === "request-herbs") {
    return "escort";
  }
  if (kind === "request-guards") {
    return "hunt";
  }
  if (kind === "request-wardens" || kind === "survey-claim") {
    return "delve";
  }
  if (kind === "repair-asset") {
    return "defense";
  }
  return "politics";
}

function priorityFor(severity: number): OrganizationTickSignal["priority"] {
  if (severity >= 76) {
    return "high";
  }
  if (severity >= 55) {
    return "medium";
  }
  return "low";
}

function previousSeverity(previous: OrganizationEconomyState | undefined, assetId: Id, pressureKind: BusinessAssetPressureKind): number {
  const asset = previous?.assets[assetId];
  const pressureItem = asset ? [...asset.needs, ...asset.threats].find((item) => item.kind === pressureKind) : undefined;
  return pressureItem?.severity ?? 0;
}

export function organizationSignals(
  world: World,
  state: OrganizationEconomyState,
  previous?: OrganizationEconomyState,
  options: OrganizationSeedOptions = {}
): OrganizationTickSignal[] {
  const threshold = options.signalThreshold ?? 58;
  const signals: OrganizationTickSignal[] = [];
  for (const organization of byId(Object.values(state.organizations))) {
    for (const assetId of organization.assetIds) {
      const asset = state.assets[assetId];
      if (!asset) {
        continue;
      }
      const pressures = [...asset.threats, ...asset.needs].sort(bySeverity);
      for (const item of pressures) {
        const prior = previousSeverity(previous, asset.id, item.kind);
        if (item.severity < threshold && item.severity - prior < 16) {
          continue;
        }
        const kind = signalKindForPressure(item.kind);
        const settlement = settlementForAsset(world, asset);
        signals.push({
          id: stableId("org-signal", [organization.id, asset.id, item.kind, `${state.generatedAtTick}`]),
          organizationId: organization.id,
          assetId: asset.id,
          factionId: organization.factionId,
          settlementId: settlement?.id ?? asset.settlementId,
          kind,
          priority: priorityFor(item.severity),
          pressure: item.severity,
          questKind: questKindForSignal(kind),
          text: `${organization.name} flags ${asset.name}: ${item.reason}`,
          tags: [...new Set([organization.kind, asset.kind, item.kind, ...item.tags])]
        });
      }
    }
  }
  return signals
    .sort((left, right) => right.pressure - left.pressure || left.organizationId.localeCompare(right.organizationId) || left.assetId.localeCompare(right.assetId))
    .slice(0, options.maxSignals ?? 12);
}

export function advanceOrganizationEconomy(world: World, previous?: OrganizationEconomyState, options: OrganizationSeedOptions = {}): OrganizationTickResult {
  const next = seedOrganizationEconomy(world, options);
  return {
    previousTick: previous?.generatedAtTick,
    next,
    signals: organizationSignals(world, next, previous, options)
  };
}

export function organizationAssetsBySettlement(state: OrganizationEconomyState, settlementId: Id): BusinessAsset[] {
  return byId(Object.values(state.assets).filter((asset) => asset.settlementId === settlementId));
}

export function organizationAssetsByFaction(state: OrganizationEconomyState, factionId: Id): BusinessAsset[] {
  return byId(Object.values(state.assets).filter((asset) => asset.factionId === factionId));
}

export function organizationsByFaction(state: OrganizationEconomyState, factionId: Id): GuildOrganization[] {
  return byId(Object.values(state.organizations).filter((organization) => organization.factionId === factionId));
}

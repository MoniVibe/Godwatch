import { average, clamp } from "../core/math";
import { seedBusinessAssets, seedGuildOrganizations, type BusinessAsset, type GuildOrganization } from "../economy/organizations";
import type {
  Agreement,
  AgreementKind,
  Asset,
  AssetKind,
  Id,
  LegalEntityRef,
  QuestKind,
  Settlement,
  TravelRoute,
  World
} from "../types";
import type { QuestNeedKind, QuestNeedProposal, QuestNeedSourceKind } from "./questNeeds";

export type TradeServicePressureKind =
  | "route-escort"
  | "route-repair"
  | "resource-supply"
  | "service-gap"
  | "asset-repair"
  | "clear-fauna"
  | "agreement-mediation"
  | "trade-mediation";

export type TradeHintKind = "asset" | "agreement";

export interface TradeRouteSnapshot {
  routeId: Id;
  fromId: Id;
  toId: Id;
  fromName: string;
  toName: string;
  factionIds: Id[];
  distance: number;
  danger: number;
  passDifficulty: number;
  relation: number;
  crossFaction: boolean;
  exchangedResources: string[];
  fromExports: string[];
  toExports: string[];
  pressure: number;
  tags: string[];
}

export interface TradeServicePressureSignal {
  id: Id;
  signature: string;
  kind: TradeServicePressureKind;
  title: string;
  summary: string;
  factionId: Id;
  locationId: Id;
  pressure: number;
  danger: number;
  urgency: number;
  priority: number;
  questKind: QuestKind;
  needKind: QuestNeedKind;
  sourceKind: QuestNeedSourceKind;
  sourceId: Id;
  settlementIds: Id[];
  routeId?: Id;
  assetId?: Id;
  businessAssetId?: Id;
  agreementId?: Id;
  organizationId?: Id;
  holdingId?: Id;
  featureId?: Id;
  resource?: string;
  service?: string;
  tags: string[];
}

export interface TradeAssetHint {
  id: Id;
  kind: TradeHintKind;
  hintKind: "asset";
  suggestedKind: AssetKind;
  name: string;
  owner: LegalEntityRef;
  operator: LegalEntityRef;
  locationId: Id;
  routeId?: Id;
  relatedSettlementIds: Id[];
  value: number;
  integrity: number;
  outputTags: string[];
  reason: string;
  pressure: number;
  tags: string[];
}

export interface TradeAgreementHint {
  id: Id;
  kind: TradeHintKind;
  hintKind: "agreement";
  suggestedKind: AgreementKind;
  name: string;
  parties: LegalEntityRef[];
  assetIds: Id[];
  locationId: Id;
  routeId?: Id;
  value: number;
  pressure: number;
  terms: string[];
  reason: string;
  tags: string[];
}

export interface TradeServiceHintSet {
  tick: number;
  assets: TradeAssetHint[];
  agreements: TradeAgreementHint[];
}

export interface TradeServiceSnapshot {
  tick: number;
  routes: TradeRouteSnapshot[];
  signals: TradeServicePressureSignal[];
  hints: TradeServiceHintSet;
}

export interface TradeServicePressureOptions {
  minPressure?: number;
  maxSignals?: number;
  maxPerLocation?: number;
  maxPerRoute?: number;
  includeDerivedBusinessAssets?: boolean;
  includeSettlementServiceGaps?: boolean;
  includeAgreementPressure?: boolean;
  includeAssetPressure?: boolean;
}

export interface TradeServiceQuestOptions extends TradeServicePressureOptions {
  maxProposals?: number;
  maxPerLocation?: number;
  existingSignatures?: readonly string[];
  allowExistingQuestDuplicates?: boolean;
}

export interface TradeServiceHintOptions {
  maxAssetHints?: number;
  maxAgreementHints?: number;
  includeDerivedBusinessAssets?: boolean;
}

interface TradeServiceContext {
  businessAssets: BusinessAsset[];
  guildOrganizations: GuildOrganization[];
  organizationByBusinessAssetId: Map<Id, GuildOrganization>;
}

interface SignalInput {
  kind: TradeServicePressureKind;
  title: string;
  summary: string;
  factionId: Id;
  locationId: Id;
  pressure: number;
  danger: number;
  urgency: number;
  questKind: QuestKind;
  needKind: QuestNeedKind;
  sourceKind: QuestNeedSourceKind;
  sourceId: Id;
  settlementIds: Id[];
  routeId?: Id;
  assetId?: Id;
  businessAssetId?: Id;
  agreementId?: Id;
  organizationId?: Id;
  holdingId?: Id;
  featureId?: Id;
  resource?: string;
  service?: string;
  tags: string[];
}

const defaultMinPressure = 38;
const defaultMaxSignals = 12;
const defaultMaxPerLocation = 3;
const defaultMaxPerRoute = 2;
const defaultMaxProposals = 8;
const defaultMaxAssetHints = 10;
const defaultMaxAgreementHints = 8;

const medicinalPattern = /herb|moss|mushroom|mint|willow|oil|honey|thyme|sage|lichen|flower|orchid|bell|pearlwort|leech/i;
const craftPattern = /ore|iron|wood|amber|quartz|glass|ash|salt|clay|wool|bone|hide|resin|copper|silver|stone/i;
const foodPattern = /grain|fish|reed|honey|goat|trout|eel|milk/i;
const faunaPattern = /adder|bear|boar|eagle|hawk|jackal|lynx|serpent|spider|stag|warg|wolf|vermin|beast/i;

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

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function uniqueIds(ids: readonly (Id | undefined)[]): Id[] {
  return [...new Set(ids.filter((id): id is Id => Boolean(id)))];
}

function factionRef(factionId: Id): LegalEntityRef {
  return { kind: "faction", id: factionId };
}

function relationBetween(world: World, factionId: Id, otherFactionId: Id): number {
  if (factionId === otherFactionId) {
    return 60;
  }
  const faction = world.factions[factionId];
  const other = world.factions[otherFactionId];
  if (!faction || !other) {
    return 0;
  }
  if (faction.activeWars.includes(otherFactionId) || other.activeWars.includes(factionId)) {
    return -100;
  }
  const oneWay = faction.relations[otherFactionId] ?? 0;
  const otherWay = other.relations[factionId] ?? oneWay;
  return Math.round((oneWay + otherWay) / 2);
}

function resourceDiff(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right.map((resource) => resource.toLowerCase()));
  return uniqueText(left.filter((resource) => !rightSet.has(resource.toLowerCase()))).sort((a, b) => a.localeCompare(b));
}

function listText(values: readonly string[], fallback: string): string {
  const unique = uniqueText(values);
  return unique.length > 0 ? unique.slice(0, 3).join(", ") : fallback;
}

function chooseIssuerFaction(world: World, settlement: Settlement, relatedFactionId?: Id): Id {
  if (relatedFactionId && world.factions[relatedFactionId]) {
    return relatedFactionId;
  }
  return settlement.factionId;
}

function legalRefFactionId(world: World, ref: LegalEntityRef): Id | undefined {
  if (ref.kind === "faction") return world.factions[ref.id]?.id;
  if (ref.kind === "organization") return world.organizations?.[ref.id]?.factionId;
  if (ref.kind === "settlement") return world.settlements[ref.id]?.factionId;
  if (ref.kind === "person") return world.persons[ref.id]?.factionId;
  if (ref.kind === "band") {
    const leaderId = world.bands[ref.id]?.leaderId;
    return leaderId ? world.persons[leaderId]?.factionId : undefined;
  }
  return undefined;
}

function agreementFactionIds(world: World, agreement: Agreement): Id[] {
  return uniqueIds(agreement.parties.map((party) => legalRefFactionId(world, party))).sort((a, b) => a.localeCompare(b));
}

function agreementLocationId(world: World, agreement: Agreement): Id | undefined {
  if (agreement.locationId && world.settlements[agreement.locationId]) {
    return agreement.locationId;
  }
  for (const assetId of agreement.assetIds) {
    const locationId = world.assets?.[assetId]?.locationId;
    if (locationId && world.settlements[locationId]) {
      return locationId;
    }
  }
  return undefined;
}

function agreementIncludesFactions(world: World, agreement: Agreement, leftFactionId: Id, rightFactionId: Id): boolean {
  const factionIds = agreementFactionIds(world, agreement);
  return factionIds.includes(leftFactionId) && factionIds.includes(rightFactionId);
}

function activeAgreementBetween(world: World, kind: AgreementKind, leftFactionId: Id, rightFactionId: Id, locationId?: Id): Agreement | undefined {
  return Object.values(world.agreements ?? {}).find((agreement) => {
    if (agreement.kind !== kind || (agreement.status !== "active" && agreement.status !== "strained")) {
      return false;
    }
    if (locationId && agreement.locationId && agreement.locationId !== locationId) {
      return false;
    }
    return agreementIncludesFactions(world, agreement, leftFactionId, rightFactionId);
  });
}

function persistentAssetsAt(world: World, settlementId: Id): Asset[] {
  return Object.values(world.assets ?? {})
    .filter((asset) => asset.locationId === settlementId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function businessAssetsAt(context: TradeServiceContext, settlementId: Id): BusinessAsset[] {
  return context.businessAssets.filter((asset) => asset.settlementId === settlementId).sort((left, right) => left.id.localeCompare(right.id));
}

function hasPersistentAsset(world: World, settlementId: Id, kinds: readonly AssetKind[]): boolean {
  return persistentAssetsAt(world, settlementId).some((asset) => kinds.includes(asset.kind) && asset.status !== "abandoned");
}

function hasBusinessAsset(context: TradeServiceContext, settlementId: Id, kinds: readonly BusinessAsset["kind"][]): boolean {
  return businessAssetsAt(context, settlementId).some((asset) => kinds.includes(asset.kind));
}

function hasService(world: World, context: TradeServiceContext, settlementId: Id, persistentKinds: readonly AssetKind[], businessKinds: readonly BusinessAsset["kind"][]): boolean {
  return hasPersistentAsset(world, settlementId, persistentKinds) || hasBusinessAsset(context, settlementId, businessKinds);
}

function nearestRoutePressure(world: World, settlementId: Id): number {
  const routes = Object.values(world.planet.routes ?? {}).filter((route) => route.fromId === settlementId || route.toId === settlementId);
  return rounded(average(routes.map((route) => route.danger * 0.48 + route.passDifficulty * 0.26 + route.distance * 0.04)));
}

function buildContext(world: World, options: Pick<TradeServicePressureOptions, "includeDerivedBusinessAssets"> = {}): TradeServiceContext {
  const businessAssets = options.includeDerivedBusinessAssets ?? true ? seedBusinessAssets(world, { includeHiddenFeatures: false, includeSettlementServiceAssets: true }) : [];
  const guildOrganizations = options.includeDerivedBusinessAssets ?? true ? seedGuildOrganizations(world, businessAssets) : [];
  const organizationByBusinessAssetId = new Map<Id, GuildOrganization>();
  for (const organization of guildOrganizations) {
    for (const assetId of organization.assetIds) {
      if (!organizationByBusinessAssetId.has(assetId)) {
        organizationByBusinessAssetId.set(assetId, organization);
      }
    }
  }
  return { businessAssets, guildOrganizations, organizationByBusinessAssetId };
}

function routeSnapshot(world: World, route: TravelRoute): TradeRouteSnapshot | undefined {
  const from = world.settlements[route.fromId];
  const to = world.settlements[route.toId];
  if (!from || !to) {
    return undefined;
  }
  const fromExports = resourceDiff(from.resources, to.resources);
  const toExports = resourceDiff(to.resources, from.resources);
  const exchangedResources = uniqueText([...fromExports.slice(0, 4), ...toExports.slice(0, 4)]).sort((a, b) => a.localeCompare(b));
  const relation = relationBetween(world, from.factionId, to.factionId);
  const crossFaction = from.factionId !== to.factionId;
  const relationDrag = crossFaction ? Math.max(0, -relation) * 0.18 : 0;
  const threat = average([from.threat, to.threat]);
  const pressure = rounded(18 + route.danger * 0.48 + route.passDifficulty * 0.26 + route.distance * 0.06 + threat * 0.16 + exchangedResources.length * 2.4 + relationDrag);
  return {
    routeId: route.id,
    fromId: from.id,
    toId: to.id,
    fromName: from.name,
    toName: to.name,
    factionIds: uniqueIds([from.factionId, to.factionId]).sort((a, b) => a.localeCompare(b)),
    distance: route.distance,
    danger: route.danger,
    passDifficulty: route.passDifficulty,
    relation,
    crossFaction,
    exchangedResources,
    fromExports,
    toExports,
    pressure,
    tags: uniqueText(["trade-route", route.terrain, route.topography, route.elevationBand, route.biomeId, crossFaction ? "cross-border" : "internal"])
  };
}

export function deriveTradeRouteSnapshots(world: World): TradeRouteSnapshot[] {
  return Object.values(world.planet.routes ?? {})
    .map((route) => routeSnapshot(world, route))
    .filter((snapshot): snapshot is TradeRouteSnapshot => Boolean(snapshot))
    .sort((left, right) => right.pressure - left.pressure || left.routeId.localeCompare(right.routeId));
}

function makeSignal(input: SignalInput): TradeServicePressureSignal {
  const pressure = rounded(input.pressure);
  const danger = rounded(input.danger, 8, 98);
  const urgency = rounded(input.urgency, 18, 140);
  const priority = rounded(pressure + danger * 0.32 + urgency * 0.12, 0, 180);
  const signature = [
    "trade-service",
    input.kind,
    input.factionId,
    input.locationId,
    input.routeId ?? "",
    input.assetId ?? input.businessAssetId ?? "",
    input.agreementId ?? "",
    input.holdingId ?? "",
    input.service ?? input.resource ?? ""
  ].join(":");
  return {
    ...input,
    id: stableId("trade-signal", [signature]),
    signature,
    pressure,
    danger,
    urgency,
    priority,
    settlementIds: uniqueIds(input.settlementIds),
    tags: uniqueText(["trade-service", input.kind, ...input.tags]).slice(0, 20)
  };
}

function sortedSignals(signals: readonly TradeServicePressureSignal[]): TradeServicePressureSignal[] {
  return [...signals].sort(
    (left, right) =>
      right.priority - left.priority ||
      right.pressure - left.pressure ||
      left.kind.localeCompare(right.kind) ||
      left.locationId.localeCompare(right.locationId) ||
      left.signature.localeCompare(right.signature)
  );
}

function routeSignals(world: World, context: TradeServiceContext): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  const routeAssets = new Map(context.businessAssets.filter((asset) => asset.routeId).map((asset) => [asset.routeId as Id, asset]));
  for (const snapshot of deriveTradeRouteSnapshots(world)) {
    const route = world.planet.routes[snapshot.routeId];
    const from = world.settlements[snapshot.fromId];
    const to = world.settlements[snapshot.toId];
    if (!route || !from || !to) {
      continue;
    }
    const businessAsset = routeAssets.get(route.id);
    const organization = businessAsset ? context.organizationByBusinessAssetId.get(businessAsset.id) : undefined;
    const issuerFactionId = chooseIssuerFaction(world, route.danger >= to.threat ? from : to, organization?.factionId ?? businessAsset?.factionId);
    const tradeGoods = listText(snapshot.exchangedResources, "ordinary goods");
    const hardRoad = route.passDifficulty >= 45 || route.distance >= 64 || route.elevationBand === "high" || route.elevationBand === "alpine";

    if (snapshot.exchangedResources.length > 0 && (route.danger >= 36 || route.passDifficulty >= 46 || route.distance >= 58 || snapshot.pressure >= 54)) {
      signals.push(
        makeSignal({
          kind: "route-escort",
          title: `Escort trade between ${from.name} and ${to.name}`,
          summary: `${from.name} and ${to.name} can exchange ${tradeGoods}, but the ${route.terrain} route is dangerous enough that caravans need guards, scouts, or waystation cover.`,
          factionId: issuerFactionId,
          locationId: from.id,
          pressure: snapshot.pressure + route.danger * 0.18,
          danger: 18 + route.danger * 0.7 + route.passDifficulty * 0.18,
          urgency: 26 + snapshot.pressure * 0.76,
          questKind: "escort",
          needKind: "organization-escorts",
          sourceKind: "asset",
          sourceId: businessAsset?.id ?? `asset-route-${route.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          settlementIds: [from.id, to.id],
          routeId: route.id,
          businessAssetId: businessAsset?.id,
          organizationId: organization?.id,
          resource: tradeGoods,
          service: "escort",
          tags: [...snapshot.tags, "caravan", "escort", ...snapshot.exchangedResources.slice(0, 4)]
        })
      );
    }

    if (hardRoad && snapshot.pressure >= 44) {
      signals.push(
        makeSignal({
          kind: "route-repair",
          title: `Stabilize the ${from.name}-${to.name} road`,
          summary: `The ${route.topography} road between ${from.name} and ${to.name} needs repairs, markers, bridges, or waystations before distance and terrain keep trade from moving cleanly.`,
          factionId: issuerFactionId,
          locationId: from.id,
          pressure: 24 + route.passDifficulty * 0.42 + route.distance * 0.16 + route.danger * 0.18,
          danger: 14 + route.danger * 0.42 + route.passDifficulty * 0.26,
          urgency: 24 + snapshot.pressure * 0.62,
          questKind: "defense",
          needKind: "organization-repair",
          sourceKind: "asset",
          sourceId: businessAsset?.id ?? `asset-route-${route.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          settlementIds: [from.id, to.id],
          routeId: route.id,
          businessAssetId: businessAsset?.id,
          organizationId: organization?.id,
          service: "roadwork",
          tags: [...snapshot.tags, "repair", "waystation"]
        })
      );
    }

    if (snapshot.crossFaction && snapshot.exchangedResources.length > 0 && (snapshot.relation <= -18 || !activeAgreementBetween(world, "trade", from.factionId, to.factionId))) {
      signals.push(
        makeSignal({
          kind: "trade-mediation",
          title: `Mediate trade between ${from.name} and ${to.name}`,
          summary: `${from.name} and ${to.name} have useful goods to exchange, but cross-border pressure makes witnesses, toll terms, or neutral brokers necessary before merchants trust the route.`,
          factionId: issuerFactionId,
          locationId: from.id,
          pressure: 32 + Math.max(0, -snapshot.relation) * 0.36 + snapshot.exchangedResources.length * 4 + route.danger * 0.12,
          danger: 12 + Math.max(0, -snapshot.relation) * 0.24 + route.danger * 0.18,
          urgency: 28 + snapshot.pressure * 0.58,
          questKind: "politics",
          needKind: "organization-mediation",
          sourceKind: "asset",
          sourceId: businessAsset?.id ?? `asset-route-${route.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
          settlementIds: [from.id, to.id],
          routeId: route.id,
          businessAssetId: businessAsset?.id,
          organizationId: organization?.id,
          service: "trade mediation",
          tags: [...snapshot.tags, "trade", "mediation", ...snapshot.exchangedResources.slice(0, 4)]
        })
      );
    }
  }
  return signals;
}

function settlementServiceSignals(world: World, context: TradeServiceContext): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  for (const settlement of Object.values(world.settlements).sort((left, right) => left.id.localeCompare(right.id))) {
    const resources = uniqueText([...settlement.resources, ...settlement.flora]);
    const medicinalResources = resources.filter((resource) => medicinalPattern.test(resource));
    const craftResources = settlement.resources.filter((resource) => craftPattern.test(resource));
    const foodResources = settlement.resources.filter((resource) => foodPattern.test(resource));
    const routePressure = nearestRoutePressure(world, settlement.id);
    const civicPressure = settlement.unrest * 0.24 + settlement.threat * 0.28 + Math.max(0, settlement.population - 180) * 0.035;

    if (!hasService(world, context, settlement.id, ["apothecary", "temple"], ["apothecary", "temple"]) && (medicinalResources.length > 0 || civicPressure >= 28)) {
      signals.push(
        makeSignal({
          kind: "service-gap",
          title: `Establish care services in ${settlement.name}`,
          summary: `${settlement.name} has ${listText(medicinalResources, "treatable local materials")} but lacks reliable apothecary or temple service. A guild, healer, or supplier could turn local resources into care before unrest and threat become sickness pressure.`,
          factionId: settlement.factionId,
          locationId: settlement.id,
          pressure: 26 + civicPressure + medicinalResources.length * 5,
          danger: 10 + settlement.threat * 0.48,
          urgency: 26 + civicPressure * 0.9,
          questKind: "escort",
          needKind: "organization-supplies",
          sourceKind: "settlement",
          sourceId: settlement.id,
          settlementIds: [settlement.id],
          resource: listText(medicinalResources, "medicine"),
          service: "apothecary",
          tags: ["service-gap", "medicine", settlement.biomeId, settlement.terrain, ...medicinalResources.slice(0, 4)]
        })
      );
    }

    if (!hasService(world, context, settlement.id, ["forge", "guildhall"], ["workshop", "charter-hall"]) && craftResources.length > 0) {
      signals.push(
        makeSignal({
          kind: "service-gap",
          title: `Charter craft service in ${settlement.name}`,
          summary: `${settlement.name} has craft inputs such as ${listText(craftResources, "local materials")} but lacks a strong forge, workshop, or guildhall. A chartered service would let local assets become equipment, repairs, and trade goods.`,
          factionId: settlement.factionId,
          locationId: settlement.id,
          pressure: 24 + craftResources.length * 6 + Math.max(0, settlement.prosperity - 34) * 0.24 + routePressure * 0.18,
          danger: 8 + settlement.threat * 0.28,
          urgency: 22 + craftResources.length * 8 + routePressure * 0.24,
          questKind: "politics",
          needKind: "organization-charter",
          sourceKind: "settlement",
          sourceId: settlement.id,
          settlementIds: [settlement.id],
          resource: listText(craftResources, "craft materials"),
          service: "craft charter",
          tags: ["service-gap", "craft", "charter", settlement.biomeId, ...craftResources.slice(0, 4)]
        })
      );
    }

    if (foodResources.length > 0 && !hasService(world, context, settlement.id, ["caravan", "road", "dock"], ["caravan-route", "charter-hall"])) {
      signals.push(
        makeSignal({
          kind: "resource-supply",
          title: `Move surplus from ${settlement.name}`,
          summary: `${settlement.name} can produce ${listText(foodResources, "staples")} but lacks reliable transport service. Caravans, docks, or road contracts would keep surplus from becoming waste while neighbors face scarcity.`,
          factionId: settlement.factionId,
          locationId: settlement.id,
          pressure: 22 + foodResources.length * 5 + settlement.prosperity * 0.18 + routePressure * 0.22,
          danger: 10 + routePressure * 0.48,
          urgency: 20 + routePressure * 0.56,
          questKind: "escort",
          needKind: "organization-escorts",
          sourceKind: "settlement",
          sourceId: settlement.id,
          settlementIds: [settlement.id],
          resource: listText(foodResources, "supplies"),
          service: "transport",
          tags: ["resource-supply", "caravan", "food", settlement.terrain, ...foodResources.slice(0, 4)]
        })
      );
    }
  }
  return signals;
}

function holdingSignals(world: World): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  for (const holding of Object.values(world.planet.holdings ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    const feature = world.planet.features[holding.featureId];
    const settlement = feature ? world.settlements[feature.nearestSettlementId] : undefined;
    if (!feature || !settlement || !world.factions[holding.factionId]) {
      continue;
    }
    const repairPressure = (holding.status === "damaged" ? 34 : holding.status === "building" ? 14 : 0) + Math.max(0, 72 - holding.integrity) * 0.72;
    if (repairPressure >= 24) {
      signals.push(
        makeSignal({
          kind: "asset-repair",
          title: `Repair ${holding.name}`,
          summary: `${holding.name} produces ${holding.outputResource || feature.resources[0] || "materials"}, but its works need repair before stockpiles, workers, and claimed terrain stop paying off.`,
          factionId: holding.factionId,
          locationId: settlement.id,
          pressure: repairPressure,
          danger: 12 + feature.danger * 0.34 + Math.max(0, 60 - holding.integrity) * 0.22,
          urgency: 28 + repairPressure * 0.82,
          questKind: "defense",
          needKind: "organization-repair",
          sourceKind: "holding",
          sourceId: holding.id,
          settlementIds: [settlement.id],
          holdingId: holding.id,
          featureId: feature.id,
          resource: holding.outputResource || feature.resources[0],
          service: "repair",
          tags: ["holding", "repair", holding.kind, holding.status, feature.kind, feature.layer, holding.outputResource]
        })
      );
    }

    const faunaText = [...feature.fauna, ...feature.threats, ...feature.tags].join(" ");
    const faunaPressure = feature.danger * 0.42 + feature.fauna.length * 5 + Math.max(0, 12 - holding.garrison) * 2.6 + (faunaPattern.test(faunaText) ? 10 : 0);
    if (faunaPressure >= 34) {
      const subject = listText([...feature.fauna, ...feature.threats], "wild fauna");
      signals.push(
        makeSignal({
          kind: "clear-fauna",
          title: `Clear ${subject} from ${holding.name}`,
          summary: `${holding.name} cannot reliably work ${feature.name} while ${subject} controls the approaches. Clearing the site would reopen safer extraction and reduce pressure on local guilds.`,
          factionId: holding.factionId,
          locationId: settlement.id,
          pressure: faunaPressure,
          danger: 18 + feature.danger * 0.7 + Math.max(0, 10 - holding.garrison) * 1.8,
          urgency: 24 + faunaPressure * 0.76,
          questKind: "hunt",
          needKind: "clear-fauna",
          sourceKind: "holding",
          sourceId: holding.id,
          settlementIds: [settlement.id],
          holdingId: holding.id,
          featureId: feature.id,
          resource: holding.outputResource || feature.resources[0],
          service: "clear fauna",
          tags: ["holding", "fauna", "worksite", holding.kind, feature.kind, feature.layer, ...feature.fauna.slice(0, 4)]
        })
      );
    }
  }
  return signals;
}

function persistentAssetSignals(world: World): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  for (const asset of Object.values(world.assets ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    const settlement = asset.locationId ? world.settlements[asset.locationId] : undefined;
    if (!settlement) {
      continue;
    }
    const ownerFactionId = legalRefFactionId(world, asset.owner) ?? settlement.factionId;
    const repairPressure =
      (asset.status === "damaged" ? 34 : asset.status === "abandoned" ? 28 : asset.status === "sealed" ? 18 : asset.status === "seized" ? 16 : 0) +
      Math.max(0, 76 - asset.integrity) * 0.74;
    if (repairPressure >= 24) {
      signals.push(
        makeSignal({
          kind: asset.status === "seized" ? "agreement-mediation" : "asset-repair",
          title: asset.status === "seized" ? `Mediate control of ${asset.name}` : `Repair ${asset.name}`,
          summary:
            asset.status === "seized"
              ? `${asset.name} is seized or disputed. Operators need witnesses and political settlement before the asset can serve trade cleanly.`
              : `${asset.name} is too damaged or neglected to provide steady ${listText(asset.outputTags, "service")}. Repair crews would restore local business capacity.`,
          factionId: ownerFactionId,
          locationId: settlement.id,
          pressure: repairPressure,
          danger: 12 + settlement.threat * 0.38 + (asset.status === "seized" ? 18 : 0),
          urgency: 26 + repairPressure * 0.82,
          questKind: asset.status === "seized" ? "politics" : "defense",
          needKind: asset.status === "seized" ? "organization-mediation" : "organization-repair",
          sourceKind: "asset",
          sourceId: asset.id,
          settlementIds: [settlement.id],
          assetId: asset.id,
          agreementId: asset.agreementId,
          service: asset.kind,
          tags: ["asset", asset.kind, asset.status, "trade-service", ...asset.outputTags.slice(0, 4)]
        })
      );
    }
  }
  return signals;
}

function businessAssetSignals(world: World, context: TradeServiceContext): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  for (const asset of context.businessAssets) {
    const settlement = asset.settlementId ? world.settlements[asset.settlementId] : asset.featureId ? world.settlements[world.planet.features[asset.featureId]?.nearestSettlementId] : undefined;
    if (!settlement || !world.factions[asset.factionId]) {
      continue;
    }
    const organization = context.organizationByBusinessAssetId.get(asset.id);
    const strongest = [...asset.threats, ...asset.needs].sort((left, right) => right.severity - left.severity || left.kind.localeCompare(right.kind))[0];
    if (!strongest || strongest.severity < 46) {
      continue;
    }
    const kind: TradeServicePressureKind =
      strongest.kind === "mine-fauna"
        ? "clear-fauna"
        : strongest.kind === "caravan-route-danger" || strongest.kind === "weather-exposure" || strongest.kind === "waystation-support"
          ? "route-escort"
          : strongest.kind === "repair-backlog" || strongest.kind === "resource-depletion"
            ? "asset-repair"
            : strongest.kind === "public-distrust" || strongest.kind === "temple-unrest" || strongest.kind === "charter-sanction" || strongest.kind === "wildcat-claim"
              ? "trade-mediation"
              : "resource-supply";
    const questKind: QuestKind = kind === "clear-fauna" ? "hunt" : kind === "trade-mediation" ? "politics" : kind === "asset-repair" ? "defense" : "escort";
    const needKind: QuestNeedKind =
      kind === "clear-fauna"
        ? "clear-fauna"
        : kind === "trade-mediation"
          ? "organization-mediation"
          : kind === "asset-repair"
            ? "organization-repair"
            : kind === "route-escort"
              ? "organization-escorts"
              : "organization-supplies";
    signals.push(
      makeSignal({
        kind,
        title: `${organization?.name ?? "Local guild"} needs ${asset.name}`,
        summary: `${organization?.name ?? "Local operators"} report ${asset.name} pressure: ${strongest.reason}`,
        factionId: organization?.factionId ?? asset.factionId,
        locationId: settlement.id,
        pressure: strongest.severity,
        danger: 14 + strongest.severity * 0.58 + settlement.threat * 0.14,
        urgency: 24 + strongest.severity * 0.86,
        questKind,
        needKind,
        sourceKind: asset.holdingId ? "holding" : "asset",
        sourceId: asset.holdingId ?? asset.id,
        settlementIds: [settlement.id],
        routeId: asset.routeId,
        businessAssetId: asset.id,
        organizationId: organization?.id,
        holdingId: asset.holdingId,
        featureId: asset.featureId,
        resource: asset.outputFocus,
        service: asset.kind,
        tags: ["business-asset", asset.kind, strongest.kind, ...asset.tags, ...strongest.tags]
      })
    );
  }
  return signals;
}

function agreementSignals(world: World): TradeServicePressureSignal[] {
  const signals: TradeServicePressureSignal[] = [];
  for (const agreement of Object.values(world.agreements ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    const locationId = agreementLocationId(world, agreement);
    const settlement = locationId ? world.settlements[locationId] : undefined;
    if (!settlement) {
      continue;
    }
    const factionIds = agreementFactionIds(world, agreement);
    const relationDrag =
      factionIds.length >= 2
        ? Math.max(
            0,
            ...factionIds.flatMap((factionId, index) => factionIds.slice(index + 1).map((otherFactionId) => -relationBetween(world, factionId, otherFactionId)))
          )
        : 0;
    const statusPressure =
      agreement.status === "breached"
        ? 44
        : agreement.status === "strained"
          ? 28
          : agreement.status === "draft"
            ? 16
            : agreement.status === "expired" || agreement.status === "void"
              ? 22
              : 0;
    const pressure = agreement.pressure * 0.72 + statusPressure + relationDrag * 0.22;
    if (pressure < 34 || !["trade", "protection", "lease", "debt", "charter", "ceasefire"].includes(agreement.kind)) {
      continue;
    }
    const issuerFactionId = factionIds.find((id) => world.factions[id]) ?? settlement.factionId;
    signals.push(
      makeSignal({
        kind: "agreement-mediation",
        title: `Mediate ${agreement.name}`,
        summary: `${agreement.name} is under pressure. The parties need witnesses, terms, or enforcement before asset rights and trade obligations turn into open faction grievance.`,
        factionId: issuerFactionId,
        locationId: settlement.id,
        pressure,
        danger: 10 + relationDrag * 0.34 + settlement.unrest * 0.24,
        urgency: 24 + pressure * 0.92,
        questKind: "politics",
        needKind: "organization-mediation",
        sourceKind: "organization",
        sourceId: agreement.parties.find((party) => party.kind === "organization")?.id ?? issuerFactionId,
        settlementIds: [settlement.id],
        agreementId: agreement.id,
        assetId: agreement.assetIds[0],
        service: `${agreement.kind} mediation`,
        tags: ["agreement", agreement.kind, agreement.status, "mediation", ...agreement.tags]
      })
    );
  }
  return signals;
}

export function collectTradeServicePressureSignals(world: World, options: TradeServicePressureOptions = {}): TradeServicePressureSignal[] {
  const context = buildContext(world, options);
  const minPressure = options.minPressure ?? defaultMinPressure;
  const maxSignals = options.maxSignals ?? defaultMaxSignals;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const maxPerRoute = options.maxPerRoute ?? defaultMaxPerRoute;
  const perLocation = new Map<Id, number>();
  const perRoute = new Map<Id, number>();
  const seen = new Set<string>();
  const candidates = [
    ...routeSignals(world, context),
    ...(options.includeSettlementServiceGaps ?? true ? settlementServiceSignals(world, context) : []),
    ...holdingSignals(world),
    ...(options.includeAssetPressure ?? true ? persistentAssetSignals(world) : []),
    ...(options.includeDerivedBusinessAssets ?? true ? businessAssetSignals(world, context) : []),
    ...(options.includeAgreementPressure ?? true ? agreementSignals(world) : [])
  ];
  const signals: TradeServicePressureSignal[] = [];

  for (const signal of sortedSignals(candidates)) {
    if (signals.length >= maxSignals || signal.pressure < minPressure || seen.has(signal.signature)) {
      continue;
    }
    const locationCount = perLocation.get(signal.locationId) ?? 0;
    const routeCount = signal.routeId ? perRoute.get(signal.routeId) ?? 0 : 0;
    if (locationCount >= maxPerLocation || (signal.routeId && routeCount >= maxPerRoute)) {
      continue;
    }
    seen.add(signal.signature);
    perLocation.set(signal.locationId, locationCount + 1);
    if (signal.routeId) {
      perRoute.set(signal.routeId, routeCount + 1);
    }
    signals.push(signal);
  }

  return signals;
}

function equivalentOpenQuest(world: World, proposal: QuestNeedProposal): boolean {
  const title = proposal.title.toLowerCase();
  return Object.values(world.quests).some((quest) => {
    if (quest.status !== "open" && quest.status !== "active") {
      return false;
    }
    return (
      quest.locationId === proposal.locationId &&
      quest.kind === proposal.kind &&
      quest.issuerFactionId === proposal.issuerFactionId &&
      (quest.targetFactionId ?? "") === (proposal.targetFactionId ?? "") &&
      quest.title.toLowerCase() === title
    );
  });
}

export function tradeServicePressureToQuestProposal(world: World, signal: TradeServicePressureSignal): QuestNeedProposal | undefined {
  if (!world.settlements[signal.locationId] || !world.factions[signal.factionId]) {
    return undefined;
  }
  const danger = rounded(signal.danger, 8, 98);
  const urgency = rounded(signal.urgency, 20, 140);
  const priority = rounded(signal.priority, 0, 180);
  return {
    signature: signal.signature,
    needKind: signal.needKind,
    title: signal.title,
    kind: signal.questKind,
    issuerFactionId: signal.factionId,
    locationId: signal.locationId,
    danger,
    rewardGold: Math.ceil(danger * 1.7 + signal.pressure * 0.46),
    rewardRenown: Math.ceil(danger / 9 + signal.pressure / 36),
    urgency,
    priority,
    summary: signal.summary,
    sourceKind: signal.sourceKind,
    sourceId: signal.sourceId,
    tags: uniqueText([...signal.tags, ...signal.settlementIds.map((id) => `settlement:${id}`)]).slice(0, 20)
  };
}

export function proposeTradeServiceQuestNeeds(world: World, options: TradeServiceQuestOptions = {}): QuestNeedProposal[] {
  const maxProposals = options.maxProposals ?? defaultMaxProposals;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const seen = new Set(options.existingSignatures ?? []);
  const perLocation = new Map<Id, number>();
  const proposals: QuestNeedProposal[] = [];

  for (const signal of collectTradeServicePressureSignals(world, options)) {
    if (proposals.length >= maxProposals || seen.has(signal.signature)) {
      continue;
    }
    const proposal = tradeServicePressureToQuestProposal(world, signal);
    if (!proposal) {
      continue;
    }
    const locationCount = perLocation.get(proposal.locationId) ?? 0;
    if (locationCount >= maxPerLocation) {
      continue;
    }
    if (!(options.allowExistingQuestDuplicates ?? false) && equivalentOpenQuest(world, proposal)) {
      continue;
    }
    seen.add(proposal.signature);
    perLocation.set(proposal.locationId, locationCount + 1);
    proposals.push(proposal);
  }

  return proposals;
}

function settlementHasAssetHint(assetHints: readonly TradeAssetHint[], settlementId: Id, kind: AssetKind): boolean {
  return assetHints.some((hint) => hint.locationId === settlementId && hint.suggestedKind === kind);
}

function assetHintsForSettlements(world: World, context: TradeServiceContext): TradeAssetHint[] {
  const hints: TradeAssetHint[] = [];
  for (const settlement of Object.values(world.settlements).sort((left, right) => left.id.localeCompare(right.id))) {
    const craftResources = settlement.resources.filter((resource) => craftPattern.test(resource));
    const medicinalResources = uniqueText([...settlement.resources, ...settlement.flora]).filter((resource) => medicinalPattern.test(resource));
    const owner = factionRef(settlement.factionId);

    if (craftResources.length > 0 && !hasPersistentAsset(world, settlement.id, ["forge", "guildhall"]) && !settlementHasAssetHint(hints, settlement.id, "forge")) {
      hints.push({
        id: stableId("trade-asset-hint", [settlement.id, "forge"]),
        kind: "asset",
        hintKind: "asset",
        suggestedKind: "forge",
        name: `${settlement.name} Forge Charter`,
        owner,
        operator: owner,
        locationId: settlement.id,
        relatedSettlementIds: [settlement.id],
        value: rounded(26 + settlement.prosperity * 0.42 + craftResources.length * 8, 1, 200),
        integrity: 100,
        outputTags: uniqueText(["arms", "tools", "repair", ...craftResources]).slice(0, 8),
        reason: `${settlement.name} has ${listText(craftResources, "craft resources")} but no persistent forge asset.`,
        pressure: rounded(24 + craftResources.length * 8 + settlement.prosperity * 0.22),
        tags: ["asset-hint", "forge", "craft", settlement.biomeId, settlement.terrain]
      });
    }

    if (medicinalResources.length > 0 && !hasPersistentAsset(world, settlement.id, ["apothecary", "temple"]) && !settlementHasAssetHint(hints, settlement.id, "apothecary")) {
      hints.push({
        id: stableId("trade-asset-hint", [settlement.id, "apothecary"]),
        kind: "asset",
        hintKind: "asset",
        suggestedKind: "apothecary",
        name: `${settlement.name} Apothecary Lease`,
        owner,
        operator: owner,
        locationId: settlement.id,
        relatedSettlementIds: [settlement.id],
        value: rounded(22 + settlement.population * 0.03 + medicinalResources.length * 7, 1, 200),
        integrity: 100,
        outputTags: uniqueText(["medicine", "care", "glassware", ...medicinalResources]).slice(0, 8),
        reason: `${settlement.name} has ${listText(medicinalResources, "medicinal resources")} but no persistent apothecary asset.`,
        pressure: rounded(22 + medicinalResources.length * 7 + settlement.threat * 0.2 + settlement.unrest * 0.18),
        tags: ["asset-hint", "apothecary", "medicine", settlement.biomeId, settlement.terrain]
      });
    }

    if (settlement.terrain === "riverlands" && !hasPersistentAsset(world, settlement.id, ["dock"]) && !settlementHasAssetHint(hints, settlement.id, "dock")) {
      hints.push({
        id: stableId("trade-asset-hint", [settlement.id, "dock"]),
        kind: "asset",
        hintKind: "asset",
        suggestedKind: "dock",
        name: `${settlement.name} Cargo Dock`,
        owner,
        operator: owner,
        locationId: settlement.id,
        relatedSettlementIds: [settlement.id],
        value: rounded(24 + settlement.prosperity * 0.38 + nearestRoutePressure(world, settlement.id) * 0.18, 1, 200),
        integrity: 100,
        outputTags: uniqueText(["cargo", "fish", "passage", ...settlement.resources.filter((resource) => foodPattern.test(resource)).slice(0, 4)]).slice(0, 8),
        reason: `${settlement.name} sits in riverlands and can support waterborne cargo service.`,
        pressure: rounded(22 + settlement.prosperity * 0.28 + nearestRoutePressure(world, settlement.id) * 0.22),
        tags: ["asset-hint", "dock", "riverlands", settlement.biomeId]
      });
    }
  }

  for (const asset of context.businessAssets) {
    if (!asset.settlementId || hasPersistentAsset(world, asset.settlementId, ["caravan", "road"]) || asset.kind !== "caravan-route") {
      continue;
    }
    const settlement = world.settlements[asset.settlementId];
    if (!settlement || settlementHasAssetHint(hints, settlement.id, "caravan")) {
      continue;
    }
    const owner = factionRef(asset.factionId);
    hints.push({
      id: stableId("trade-asset-hint", [asset.id, "caravan"]),
      kind: "asset",
      hintKind: "asset",
      suggestedKind: "caravan",
      name: `${settlement.name} Caravan Office`,
      owner,
      operator: owner,
      locationId: settlement.id,
      routeId: asset.routeId,
      relatedSettlementIds: uniqueIds([settlement.id]),
      value: rounded(asset.value * 0.85 + asset.reliability * 0.22, 1, 200),
      integrity: 100,
      outputTags: uniqueText(["trade", "news", "supply", asset.outputFocus, ...asset.tags.slice(0, 4)]).slice(0, 8),
      reason: `${asset.name} is visible as a trade route but has no persistent caravan asset at ${settlement.name}.`,
      pressure: rounded(32 + Math.max(0, 74 - asset.reliability) * 0.5 + asset.value * 0.14),
      tags: ["asset-hint", "caravan", "route", ...asset.tags.slice(0, 4)]
    });
  }

  return hints.sort((left, right) => right.pressure - left.pressure || left.id.localeCompare(right.id));
}

function agreementHintsForRoutes(world: World): TradeAgreementHint[] {
  const hints: TradeAgreementHint[] = [];
  for (const snapshot of deriveTradeRouteSnapshots(world)) {
    const from = world.settlements[snapshot.fromId];
    const to = world.settlements[snapshot.toId];
    if (!from || !to || from.factionId === to.factionId || snapshot.exchangedResources.length === 0) {
      continue;
    }
    if (!activeAgreementBetween(world, "trade", from.factionId, to.factionId, from.id)) {
      hints.push({
        id: stableId("trade-agreement-hint", [snapshot.routeId, "trade", from.factionId, to.factionId]),
        kind: "agreement",
        hintKind: "agreement",
        suggestedKind: "trade",
        name: `${from.name}-${to.name} Trade Compact`,
        parties: [factionRef(from.factionId), factionRef(to.factionId)],
        assetIds: [],
        locationId: from.id,
        routeId: snapshot.routeId,
        value: rounded(24 + snapshot.exchangedResources.length * 8 + snapshot.pressure * 0.36, 1, 200),
        pressure: rounded(28 + snapshot.pressure * 0.42 + Math.max(0, -snapshot.relation) * 0.24),
        terms: [
          `Recognize caravan exchange between ${from.name} and ${to.name}`,
          `Protect declared cargo: ${listText(snapshot.exchangedResources, "common goods")}`,
          "Settle tolls and witnesses before seizure or reprisals"
        ],
        reason: `${from.name} and ${to.name} have complementary resources but no active trade agreement between their societies.`,
        tags: ["agreement-hint", "trade", "route", from.biomeId, to.biomeId, ...snapshot.exchangedResources.slice(0, 4)]
      });
    }
    if (snapshot.danger >= 48 && !activeAgreementBetween(world, "protection", from.factionId, to.factionId, from.id)) {
      hints.push({
        id: stableId("trade-agreement-hint", [snapshot.routeId, "protection", from.factionId, to.factionId]),
        kind: "agreement",
        hintKind: "agreement",
        suggestedKind: "protection",
        name: `${from.name}-${to.name} Road Protection Oath`,
        parties: [factionRef(from.factionId), factionRef(to.factionId)],
        assetIds: [],
        locationId: from.id,
        routeId: snapshot.routeId,
        value: rounded(20 + snapshot.danger * 0.9 + snapshot.passDifficulty * 0.28, 1, 200),
        pressure: rounded(30 + snapshot.danger * 0.56 + snapshot.passDifficulty * 0.24),
        terms: [
          `Share patrol obligation on the route from ${from.name} to ${to.name}`,
          "Name neutral witnesses for seized cargo and injured escorts",
          "Permit emergency shelter at waystations"
        ],
        reason: `${from.name} and ${to.name} share a dangerous trade road without an explicit protection agreement.`,
        tags: ["agreement-hint", "protection", "escort", "route", ...snapshot.tags]
      });
    }
  }
  return hints.sort((left, right) => right.pressure - left.pressure || left.id.localeCompare(right.id));
}

export function deriveTradeServiceHints(world: World, options: TradeServiceHintOptions = {}): TradeServiceHintSet {
  const context = buildContext(world, options);
  return {
    tick: world.tick,
    assets: assetHintsForSettlements(world, context).slice(0, options.maxAssetHints ?? defaultMaxAssetHints),
    agreements: agreementHintsForRoutes(world).slice(0, options.maxAgreementHints ?? defaultMaxAgreementHints)
  };
}

export function deriveTradeServiceSnapshot(world: World, options: TradeServicePressureOptions & TradeServiceHintOptions = {}): TradeServiceSnapshot {
  return {
    tick: world.tick,
    routes: deriveTradeRouteSnapshots(world),
    signals: collectTradeServicePressureSignals(world, options),
    hints: deriveTradeServiceHints(world, options)
  };
}

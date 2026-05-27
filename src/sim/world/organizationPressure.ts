import { clamp } from "../core/math";
import type { OrganizationSignalKind, OrganizationTickSignal } from "../economy/organizations";
import type { EventKind, Id, QuestKind, World } from "../types";
import type { QuestNeedKind, QuestNeedProposal, QuestNeedSourceKind } from "./questNeeds";

type OrganizationPressurePriority = OrganizationTickSignal["priority"];
type OrganizationPressureSignalBase = Pick<
  OrganizationTickSignal,
  "organizationId" | "assetId" | "factionId" | "settlementId" | "kind" | "pressure" | "text"
>;

export interface OrganizationPressureSignalLike extends OrganizationPressureSignalBase {
  id?: Id;
  priority?: OrganizationPressurePriority;
  questKind?: QuestKind;
  tags?: readonly string[];
  organizationName?: string;
  assetName?: string;
  sourceKind?: QuestNeedSourceKind;
  sourceId?: Id;
  locationId?: Id;
}

export interface OrganizationPressureAdapterOptions {
  minPressure?: number;
  maxProposals?: number;
  maxSummaries?: number;
  maxPerOrganization?: number;
  maxPerAsset?: number;
  maxPerLocation?: number;
  includeLowPriority?: boolean;
  existingSignatures?: readonly string[];
  allowExistingQuestDuplicates?: boolean;
}

export interface OrganizationPressureChronicleSummary {
  signature: string;
  eventKind: EventKind;
  severity: "low" | "medium" | "high";
  text: string;
  actorIds: Id[];
  factionIds: Id[];
  locationId?: Id;
  organizationId: Id;
  assetId: Id;
  signalId?: Id;
  pressure: number;
  priority: number;
  tags: string[];
}

interface OrganizationPressureContext {
  locationId?: Id;
  organizationName: string;
  assetName: string;
  factionName: string;
  settlementName: string;
  pressure: number;
  priority: OrganizationPressurePriority;
  sourceKind: QuestNeedSourceKind;
  sourceId: Id;
  signature: string;
  tags: string[];
}

const defaultMinPressure = 40;
const defaultMaxProposals = 8;
const defaultMaxSummaries = 8;
const defaultMaxPerOrganization = 2;
const defaultMaxPerAsset = 1;
const defaultMaxPerLocation = 3;

const needKindBySignalKind: Record<OrganizationSignalKind, QuestNeedKind> = {
  "request-guards": "organization-guards",
  "request-escorts": "organization-escorts",
  "request-herbs": "organization-supplies",
  "request-wardens": "organization-wardens",
  "call-mediation": "organization-mediation",
  "repair-asset": "organization-repair",
  "settle-charter": "organization-charter",
  "recruit-labor": "organization-labor",
  "survey-claim": "organization-survey"
};

const questKindBySignalKind: Record<OrganizationSignalKind, QuestKind> = {
  "request-guards": "hunt",
  "request-escorts": "escort",
  "request-herbs": "escort",
  "request-wardens": "delve",
  "call-mediation": "politics",
  "repair-asset": "defense",
  "settle-charter": "politics",
  "recruit-labor": "politics",
  "survey-claim": "delve"
};

function cleanText(value: string, fallback: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 0 ? clean : fallback;
}

function shortId(id: Id): string {
  return id.length <= 10 ? id : id.slice(0, 10);
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function pressurePriority(signal: OrganizationPressureSignalLike): number {
  const priority = signal.priority ?? priorityForPressure(signal.pressure);
  const boost = priority === "high" ? 18 : priority === "medium" ? 8 : 0;
  return clamp(Math.round(signal.pressure + boost), 0, 130);
}

function priorityForPressure(pressure: number): OrganizationPressurePriority {
  if (pressure >= 76) {
    return "high";
  }
  if (pressure >= 55) {
    return "medium";
  }
  return "low";
}

function severityFor(signal: OrganizationPressureSignalLike): OrganizationPressureChronicleSummary["severity"] {
  const pressure = signal.pressure;
  const priority = signal.priority ?? priorityForPressure(pressure);
  if (priority === "high" || pressure >= 76) {
    return "high";
  }
  if (priority === "medium" || pressure >= 55) {
    return "medium";
  }
  return "low";
}

function sortedSignals(signals: readonly OrganizationPressureSignalLike[]): OrganizationPressureSignalLike[] {
  return [...signals].sort(
    (left, right) =>
      pressurePriority(right) - pressurePriority(left) ||
      right.pressure - left.pressure ||
      left.kind.localeCompare(right.kind) ||
      left.organizationId.localeCompare(right.organizationId) ||
      left.assetId.localeCompare(right.assetId) ||
      (left.id ?? left.text).localeCompare(right.id ?? right.text)
  );
}

function countFor(counts: Map<Id, number>, id: Id | undefined): number {
  return id ? counts.get(id) ?? 0 : 0;
}

function increment(counts: Map<Id, number>, id: Id | undefined): void {
  if (id) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
}

function signalLocationId(world: World, signal: OrganizationPressureSignalLike): Id | undefined {
  return (
    signal.locationId ??
    signal.settlementId ??
    world.assets?.[signal.assetId]?.locationId ??
    world.organizations?.[signal.organizationId]?.homeSettlementId ??
    world.factions[signal.factionId]?.capitalId
  );
}

export function organizationPressureSignature(signal: OrganizationPressureSignalLike, locationId = signal.locationId ?? signal.settlementId ?? ""): string {
  return ["organization-pressure", signal.kind, signal.organizationId, signal.assetId, signal.factionId, locationId].join(":");
}

function resolveContext(world: World, signal: OrganizationPressureSignalLike): OrganizationPressureContext {
  const locationId = signalLocationId(world, signal);
  const organization = world.organizations?.[signal.organizationId];
  const asset = world.assets?.[signal.assetId];
  const faction = world.factions[signal.factionId];
  const settlement = locationId ? world.settlements[locationId] : undefined;
  const pressure = clamp(Math.round(signal.pressure), 0, 100);
  const priority = signal.priority ?? priorityForPressure(pressure);
  const sourceKind = signal.sourceKind ?? "asset";
  const sourceId = signal.sourceId ?? signal.assetId;
  const tags = uniqueText(["organization-pressure", "economy", signal.kind, ...(signal.tags ?? []), `org:${signal.organizationId}`, `asset:${signal.assetId}`]).slice(0, 16);
  return {
    locationId,
    organizationName: cleanText(signal.organizationName ?? organization?.name ?? "", `Organization ${shortId(signal.organizationId)}`),
    assetName: cleanText(signal.assetName ?? asset?.name ?? "", `Asset ${shortId(signal.assetId)}`),
    factionName: cleanText(faction?.name ?? "", `Faction ${shortId(signal.factionId)}`),
    settlementName: cleanText(settlement?.name ?? "", "the local settlement"),
    pressure,
    priority,
    sourceKind,
    sourceId,
    signature: organizationPressureSignature(signal, locationId ?? ""),
    tags
  };
}

function titleForSignal(signal: OrganizationPressureSignalLike, context: OrganizationPressureContext): string {
  if (signal.kind === "request-guards") {
    return `Post guards for ${context.assetName}`;
  }
  if (signal.kind === "request-escorts") {
    return `Escort ${context.assetName} traffic`;
  }
  if (signal.kind === "request-herbs") {
    return `Supply ${context.assetName}`;
  }
  if (signal.kind === "request-wardens") {
    return `Send wardens to ${context.assetName}`;
  }
  if (signal.kind === "call-mediation") {
    return `Mediate ${context.assetName} pressure`;
  }
  if (signal.kind === "repair-asset") {
    return `Repair ${context.assetName}`;
  }
  if (signal.kind === "settle-charter") {
    return `Settle ${context.assetName} charter`;
  }
  if (signal.kind === "recruit-labor") {
    return `Recruit labor for ${context.assetName}`;
  }
  return `Survey ${context.assetName}`;
}

function summaryForSignal(signal: OrganizationPressureSignalLike, context: OrganizationPressureContext): string {
  const detail = cleanText(signal.text, `${context.organizationName} reports pressure around ${context.assetName}.`);
  if (signal.kind === "request-guards") {
    return `${detail} ${context.factionName} needs guards at ${context.settlementName} before business pressure turns into open danger.`;
  }
  if (signal.kind === "request-escorts") {
    return `${detail} Escorts can keep traffic moving and prevent a local shortage from spreading through the route ledger.`;
  }
  if (signal.kind === "request-herbs") {
    return `${detail} The contract is to secure supplies, medicines, or glassware without letting scarcity become faction grievance.`;
  }
  if (signal.kind === "request-wardens") {
    return `${detail} Ward-trained help can calm rites, graves, or old claims before fear hardens into unrest.`;
  }
  if (signal.kind === "call-mediation") {
    return `${detail} Mediators can settle witnesses, obligations, and public trust before the dispute becomes a political break.`;
  }
  if (signal.kind === "repair-asset") {
    return `${detail} Repair crews and defenders can stabilize the site before lost output becomes a wider economic problem.`;
  }
  if (signal.kind === "settle-charter") {
    return `${detail} The pressure calls for papers, witnesses, and a clean ruling before rival claims become violence.`;
  }
  if (signal.kind === "recruit-labor") {
    return `${detail} Recruiters need credible terms and safe passage so the work can continue without coercion or unrest.`;
  }
  return `${detail} A survey team can turn rumor into a mapped claim and prevent wildcat pressure around the asset.`;
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

function shouldSkipSignal(signal: OrganizationPressureSignalLike, options: OrganizationPressureAdapterOptions): boolean {
  const minPressure = options.minPressure ?? defaultMinPressure;
  if (signal.pressure < minPressure) {
    return true;
  }
  return (options.includeLowPriority ?? true) === false && (signal.priority ?? priorityForPressure(signal.pressure)) === "low";
}

export function organizationPressureToQuestProposal(world: World, signal: OrganizationPressureSignalLike): QuestNeedProposal | undefined {
  const context = resolveContext(world, signal);
  if (!context.locationId || !world.settlements[context.locationId] || !world.factions[signal.factionId]) {
    return undefined;
  }
  const kind = signal.questKind ?? questKindBySignalKind[signal.kind];
  const priorityBoost = context.priority === "high" ? 18 : context.priority === "medium" ? 8 : 0;
  const danger = clamp(Math.round(18 + context.pressure * 0.62 + priorityBoost), 12, 98);
  const urgency = clamp(Math.round(28 + context.pressure * 0.92 + priorityBoost), 20, 130);
  const priority = clamp(Math.round(context.pressure + danger * 0.28 + urgency * 0.14 + priorityBoost), 0, 180);
  return {
    signature: context.signature,
    needKind: needKindBySignalKind[signal.kind],
    title: titleForSignal(signal, context),
    kind,
    issuerFactionId: signal.factionId,
    locationId: context.locationId,
    danger,
    rewardGold: Math.ceil(danger * 1.8 + context.pressure * 0.45),
    rewardRenown: Math.ceil(danger / 8 + context.pressure / 30),
    urgency,
    priority,
    summary: summaryForSignal(signal, context),
    sourceKind: context.sourceKind,
    sourceId: context.sourceId,
    tags: context.tags
  };
}

export function organizationPressureToChronicleSummary(world: World, signal: OrganizationPressureSignalLike): OrganizationPressureChronicleSummary {
  const context = resolveContext(world, signal);
  const severity = severityFor(signal);
  const detail = cleanText(signal.text, `${context.organizationName} reports pressure around ${context.assetName}.`);
  return {
    signature: context.signature,
    eventKind: "quest",
    severity,
    text: `${context.organizationName} flags ${context.assetName} near ${context.settlementName}: ${detail}`,
    actorIds: [],
    factionIds: [signal.factionId],
    locationId: context.locationId,
    organizationId: signal.organizationId,
    assetId: signal.assetId,
    signalId: signal.id,
    pressure: context.pressure,
    priority: pressurePriority(signal),
    tags: context.tags
  };
}

export function proposeOrganizationPressureQuestNeeds(
  world: World,
  signals: readonly OrganizationPressureSignalLike[],
  options: OrganizationPressureAdapterOptions = {}
): QuestNeedProposal[] {
  const maxProposals = options.maxProposals ?? defaultMaxProposals;
  const maxPerOrganization = options.maxPerOrganization ?? defaultMaxPerOrganization;
  const maxPerAsset = options.maxPerAsset ?? defaultMaxPerAsset;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const seen = new Set(options.existingSignatures ?? []);
  const perOrganization = new Map<Id, number>();
  const perAsset = new Map<Id, number>();
  const perLocation = new Map<Id, number>();
  const proposals: QuestNeedProposal[] = [];

  for (const signal of sortedSignals(signals)) {
    if (proposals.length >= maxProposals || shouldSkipSignal(signal, options)) {
      continue;
    }
    const proposal = organizationPressureToQuestProposal(world, signal);
    if (!proposal || seen.has(proposal.signature)) {
      continue;
    }
    if (
      countFor(perOrganization, signal.organizationId) >= maxPerOrganization ||
      countFor(perAsset, signal.assetId) >= maxPerAsset ||
      countFor(perLocation, proposal.locationId) >= maxPerLocation
    ) {
      continue;
    }
    if (!(options.allowExistingQuestDuplicates ?? false) && equivalentOpenQuest(world, proposal)) {
      continue;
    }
    seen.add(proposal.signature);
    increment(perOrganization, signal.organizationId);
    increment(perAsset, signal.assetId);
    increment(perLocation, proposal.locationId);
    proposals.push(proposal);
  }

  return proposals;
}

export function summarizeOrganizationPressure(
  world: World,
  signals: readonly OrganizationPressureSignalLike[],
  options: OrganizationPressureAdapterOptions = {}
): OrganizationPressureChronicleSummary[] {
  const maxSummaries = options.maxSummaries ?? defaultMaxSummaries;
  const maxPerOrganization = options.maxPerOrganization ?? defaultMaxPerOrganization;
  const maxPerAsset = options.maxPerAsset ?? defaultMaxPerAsset;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const seen = new Set(options.existingSignatures ?? []);
  const perOrganization = new Map<Id, number>();
  const perAsset = new Map<Id, number>();
  const perLocation = new Map<Id, number>();
  const summaries: OrganizationPressureChronicleSummary[] = [];

  for (const signal of sortedSignals(signals)) {
    if (summaries.length >= maxSummaries || shouldSkipSignal(signal, options)) {
      continue;
    }
    const summary = organizationPressureToChronicleSummary(world, signal);
    if (seen.has(summary.signature)) {
      continue;
    }
    if (
      countFor(perOrganization, signal.organizationId) >= maxPerOrganization ||
      countFor(perAsset, signal.assetId) >= maxPerAsset ||
      countFor(perLocation, summary.locationId) >= maxPerLocation
    ) {
      continue;
    }
    seen.add(summary.signature);
    increment(perOrganization, signal.organizationId);
    increment(perAsset, signal.assetId);
    increment(perLocation, summary.locationId);
    summaries.push(summary);
  }

  return summaries;
}

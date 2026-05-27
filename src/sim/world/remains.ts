import { clamp } from "../core/math";
import type {
  EncounterKind,
  Id,
  Person,
  QuestKind,
  RemainsBurialStatus,
  RemainsClaimStatus,
  RemainsHauntingStatus,
  RemainsKind,
  RemainsRecord,
  World
} from "../types";
import type { QuestNeedKind, QuestNeedProposal } from "./questNeeds";

export type RemainsPressureKind = "identify-remains" | "retrieve-remains" | "bury-remains" | "cleanse-remains";

export interface RemainsCreationOptions {
  kind?: RemainsKind;
  locationId?: Id;
  claimStatus?: RemainsClaimStatus;
  burialStatus?: RemainsBurialStatus;
  hauntingStatus?: RemainsHauntingStatus;
  claimedByPersonId?: Id;
  claimedByFactionId?: Id;
  discovered?: boolean;
  force?: boolean;
  tick?: number;
  tags?: readonly string[];
}

export interface RemainsClaimOptions {
  claimantPersonId?: Id;
  claimantFactionId?: Id;
  tick?: number;
  tags?: readonly string[];
}

export interface RemainsBurialOptions {
  burialLocationId?: Id;
  graveyardAssetId?: Id;
  tick?: number;
  tags?: readonly string[];
}

export interface RemainsPressureSignal {
  id: Id;
  signature: string;
  kind: RemainsPressureKind;
  remainsId: Id;
  personId?: Id;
  personName: string;
  issuerFactionId?: Id;
  locationId?: Id;
  pressure: number;
  danger: number;
  urgency: number;
  priority: number;
  questKind?: QuestKind;
  encounterKind?: EncounterKind;
  encounterDelta?: number;
  tags: string[];
  summary: string;
}

export interface RemainsPressureOptions {
  minPressure?: number;
  maxSignals?: number;
  includeBuried?: boolean;
  includeQuestSignals?: boolean;
  includeEncounterSignals?: boolean;
}

export interface RemainsPressureQuestOptions extends RemainsPressureOptions {
  allowExistingQuestDuplicates?: boolean;
  existingSignatures?: readonly string[];
  maxProposals?: number;
  maxPerLocation?: number;
}

export interface ApplyRemainsEncounterPressureOptions extends RemainsPressureOptions {
  maxDeltaPerKind?: number;
}

const approximateTicksPerDay = 6;
const defaultMinPressure = 28;
const defaultMaxSignals = 16;
const defaultMaxProposals = 8;
const defaultMaxPerLocation = 3;
const defaultMaxDeltaPerKind = 36;

const needKindByPressureKind: Record<RemainsPressureKind, QuestNeedKind> = {
  "identify-remains": "organization-mediation",
  "retrieve-remains": "organization-escorts",
  "bury-remains": "organization-wardens",
  "cleanse-remains": "exorcise-haunting"
};

const questKindByPressureKind: Record<RemainsPressureKind, QuestKind> = {
  "identify-remains": "politics",
  "retrieve-remains": "escort",
  "bury-remains": "escort",
  "cleanse-remains": "delve"
};

function stableTextCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return code;
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function personName(person: Person): string {
  return `${person.name} ${person.familyName}`.trim();
}

function remainsIdForPerson(personId: Id): Id {
  return `remains-${stableTextCode(personId).toString(36)}`;
}

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function deathAgeDays(world: World, remains: RemainsRecord): number {
  return Math.max(0, Math.floor((world.tick - remains.deathTick) / approximateTicksPerDay));
}

function resolveLocation(world: World, locationId: Id | undefined): Pick<RemainsRecord, "locationId" | "mediumRegionId" | "x" | "y"> {
  const settlement = locationId ? world.settlements[locationId] : undefined;
  return settlement
    ? {
        locationId: settlement.id,
        mediumRegionId: settlement.mediumRegionId,
        x: settlement.x,
        y: settlement.y
      }
    : {};
}

function retrievalPriorityFor(person: Person): number {
  const roleBoost = person.role === "leader" ? 18 : person.role === "fighter" || person.role === "healer" || person.role === "mage" ? 10 : 0;
  const familyBoost = person.childIds.length > 0 || person.parentIds.length > 0 ? 8 : 0;
  return rounded(18 + person.renown * 0.55 + roleBoost + familyBoost + Math.max(0, person.traits.loyalty) * 0.08, 0, 100);
}

function sortSignals(signals: readonly RemainsPressureSignal[]): RemainsPressureSignal[] {
  return [...signals].sort(
    (left, right) =>
      right.priority - left.priority ||
      right.pressure - left.pressure ||
      right.danger - left.danger ||
      left.kind.localeCompare(right.kind) ||
      left.remainsId.localeCompare(right.remainsId)
  );
}

function hasOpenEquivalentQuest(world: World, proposal: QuestNeedProposal): boolean {
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

function pressureKindFor(remains: RemainsRecord): RemainsPressureKind | undefined {
  if (remains.burialStatus === "buried" || remains.burialStatus === "lost") {
    return remains.hauntingStatus === "haunted" ? "cleanse-remains" : undefined;
  }
  if (remains.hauntingStatus === "haunted" || remains.hauntingStatus === "restless") {
    return "cleanse-remains";
  }
  if (remains.claimStatus === "unknown" || remains.kind === "unknown" || !remains.personId) {
    return "identify-remains";
  }
  if (remains.claimStatus === "unclaimed") {
    return "retrieve-remains";
  }
  return "bury-remains";
}

function titleForSignal(world: World, signal: RemainsPressureSignal): string {
  const settlement = signal.locationId ? world.settlements[signal.locationId] : undefined;
  if (signal.kind === "identify-remains") return `Identify remains near ${settlement?.name ?? "the frontier"}`;
  if (signal.kind === "retrieve-remains") return `Retrieve ${signal.personName}`;
  if (signal.kind === "bury-remains") return `Lay ${signal.personName} to rest`;
  return `Cleanse the remains of ${signal.personName}`;
}

function signalFromRemains(world: World, remains: RemainsRecord): RemainsPressureSignal | undefined {
  const kind = pressureKindFor(remains);
  if (!kind) {
    return undefined;
  }
  const settlement = remains.locationId ? world.settlements[remains.locationId] : undefined;
  const ageDays = deathAgeDays(world, remains);
  const person = remains.personId ? world.persons[remains.personId] : undefined;
  const issuerFactionId = remains.claimedByFactionId ?? remains.factionId ?? settlement?.factionId;
  const knownPlace = settlement?.name ?? "an unknown place";
  const memoryWeight = person ? Math.max(0, person.renown) * 0.45 : 8;
  const agePressure = clamp(ageDays * 1.4, 0, 38);
  const settlementPressure = settlement ? settlement.unrest * 0.18 + settlement.threat * 0.22 : 12;
  const claimPressure = remains.claimStatus === "claimed" ? 10 : remains.claimStatus === "unknown" ? 16 : 22;
  const burialPressure = remains.burialStatus === "retrieving" ? 18 : remains.burialStatus === "unburied" ? 26 : 6;
  const hauntingPressure = remains.hauntingStatus === "haunted" ? 42 : remains.hauntingStatus === "restless" ? 24 : 0;
  const pressure = rounded(remains.retrievalPriority * 0.55 + memoryWeight + agePressure + settlementPressure + claimPressure + burialPressure + hauntingPressure, 0, 140);
  const danger = rounded((settlement?.threat ?? 18) + hauntingPressure * 0.55 + (kind === "retrieve-remains" ? 8 : 0), 8, 98);
  const urgency = rounded(pressure + ageDays * 0.6 + hauntingPressure * 0.5, 0, 160);
  const priority = rounded(pressure + danger * 0.35 + (kind === "cleanse-remains" ? 18 : 0), 0, 180);
  const encounterKind = kind === "cleanse-remains" ? "gravebreak" : undefined;
  const tags = uniqueText([
    "remains",
    kind,
    remains.kind,
    remains.claimStatus,
    remains.burialStatus,
    remains.hauntingStatus,
    remains.personId ? `person:${remains.personId}` : undefined,
    remains.locationId ? `settlement:${remains.locationId}` : undefined,
    ...(remains.tags ?? [])
  ]).slice(0, 18);
  const summary =
    kind === "identify-remains"
      ? `${remains.personName} is not reliably identified at ${knownPlace}. Locals need witnesses, records, or kinship proof before anyone can claim the dead.`
      : kind === "retrieve-remains"
        ? `${remains.personName} remains unclaimed at ${knownPlace}. A retrieval party can return the body before grief, animals, or rumor turn it into wider pressure.`
        : kind === "bury-remains"
          ? `${remains.personName} has been claimed but not buried at ${knownPlace}. A graveyard, temple, or family rite can turn open grief into stable memory.`
          : `${remains.personName} is tied to restless death-signs at ${knownPlace}. Wardens or holy workers should cleanse the site before it becomes a gravebreak.`;

  return {
    id: `remains-pressure-${stableTextCode(`${kind}:${remains.id}:${remains.locationId ?? "unknown"}`).toString(36)}`,
    signature: ["remains-pressure", kind, remains.id, remains.locationId ?? "", issuerFactionId ?? ""].join(":"),
    kind,
    remainsId: remains.id,
    personId: remains.personId,
    personName: remains.personName,
    issuerFactionId,
    locationId: remains.locationId,
    pressure,
    danger,
    urgency,
    priority,
    questKind: remains.locationId && issuerFactionId ? questKindByPressureKind[kind] : undefined,
    encounterKind,
    encounterDelta: encounterKind ? rounded(pressure * 0.16 + hauntingPressure * 0.25, 1, 30) : undefined,
    tags,
    summary
  };
}

export function ensureRemainsState(world: World): Record<Id, RemainsRecord> {
  world.remains ??= {};
  return world.remains;
}

export function createRemainsFromPerson(world: World, person: Person, options: RemainsCreationOptions = {}): RemainsRecord | undefined {
  if (person.alive && !(options.force ?? false)) {
    return undefined;
  }
  const remains = ensureRemainsState(world);
  const id = remainsIdForPerson(person.id);
  const existing = remains[id];
  if (existing) {
    return existing;
  }
  const location = resolveLocation(world, options.locationId ?? person.locationId);
  const claimed = Boolean(options.claimedByPersonId || options.claimedByFactionId);
  const record: RemainsRecord = {
    id,
    kind: options.kind ?? "corpse",
    personId: person.id,
    personName: personName(person),
    factionId: person.factionId,
    cultureId: person.cultureId,
    ancestry: person.ancestry,
    ...location,
    deathTick: options.tick ?? world.tick,
    createdTick: world.tick,
    discoveredTick: options.discovered === false ? undefined : world.tick,
    claimStatus: options.claimStatus ?? (claimed ? "claimed" : "unclaimed"),
    burialStatus: options.burialStatus ?? "unburied",
    hauntingStatus: options.hauntingStatus ?? "none",
    claimedByPersonId: options.claimedByPersonId,
    claimedByFactionId: options.claimedByFactionId,
    retrievalPriority: retrievalPriorityFor(person),
    tags: uniqueText(["remains", "corpse", person.role, person.ancestry, person.factionId, ...(person.status ?? []), ...(options.tags ?? [])]).slice(0, 20)
  };
  remains[id] = record;
  return record;
}

export function syncRemainsForDeadPersons(world: World, options: RemainsCreationOptions & { maxCreated?: number } = {}): RemainsRecord[] {
  const maxCreated = options.maxCreated ?? Number.POSITIVE_INFINITY;
  const remains = ensureRemainsState(world);
  const existingPersonIds = new Set(Object.values(remains).map((record) => record.personId).filter((id): id is Id => Boolean(id)));
  const created: RemainsRecord[] = [];
  for (const person of Object.values(world.persons).sort((left, right) => left.id.localeCompare(right.id))) {
    if (created.length >= maxCreated || person.alive || existingPersonIds.has(person.id)) {
      continue;
    }
    const record = createRemainsFromPerson(world, person, options);
    if (record) {
      existingPersonIds.add(person.id);
      created.push(record);
    }
  }
  return created;
}

export function assignRemainsLocation(world: World, remainsId: Id, locationId: Id): RemainsRecord | undefined {
  const remains = ensureRemainsState(world)[remainsId];
  const location = resolveLocation(world, locationId);
  if (!remains || !location.locationId) {
    return undefined;
  }
  remains.locationId = location.locationId;
  remains.mediumRegionId = location.mediumRegionId;
  remains.x = location.x;
  remains.y = location.y;
  remains.discoveredTick ??= world.tick;
  remains.tags = uniqueText([...remains.tags, "located"]);
  return remains;
}

export function markRemainsLocationUnknown(world: World, remainsId: Id): RemainsRecord | undefined {
  const remains = ensureRemainsState(world)[remainsId];
  if (!remains) {
    return undefined;
  }
  remains.locationId = undefined;
  remains.mediumRegionId = undefined;
  remains.x = undefined;
  remains.y = undefined;
  remains.claimStatus = "unknown";
  remains.tags = uniqueText([...remains.tags, "missing", "unknown-location"]);
  return remains;
}

export function claimRemains(world: World, remainsId: Id, options: RemainsClaimOptions = {}): RemainsRecord | undefined {
  const remains = ensureRemainsState(world)[remainsId];
  if (!remains) {
    return undefined;
  }
  remains.claimStatus = "claimed";
  remains.claimedByPersonId = options.claimantPersonId ?? remains.claimedByPersonId;
  remains.claimedByFactionId = options.claimantFactionId ?? remains.claimedByFactionId ?? remains.factionId;
  remains.discoveredTick ??= options.tick ?? world.tick;
  remains.tags = uniqueText([...remains.tags, "claimed", ...(options.tags ?? [])]);
  return remains;
}

export function buryRemains(world: World, remainsId: Id, options: RemainsBurialOptions = {}): RemainsRecord | undefined {
  const remains = ensureRemainsState(world)[remainsId];
  if (!remains) {
    return undefined;
  }
  const graveyard = options.graveyardAssetId ? world.assets?.[options.graveyardAssetId] : undefined;
  const burialLocationId = options.burialLocationId ?? graveyard?.locationId ?? remains.locationId;
  if (burialLocationId) {
    assignRemainsLocation(world, remainsId, burialLocationId);
  }
  remains.burialStatus = "buried";
  remains.hauntingStatus = "none";
  remains.burialLocationId = burialLocationId;
  remains.graveyardAssetId = options.graveyardAssetId ?? remains.graveyardAssetId;
  remains.discoveredTick ??= options.tick ?? world.tick;
  remains.tags = uniqueText([...remains.tags, "buried", ...(options.tags ?? [])]);
  return remains;
}

export function markRemainsHaunting(world: World, remainsId: Id, status: RemainsHauntingStatus = "haunted"): RemainsRecord | undefined {
  const remains = ensureRemainsState(world)[remainsId];
  if (!remains) {
    return undefined;
  }
  remains.hauntingStatus = status;
  remains.tags = uniqueText([...remains.tags, status === "none" ? "cleansed" : status]);
  return remains;
}

export function findLocalGraveyardAsset(world: World, locationId: Id | undefined, factionId?: Id): Id | undefined {
  const assets = Object.values(world.assets ?? {}).filter((asset) => asset.kind === "graveyard" && asset.status !== "abandoned" && asset.status !== "sealed");
  const scored = assets
    .map((asset) => {
      const ownerMatch = factionId && asset.owner.kind === "faction" && asset.owner.id === factionId ? 18 : 0;
      const operatorMatch = factionId && asset.operator.kind === "faction" && asset.operator.id === factionId ? 12 : 0;
      const placeMatch = locationId && asset.locationId === locationId ? 80 : 0;
      const active = asset.status === "active" ? 10 : 0;
      return { asset, score: placeMatch + ownerMatch + operatorMatch + active + asset.integrity * 0.08 };
    })
    .sort((left, right) => right.score - left.score || left.asset.id.localeCompare(right.asset.id));
  return scored[0]?.asset.id;
}

export function collectRemainsPressureSignals(world: World, options: RemainsPressureOptions = {}): RemainsPressureSignal[] {
  const minPressure = options.minPressure ?? defaultMinPressure;
  const maxSignals = options.maxSignals ?? defaultMaxSignals;
  const signals: RemainsPressureSignal[] = [];
  for (const remains of Object.values(world.remains ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    if (!options.includeBuried && remains.burialStatus === "buried" && remains.hauntingStatus !== "haunted") {
      continue;
    }
    const signal = signalFromRemains(world, remains);
    if (!signal || signal.pressure < minPressure) {
      continue;
    }
    if (options.includeQuestSignals && !signal.questKind) {
      continue;
    }
    if (options.includeEncounterSignals && !signal.encounterKind) {
      continue;
    }
    signals.push(signal);
  }
  return sortSignals(signals).slice(0, maxSignals);
}

export function remainsPressureToQuestProposal(world: World, signal: RemainsPressureSignal): QuestNeedProposal | undefined {
  if (!signal.questKind || !signal.locationId || !signal.issuerFactionId || !world.settlements[signal.locationId] || !world.factions[signal.issuerFactionId]) {
    return undefined;
  }
  const danger = rounded(signal.danger, 8, 98);
  const urgency = rounded(signal.urgency, 20, 140);
  const priority = rounded(signal.priority, 0, 180);
  return {
    signature: signal.signature,
    needKind: needKindByPressureKind[signal.kind],
    title: titleForSignal(world, signal),
    kind: signal.questKind,
    issuerFactionId: signal.issuerFactionId,
    locationId: signal.locationId,
    danger,
    rewardGold: Math.ceil(danger * 1.25 + signal.pressure * 0.34),
    rewardRenown: Math.ceil(danger / 12 + signal.pressure / 42),
    urgency,
    priority,
    summary: signal.summary,
    sourceKind: "settlement",
    sourceId: signal.locationId,
    tags: uniqueText([...signal.tags, `remains:${signal.remainsId}`]).slice(0, 18)
  };
}

export function proposeRemainsPressureQuestNeeds(world: World, options: RemainsPressureQuestOptions = {}): QuestNeedProposal[] {
  const maxProposals = options.maxProposals ?? defaultMaxProposals;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const seen = new Set(options.existingSignatures ?? []);
  const perLocation = new Map<Id, number>();
  const proposals: QuestNeedProposal[] = [];
  for (const signal of collectRemainsPressureSignals(world, { ...options, includeQuestSignals: true })) {
    if (proposals.length >= maxProposals || seen.has(signal.signature)) {
      continue;
    }
    const proposal = remainsPressureToQuestProposal(world, signal);
    if (!proposal) {
      continue;
    }
    const locationCount = perLocation.get(proposal.locationId) ?? 0;
    if (locationCount >= maxPerLocation) {
      continue;
    }
    if (!(options.allowExistingQuestDuplicates ?? false) && hasOpenEquivalentQuest(world, proposal)) {
      continue;
    }
    seen.add(proposal.signature);
    perLocation.set(proposal.locationId, locationCount + 1);
    proposals.push(proposal);
  }
  return proposals;
}

export function remainsPressureEncounterDeltas(signals: readonly RemainsPressureSignal[]): Partial<Record<EncounterKind, number>> {
  const deltas: Partial<Record<EncounterKind, number>> = {};
  for (const signal of signals) {
    if (!signal.encounterKind) {
      continue;
    }
    deltas[signal.encounterKind] = rounded((deltas[signal.encounterKind] ?? 0) + (signal.encounterDelta ?? 1), 0, 100);
  }
  return deltas;
}

export function applyRemainsEncounterPressure(world: World, options: ApplyRemainsEncounterPressureOptions = {}): Partial<Record<EncounterKind, number>> {
  const signals = collectRemainsPressureSignals(world, { ...options, includeEncounterSignals: true });
  const deltas = remainsPressureEncounterDeltas(signals);
  const maxDelta = options.maxDeltaPerKind ?? defaultMaxDeltaPerKind;
  world.encounterPressure ??= {};
  for (const [kind, rawDelta] of Object.entries(deltas) as [EncounterKind, number][]) {
    const delta = rounded(rawDelta, 0, maxDelta);
    world.encounterPressure[kind] = rounded((world.encounterPressure[kind] ?? 0) + delta, 0, 100);
    deltas[kind] = delta;
  }
  return deltas;
}

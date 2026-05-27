import { event } from "../chronicle/events";
import { clamp } from "../core/math";
import type { Faction, Id, Quest, QuestKind, Settlement, StoryArtifact, World, WorldFeature } from "../types";

export type QuestNeedKind =
  | "clear-fauna"
  | "exorcise-haunting"
  | "defend-raid"
  | "peacekeep-raid"
  | "guard-artifact"
  | "intercept-artifact"
  | "expose-artifact-claim"
  | "destroy-artifact"
  | "organization-guards"
  | "organization-escorts"
  | "organization-supplies"
  | "organization-wardens"
  | "organization-mediation"
  | "organization-repair"
  | "organization-charter"
  | "organization-labor"
  | "organization-survey";

export type QuestNeedSourceKind = "feature" | "holding" | "settlement" | "band" | "artifact" | "quest" | "organization" | "asset";

export interface QuestNeed {
  id: Id;
  kind: QuestNeedKind;
  sourceKind: QuestNeedSourceKind;
  sourceId: Id;
  sourceName: string;
  locationId: Id;
  issuerFactionId: Id;
  targetFactionId?: Id;
  subject: string;
  pressure: number;
  danger: number;
  tags: string[];
  counterToQuestId?: Id;
}

export interface QuestNeedProposal {
  signature: string;
  needKind: QuestNeedKind;
  title: string;
  kind: QuestKind;
  issuerFactionId: Id;
  locationId: Id;
  targetFactionId?: Id;
  danger: number;
  rewardGold: number;
  rewardRenown: number;
  urgency: number;
  priority: number;
  summary: string;
  sourceKind: QuestNeedSourceKind;
  sourceId: Id;
  tags: string[];
  counterToQuestId?: Id;
}

export interface QuestNeedLaneOptions {
  includeAssetNeeds?: boolean;
  includeGroupNeeds?: boolean;
  includeCounterquests?: boolean;
  maxProposals?: number;
  maxCreated?: number;
  maxOpenQuests?: number;
  maxOpenPerLocation?: number;
  emitEvents?: boolean;
  intervalTicks?: number;
}

const defaultMaxProposals = 12;
const defaultMaxCreated = 3;
const defaultMaxOpenQuests = 14;
const defaultMaxOpenPerLocation = 3;

const faunaHazardTerms = [
  "adder",
  "bear",
  "boar",
  "cat",
  "eagle",
  "hawk",
  "jackal",
  "kite",
  "lynx",
  "serpent",
  "spider",
  "stag",
  "warg",
  "wolf"
];

const hauntingTerms = [
  "barrow",
  "cairn",
  "crypt",
  "curse",
  "cursed",
  "dead",
  "ghost",
  "grave",
  "haunt",
  "oath",
  "revenant",
  "saint",
  "shrine",
  "spirit",
  "tomb",
  "undead",
  "wraith"
];

const raidTerms = ["raid", "raiding", "pillage", "loot", "sack", "burn", "plunder"];
const artifactClaimTerms = ["claim", "recover", "steal", "theft", "take", "seize", "relic", "artifact"];

function stableTextCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return code;
}

function stablePick(items: readonly string[], key: string, fallback: string): string {
  const normalized = [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
  if (normalized.length === 0) {
    return fallback;
  }
  return normalized[stableTextCode(key) % normalized.length];
}

function textHasAny(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function liveQuest(quest: Quest): boolean {
  return quest.status === "open" || quest.status === "active";
}

function relationBetween(world: World, factionId: Id, otherFactionId: Id): number {
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

function needId(kind: QuestNeedKind, sourceId: Id, locationId: Id, subject: string): Id {
  return `need-${stableTextCode(`${kind}:${sourceId}:${locationId}:${subject}`).toString(36)}`;
}

function proposalSignature(need: QuestNeed): string {
  return [
    need.kind,
    need.sourceKind,
    need.sourceId,
    need.locationId,
    need.issuerFactionId,
    need.targetFactionId ?? "",
    need.counterToQuestId ?? "",
    need.subject
  ].join(":");
}

function sortedByNeedPriority(needs: QuestNeed[]): QuestNeed[] {
  return [...needs].sort(
    (a, b) =>
      b.pressure - a.pressure ||
      b.danger - a.danger ||
      a.kind.localeCompare(b.kind) ||
      a.sourceId.localeCompare(b.sourceId) ||
      a.subject.localeCompare(b.subject)
  );
}

function sortedByProposalPriority(proposals: QuestNeedProposal[]): QuestNeedProposal[] {
  return [...proposals].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.danger - a.danger ||
      a.needKind.localeCompare(b.needKind) ||
      a.title.localeCompare(b.title) ||
      a.signature.localeCompare(b.signature)
  );
}

function uniqueFactionIds(ids: readonly (Id | undefined)[]): Id[] {
  return [...new Set(ids.filter((id): id is Id => Boolean(id)))];
}

function questKindForNeed(need: QuestNeed): QuestKind {
  if (need.kind === "clear-fauna" || need.kind === "intercept-artifact") {
    return "hunt";
  }
  if (need.kind === "defend-raid" || need.kind === "guard-artifact") {
    return "defense";
  }
  if (need.kind === "peacekeep-raid" || need.kind === "expose-artifact-claim") {
    return "politics";
  }
  return "delve";
}

function titleForNeed(world: World, need: QuestNeed): string {
  const settlement = world.settlements[need.locationId];
  if (need.kind === "clear-fauna") return `Clear ${need.subject} from ${need.sourceName}`;
  if (need.kind === "exorcise-haunting") return `Exorcise ${need.sourceName}`;
  if (need.kind === "defend-raid") return `Defend ${settlement?.name ?? need.subject} from ${need.sourceName}`;
  if (need.kind === "peacekeep-raid") return `Keep ${need.sourceName} from looting ${settlement?.name ?? need.subject}`;
  if (need.kind === "guard-artifact") return `Guard ${need.subject} before rivals arrive`;
  if (need.kind === "intercept-artifact") return `Intercept the ${need.subject} claim`;
  if (need.kind === "expose-artifact-claim") return `Expose the ${need.subject} claim`;
  return `Destroy the ${need.subject} lure`;
}

function summaryForNeed(world: World, need: QuestNeed): string {
  const settlement = world.settlements[need.locationId];
  const faction = world.factions[need.issuerFactionId];
  const target = need.targetFactionId ? world.factions[need.targetFactionId] : undefined;
  const place = settlement?.name ?? "the local holding";
  if (need.kind === "clear-fauna") {
    return `${need.sourceName} cannot work cleanly while ${need.subject} controls the approaches. Clear the fauna pressure, reopen the worksite, and keep routine mining accidents from becoming a wider crisis.`;
  }
  if (need.kind === "exorcise-haunting") {
    return `${place} needs holy, ward-trained, or exorcist work around ${need.sourceName}. The contract is about ending a haunting before fear hardens into unrest.`;
  }
  if (need.kind === "defend-raid") {
    return `${need.sourceName} is moving with raid or pillage intent. ${faction?.name ?? "Local leaders"} need defenders to hold ${place}${target ? ` against ${target.name}` : ""}.`;
  }
  if (need.kind === "peacekeep-raid") {
    return `${need.sourceName} is close enough to turn disorder into looting. Peacekeepers can interrupt the plan, broker restraint, and keep ${place} from becoming a reprisal story.`;
  }
  if (need.kind === "guard-artifact") {
    return `Counterquest to "${need.sourceName}". ${faction?.name ?? "A rival faction"} wants ${need.subject} guarded, documented, and kept out of a rival's hands.`;
  }
  if (need.kind === "intercept-artifact") {
    return `Counterquest to "${need.sourceName}". ${faction?.name ?? "A rival faction"} wants the relic route intercepted before the original claim turns into possession.`;
  }
  if (need.kind === "expose-artifact-claim") {
    return `Counterquest to "${need.sourceName}". ${faction?.name ?? "A rival faction"} wants witnesses, lineage claims, and hidden sponsors exposed before ${need.subject} becomes political proof.`;
  }
  return `Counterquest to "${need.sourceName}". ${faction?.name ?? "A rival faction"} believes ${need.subject} is dangerous enough to bind, break, or destroy before anyone can claim it.`;
}

function proposalFromNeed(world: World, need: QuestNeed): QuestNeedProposal | undefined {
  if (!world.settlements[need.locationId] || !world.factions[need.issuerFactionId]) {
    return undefined;
  }
  const kind = questKindForNeed(need);
  const danger = clamp(Math.round(need.danger), 12, 98);
  const urgency = clamp(Math.round(30 + need.pressure * 0.82), 24, 130);
  const priority = clamp(Math.round(need.pressure + danger * 0.34 + urgency * 0.12), 0, 180);
  return {
    signature: proposalSignature(need),
    needKind: need.kind,
    title: titleForNeed(world, need),
    kind,
    issuerFactionId: need.issuerFactionId,
    locationId: need.locationId,
    targetFactionId: need.targetFactionId,
    danger,
    rewardGold: Math.ceil(danger * (need.counterToQuestId ? 2.3 : 2.0)),
    rewardRenown: Math.ceil(danger / 7) + (need.counterToQuestId ? 3 : 1),
    urgency,
    priority,
    summary: summaryForNeed(world, need),
    sourceKind: need.sourceKind,
    sourceId: need.sourceId,
    tags: [...new Set(need.tags)],
    counterToQuestId: need.counterToQuestId
  };
}

export function assetNeedToQuestProposal(world: World, need: QuestNeed): QuestNeedProposal | undefined {
  if (need.sourceKind === "band" || need.sourceKind === "quest") {
    return undefined;
  }
  return proposalFromNeed(world, need);
}

export function groupNeedToQuestProposal(world: World, need: QuestNeed): QuestNeedProposal | undefined {
  if (need.sourceKind !== "band" && need.sourceKind !== "quest") {
    return undefined;
  }
  return proposalFromNeed(world, need);
}

function mineNeeds(world: World): QuestNeed[] {
  const needs: QuestNeed[] = [];
  for (const holding of Object.values(world.planet.holdings ?? {})) {
    if (holding.kind !== "mine" || holding.status === "abandoned") {
      continue;
    }
    const feature = world.planet.features[holding.featureId];
    const settlement = feature ? world.settlements[feature.nearestSettlementId] : undefined;
    if (!feature || !settlement || feature.status === "depleted" || feature.fauna.length === 0) {
      continue;
    }
    const threatText = [...feature.fauna, ...feature.threats, ...feature.tags].join(" ");
    const dangerPressure =
      feature.danger * 0.48 +
      Math.max(0, 70 - feature.stability) * 0.22 +
      settlement.threat * 0.18 +
      Math.max(0, 8 - holding.garrison) * 2.4 +
      (holding.status === "damaged" ? 10 : 0);
    if (dangerPressure < 34 && !textHasAny(threatText, faunaHazardTerms)) {
      continue;
    }
    const subject = stablePick([...feature.threats, ...feature.fauna], feature.id, "wildlife");
    needs.push({
      id: needId("clear-fauna", holding.id, settlement.id, subject),
      kind: "clear-fauna",
      sourceKind: "holding",
      sourceId: holding.id,
      sourceName: holding.name,
      locationId: settlement.id,
      issuerFactionId: holding.factionId,
      subject,
      pressure: clamp(Math.round(dangerPressure), 0, 100),
      danger: clamp(Math.round(feature.danger + Math.max(0, 60 - feature.stability) * 0.18 + (holding.status === "damaged" ? 8 : 0)), 12, 96),
      tags: ["asset", "mine", "fauna", "worksite", feature.kind, feature.layer, holding.outputResource]
    });
  }
  return needs;
}

function hauntedSettlementNeed(settlement: Settlement): QuestNeed | undefined {
  const siteText = [settlement.name, settlement.region, ...settlement.tags, ...settlement.localThreats].join(" ");
  const oldStonePressure = settlement.tags.some((tag) => tag === "old stones" || tag === "shrine") && settlement.threat >= 58;
  if (!textHasAny(siteText, hauntingTerms) && !oldStonePressure) {
    return undefined;
  }
  const pressure = clamp(Math.round(settlement.threat * 0.48 + settlement.unrest * 0.36 + (oldStonePressure ? 12 : 0)), 0, 100);
  if (pressure < 38) {
    return undefined;
  }
  const subject = stablePick(settlement.localThreats, settlement.id, "restless dead");
  return {
    id: needId("exorcise-haunting", settlement.id, settlement.id, subject),
    kind: "exorcise-haunting",
    sourceKind: "settlement",
    sourceId: settlement.id,
    sourceName: settlement.name,
    locationId: settlement.id,
    issuerFactionId: settlement.factionId,
    subject,
    pressure,
    danger: clamp(Math.round(settlement.threat * 0.7 + settlement.unrest * 0.28 + 12), 14, 92),
    tags: ["asset", "haunting", "holy", "exorcist", settlement.terrain, settlement.biomeId]
  };
}

function hauntedFeatureNeed(world: World, feature: WorldFeature): QuestNeed | undefined {
  if (feature.status === "hidden" || feature.status === "depleted") {
    return undefined;
  }
  const settlement = world.settlements[feature.nearestSettlementId];
  if (!settlement) {
    return undefined;
  }
  const siteText = [feature.name, feature.kind, ...feature.tags, ...feature.threats, ...feature.resources].join(" ");
  const vaultPressure = feature.kind === "ancient-vault" && feature.danger >= 48 && textHasAny(siteText, hauntingTerms);
  if (!textHasAny(siteText, hauntingTerms) && !vaultPressure) {
    return undefined;
  }
  const pressure = clamp(Math.round(feature.danger * 0.52 + Math.max(0, 65 - feature.stability) * 0.22 + settlement.unrest * 0.14), 0, 100);
  if (pressure < 38) {
    return undefined;
  }
  const subject = stablePick(feature.threats, feature.id, "restless dead");
  return {
    id: needId("exorcise-haunting", feature.id, settlement.id, subject),
    kind: "exorcise-haunting",
    sourceKind: "feature",
    sourceId: feature.id,
    sourceName: feature.name,
    locationId: settlement.id,
    issuerFactionId: feature.ownerFactionId ?? settlement.factionId,
    subject,
    pressure,
    danger: clamp(Math.round(feature.danger + Math.max(0, 55 - feature.stability) * 0.18), 16, 96),
    tags: ["asset", "haunting", "holy", "exorcist", feature.kind, feature.layer]
  };
}

export function collectAssetNeeds(world: World): QuestNeed[] {
  const needs = [...mineNeeds(world)];
  for (const settlement of Object.values(world.settlements)) {
    const need = hauntedSettlementNeed(settlement);
    if (need) {
      needs.push(need);
    }
  }
  for (const feature of Object.values(world.planet.features ?? {})) {
    const need = hauntedFeatureNeed(world, feature);
    if (need) {
      needs.push(need);
    }
  }
  return sortedByNeedPriority(needs);
}

function bandMemberCount(world: World, memberIds: readonly Id[]): number {
  return memberIds.reduce((count, id) => count + (world.persons[id]?.alive ? 1 : 0), 0);
}

export function collectGroupNeeds(world: World): QuestNeed[] {
  const needs: QuestNeed[] = [];
  for (const band of Object.values(world.bands)) {
    const leader = world.persons[band.leaderId];
    const locationId = band.travel?.destinationId ?? band.locationId;
    const settlement = world.settlements[locationId];
    if (!leader || !settlement) {
      continue;
    }
    const planText = `${band.purpose} ${band.goal}`.toLowerCase();
    if (band.purpose !== "raiding" && !textHasAny(planText, raidTerms)) {
      continue;
    }
    const raiderFactionId = leader.factionId;
    const opposed = raiderFactionId !== settlement.factionId;
    const relation = opposed ? relationBetween(world, settlement.factionId, raiderFactionId) : 0;
    const kind: QuestNeedKind = opposed && relation <= 10 ? "defend-raid" : "peacekeep-raid";
    const members = bandMemberCount(world, band.memberIds);
    const pressure =
      34 +
      band.notoriety * 0.36 +
      members * 5.5 +
      settlement.threat * 0.24 -
      settlement.defense * 0.1 +
      (opposed ? 10 : 0) +
      (relation <= -50 ? 12 : 0);
    if (pressure < 42) {
      continue;
    }
    needs.push({
      id: needId(kind, band.id, settlement.id, settlement.name),
      kind,
      sourceKind: "band",
      sourceId: band.id,
      sourceName: band.name,
      locationId: settlement.id,
      issuerFactionId: settlement.factionId,
      targetFactionId: opposed ? raiderFactionId : undefined,
      subject: settlement.name,
      pressure: clamp(Math.round(pressure), 0, 100),
      danger: clamp(Math.round(28 + band.notoriety * 0.28 + members * 6 + Math.max(0, -relation) * 0.16), 18, 96),
      tags: ["group", "raid", "pillage", kind === "defend-raid" ? "defense" : "peacekeeper"]
    });
  }
  return sortedByNeedPriority(needs);
}

function hostileFactionCandidates(world: World, issuerFactionId: Id): Faction[] {
  return Object.values(world.factions)
    .filter((faction) => faction.id !== issuerFactionId)
    .filter((faction) => relationBetween(world, issuerFactionId, faction.id) <= -20)
    .sort((a, b) => relationBetween(world, issuerFactionId, a.id) - relationBetween(world, issuerFactionId, b.id) || b.military - a.military || a.id.localeCompare(b.id));
}

function artifactCounterFaction(world: World, artifact: StoryArtifact, quest: Quest): Faction | undefined {
  const explicitTarget = quest.targetFactionId && quest.targetFactionId !== quest.issuerFactionId ? world.factions[quest.targetFactionId] : undefined;
  if (explicitTarget) {
    return explicitTarget;
  }
  const birthrightFaction = Object.values(world.factions)
    .filter((faction) => faction.id !== quest.issuerFactionId && (artifact.birthrightCultureIds ?? []).includes(faction.cultureId))
    .sort((a, b) => relationBetween(world, quest.issuerFactionId, a.id) - relationBetween(world, quest.issuerFactionId, b.id) || a.id.localeCompare(b.id))[0];
  if (birthrightFaction) {
    return birthrightFaction;
  }
  const hostile = hostileFactionCandidates(world, quest.issuerFactionId)[0];
  if (hostile) {
    return hostile;
  }
  if (artifact.corruption >= 42 || artifact.tags.some((tag) => tag === "cursed" || tag === "hungry" || tag === "claimant-bait")) {
    return Object.values(world.factions)
      .filter((faction) => faction.id !== quest.issuerFactionId)
      .sort((a, b) => b.magic + b.military - (a.magic + a.military) || a.id.localeCompare(b.id))[0];
  }
  return undefined;
}

function artifactCounterKind(world: World, artifact: StoryArtifact, quest: Quest, counterFaction: Faction): QuestNeedKind {
  const titleText = `${quest.title} ${quest.summary}`.toLowerCase();
  if (artifact.corruption >= 55 || artifact.tags.some((tag) => tag === "cursed" || tag === "hungry")) {
    return "destroy-artifact";
  }
  if (artifact.tags.some((tag) => tag === "royal" || tag === "claimant-bait") || artifact.fame >= 36) {
    return "expose-artifact-claim";
  }
  if (textHasAny(titleText, artifactClaimTerms) && world.settlements[artifact.locationId]?.factionId === counterFaction.id) {
    return "guard-artifact";
  }
  if (relationBetween(world, quest.issuerFactionId, counterFaction.id) <= -55) {
    return "intercept-artifact";
  }
  return stableTextCode(`${artifact.id}:${quest.id}:${counterFaction.id}`) % 2 === 0 ? "guard-artifact" : "intercept-artifact";
}

export function counterquestNeedsForQuest(world: World, quest: Quest): QuestNeed[] {
  if (!liveQuest(quest) || quest.storyKind !== "artifact" || !quest.storyId || quest.summary.toLowerCase().includes("counterquest")) {
    return [];
  }
  const artifact = world.story.artifacts[quest.storyId];
  if (!artifact || artifact.status === "claimed") {
    return [];
  }
  const counterFaction = artifactCounterFaction(world, artifact, quest);
  if (!counterFaction) {
    return [];
  }
  const kind = artifactCounterKind(world, artifact, quest, counterFaction);
  const relation = relationBetween(world, quest.issuerFactionId, counterFaction.id);
  const pressure = clamp(Math.round(30 + artifact.power * 4.2 + artifact.fame * 0.3 + artifact.corruption * 0.24 + Math.max(0, -relation) * 0.16), 0, 100);
  if (pressure < 46) {
    return [];
  }
  return [
    {
      id: needId(kind, quest.id, quest.locationId, artifact.name),
      kind,
      sourceKind: "quest",
      sourceId: quest.id,
      sourceName: quest.title,
      locationId: quest.locationId,
      issuerFactionId: counterFaction.id,
      targetFactionId: quest.issuerFactionId,
      subject: artifact.name,
      pressure,
      danger: clamp(Math.round(quest.danger + artifact.power * 2 + Math.max(0, -relation) * 0.1), 18, 98),
      tags: ["counterquest", "artifact", "relic", kind.replace("-artifact", ""), ...artifact.tags],
      counterToQuestId: quest.id
    }
  ];
}

export function collectCounterquestNeeds(world: World): QuestNeed[] {
  return sortedByNeedPriority(Object.values(world.quests).flatMap((quest) => counterquestNeedsForQuest(world, quest)));
}

export function collectQuestNeeds(world: World, options: QuestNeedLaneOptions = {}): QuestNeed[] {
  const needs: QuestNeed[] = [];
  if (options.includeAssetNeeds ?? true) {
    needs.push(...collectAssetNeeds(world));
  }
  if (options.includeGroupNeeds ?? true) {
    needs.push(...collectGroupNeeds(world));
  }
  if (options.includeCounterquests ?? true) {
    needs.push(...collectCounterquestNeeds(world));
  }
  return sortedByNeedPriority(needs).slice(0, options.maxProposals ?? defaultMaxProposals);
}

function uniqueProposals(proposals: QuestNeedProposal[]): QuestNeedProposal[] {
  const seen = new Set<string>();
  const unique: QuestNeedProposal[] = [];
  for (const proposal of sortedByProposalPriority(proposals)) {
    if (seen.has(proposal.signature)) {
      continue;
    }
    seen.add(proposal.signature);
    unique.push(proposal);
  }
  return unique;
}

export function proposeQuestNeeds(world: World, options: QuestNeedLaneOptions = {}): QuestNeedProposal[] {
  const proposals = collectQuestNeeds(world, options)
    .map((need) => proposalFromNeed(world, need))
    .filter((proposal): proposal is QuestNeedProposal => Boolean(proposal));
  return uniqueProposals(proposals);
}

function existingEquivalentQuest(world: World, proposal: QuestNeedProposal): boolean {
  const normalizedTitle = proposal.title.toLowerCase();
  return Object.values(world.quests).some((quest) => {
    if (!liveQuest(quest)) {
      return false;
    }
    return (
      quest.locationId === proposal.locationId &&
      quest.kind === proposal.kind &&
      quest.issuerFactionId === proposal.issuerFactionId &&
      (quest.targetFactionId ?? "") === (proposal.targetFactionId ?? "") &&
      quest.title.toLowerCase() === normalizedTitle
    );
  });
}

function openQuestCount(world: World): number {
  return Object.values(world.quests).filter(liveQuest).length;
}

function openQuestCountAtLocation(world: World, locationId: Id): number {
  return Object.values(world.quests).filter((quest) => liveQuest(quest) && quest.locationId === locationId).length;
}

function uniqueQuestId(world: World, proposal: QuestNeedProposal): Id {
  const base = `quest-${stableTextCode(`${proposal.signature}:${world.tick}:${Object.keys(world.quests).length}`).toString(36)}`;
  if (!world.quests[base]) {
    return base;
  }
  let index = 1;
  let id = `${base}-${index}`;
  while (world.quests[id]) {
    index += 1;
    id = `${base}-${index}`;
  }
  return id;
}

export function materializeQuestProposal(world: World, proposal: QuestNeedProposal): Quest {
  return {
    id: uniqueQuestId(world, proposal),
    title: proposal.title,
    kind: proposal.kind,
    issuerFactionId: proposal.issuerFactionId,
    locationId: proposal.locationId,
    targetFactionId: proposal.targetFactionId,
    danger: proposal.danger,
    rewardGold: proposal.rewardGold,
    rewardRenown: proposal.rewardRenown,
    urgency: proposal.urgency,
    progress: 0,
    status: "open",
    summary: proposal.summary
  };
}

export function addQuestNeedProposals(world: World, proposals: readonly QuestNeedProposal[], options: QuestNeedLaneOptions = {}): Quest[] {
  const created: Quest[] = [];
  const maxCreated = options.maxCreated ?? defaultMaxCreated;
  const maxOpenQuests = options.maxOpenQuests ?? defaultMaxOpenQuests;
  const maxOpenPerLocation = options.maxOpenPerLocation ?? defaultMaxOpenPerLocation;
  for (const proposal of sortedByProposalPriority([...proposals])) {
    if (created.length >= maxCreated || openQuestCount(world) >= maxOpenQuests) {
      break;
    }
    if (openQuestCountAtLocation(world, proposal.locationId) >= maxOpenPerLocation || existingEquivalentQuest(world, proposal)) {
      continue;
    }
    const quest = materializeQuestProposal(world, proposal);
    world.quests[quest.id] = quest;
    created.push(quest);
  }
  if (options.emitEvents && created.length > 0) {
    const first = created[0];
    const severity = created.some((quest) => quest.danger >= 72 || quest.urgency >= 92) ? "high" : "medium";
    const factionIds = uniqueFactionIds(created.flatMap((quest) => [quest.issuerFactionId, quest.targetFactionId]));
    event(
      world,
      "quest",
      severity,
      created.length === 1 ? `A concrete need becomes a contract: ${first.title}.` : `Concrete needs become ${created.length} contracts; first heard is ${first.title}.`,
      [],
      factionIds,
      first.locationId
    );
  }
  return created;
}

export function updateQuestNeedLane(world: World, options: QuestNeedLaneOptions = {}): Quest[] {
  if (options.intervalTicks && options.intervalTicks > 0 && world.tick % options.intervalTicks !== 0) {
    return [];
  }
  return addQuestNeedProposals(world, proposeQuestNeeds(world, options), options);
}

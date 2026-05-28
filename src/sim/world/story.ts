import { event } from "../chronicle/events";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import { familyNames } from "../data/content";
import { autoEquip, ensureItem, rememberItem } from "../economy/items";
import { makeItemProvenance } from "../economy/recipes";
import { biomeAtSettlement } from "../environment/planet";
import { TICKS_PER_DAY } from "./calendar";
import type {
  Band,
  CrisisKind,
  AncestryKey,
  Id,
  Item,
  ItemDesire,
  LegendHook,
  LegendHookKind,
  LegendMutation,
  LegendOutcome,
  LegendTone,
  Person,
  Quest,
  QuestKind,
  StoryArtifact,
  StoryBoss,
  StoryCrisis,
  StoryKind,
  StoryState,
  World
} from "../types";

const artifactNames = [
  "Bell of Second Dawn",
  "Crown Shard of Alder",
  "Sleepless Idol",
  "Verdant Nail",
  "Mirror Tooth",
  "Saint-Road Astrolabe",
  "Ashen Treaty Blade"
];

const bossTitles = [
  "the Roadless Saint",
  "the Mire-Crowned General",
  "the Glass Matriarch",
  "the Thorn Regent",
  "the Toll-King Below",
  "the Lantern-Eater"
];

const crisisTemplates: { kind: CrisisKind; name: string; tags: string[] }[] = [
  { kind: "invasion", name: "Border Host", tags: ["war", "defense"] },
  { kind: "plague", name: "Grey Fever", tags: ["medicine", "mercy"] },
  { kind: "famine", name: "Empty Granary Season", tags: ["stores", "escort"] },
  { kind: "curse", name: "Night Bell Curse", tags: ["magic", "delve"] },
  { kind: "succession", name: "Broken Oath Claim", tags: ["politics", "law"] },
  { kind: "uprising", name: "Red Market Revolt", tags: ["unrest", "politics"] }
];

const birthrightAncestries: AncestryKey[] = ["human", "elder", "deepborn", "skyborn", "ashkin"];
const maxLegendHooks = 4;
const hookQuestPressure = 72;
const hookEventPressure = 54;
const hookMaxAgeTicks = 144;
const hookKinds: LegendHookKind[] = ["claimant", "grudge", "cult", "revenge", "pilgrimage", "scandal", "succession", "cure"];
const hookQuestKinds: QuestKind[] = ["defense", "delve", "hunt", "escort", "politics"];

export function emptyStoryState(): StoryState {
  return {
    artifacts: {},
    bosses: {},
    crises: {}
  };
}

type HandlingKind = "success" | "setback" | "expired";

interface LegendHandlingContext {
  kind: HandlingKind;
  band?: Band;
  leader?: Person;
  receiver?: Person;
  casualties: number;
  averageFatigue: number;
  averageHealth: number;
  reason?: string;
}

interface LegendDecision {
  outcome: LegendOutcome;
  tone: LegendTone;
  text: string;
  greed: number;
  mercy: number;
  wrath: number;
  sacrifice: number;
  corruption: number;
  order: number;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function branch(value: number, threshold: number): boolean {
  return value >= threshold;
}

function storyActorName(person: Person | undefined): string {
  return person ? `${person.name} ${person.familyName}` : "unknown hands";
}

function handlingContext(world: World, kind: HandlingKind, band: Band | undefined, receiver: Person | undefined, reason?: string): LegendHandlingContext {
  const members = band?.memberIds.map((id) => world.persons[id]).filter((person): person is Person => Boolean(person)) ?? [];
  const living = members.filter((person) => person.alive);
  return {
    kind,
    band,
    leader: band ? world.persons[band.leaderId] : receiver,
    receiver,
    casualties: Math.max(0, members.length - living.length),
    averageFatigue: average(living.map((person) => person.fatigue)),
    averageHealth: average(living.map((person) => person.hp / person.maxHp)),
    reason
  };
}

function decideLegendMutation(context: LegendHandlingContext, basePower: number, danger = 50): LegendDecision {
  const actor = context.leader ?? context.receiver;
  const identity = actor?.identity;
  const traits = actor?.traits;
  const greed = (traits?.greed ?? 50) * 0.7 + (traits?.ambition ?? 50) * 0.45 + Math.max(0, -(identity?.corruptPure ?? 0)) * 0.28;
  const mercy = (traits?.mercy ?? 50) * 0.72 + (traits?.loyalty ?? 50) * 0.28 + Math.max(0, identity?.evilGood ?? 0) * 0.35;
  const wrath = (traits?.wrath ?? 50) * 0.65 + (traits?.bravery ?? 50) * 0.32 + Math.max(0, -(identity?.warlikePeaceful ?? 0)) * 0.3;
  const sacrifice = context.casualties * 24 + context.averageFatigue * 0.34 + (1 - context.averageHealth) * 55 + basePower * 0.25;
  const corruption = Math.max(0, -(identity?.corruptPure ?? 0)) * 0.55 + Math.max(0, -(identity?.evilGood ?? 0)) * 0.25 + basePower * 0.18;
  const order = Math.max(0, -(identity?.authoritarianEgalitarian ?? 0)) * 0.45 + Math.max(0, -(identity?.warlikePeaceful ?? 0)) * 0.18;

  if (context.kind === "expired") {
    return { outcome: "ignored", tone: "neglected", text: "neglect turns the story sharper than fact", greed, mercy, wrath, sacrifice, corruption, order };
  }
  if (context.kind === "setback") {
    const tone: LegendTone = branch(wrath + danger * 0.25, 78) ? "dread" : branch(corruption, 58) ? "corrupt" : "contested";
    return { outcome: "failed", tone, text: `${context.reason ?? "failure"} becomes part of the telling`, greed, mercy, wrath, sacrifice, corruption, order };
  }
  if (branch(sacrifice, 72)) {
    return { outcome: "bloodbound", tone: "sacrificial", text: "the price paid becomes inseparable from the victory", greed, mercy, wrath, sacrifice, corruption, order };
  }
  if (branch(greed + corruption, 98)) {
    return { outcome: "claimed", tone: "corrupt", text: "ambition takes custody of the legend", greed, mercy, wrath, sacrifice, corruption, order };
  }
  if (branch(mercy, 82)) {
    return { outcome: "redeemed", tone: "merciful", text: "mercy changes what witnesses believe the legend can mean", greed, mercy, wrath, sacrifice, corruption, order };
  }
  if (branch(wrath + order, 96)) {
    return { outcome: "suppressed", tone: "suppressed", text: "order is restored by fear and force", greed, mercy, wrath, sacrifice, corruption, order };
  }
  return { outcome: "claimed", tone: "glorious", text: "the deed enters clean public fame", greed, mercy, wrath, sacrifice, corruption, order };
}

function pushLegendHistory(
  world: World,
  history: LegendMutation[],
  decision: LegendDecision,
  context: LegendHandlingContext,
  text: string
): void {
  history.unshift({
    id: makeId("legend", world.tick * 100 + history.length + text.length),
    tick: world.tick,
    day: world.day,
    outcome: decision.outcome,
    tone: decision.tone,
    actorBandId: context.band?.id,
    actorPersonId: (context.receiver ?? context.leader)?.id,
    text
  });
  if (history.length > 8) {
    history.length = 8;
  }
}

function stableTextCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 31 + value.charCodeAt(index)) % 100000;
  }
  return code;
}

function repairLegendHooks(hooks: LegendHook[] | undefined, fallbackLocationId: Id): LegendHook[] {
  const repaired = (hooks ?? [])
    .filter((hook) => hook.id && hook.text)
    .map((hook) => {
      const pressure = Number.isFinite(hook.pressure) ? hook.pressure : 0;
      const createdTick = Number.isFinite(hook.createdTick) ? hook.createdTick : 0;
      return {
        id: hook.id,
        kind: hookKinds.includes(hook.kind) ? hook.kind : "grudge",
        pressure: clamp(Math.round(pressure), 0, 100),
        text: hook.text,
        questKind: hookQuestKinds.includes(hook.questKind) ? hook.questKind : "politics",
        locationId: hook.locationId || fallbackLocationId,
        createdTick: Math.max(0, Math.floor(createdTick))
      };
    });
  repaired.sort((a, b) => b.pressure - a.pressure || b.createdTick - a.createdTick);
  return repaired.slice(0, maxLegendHooks);
}

function legendHookQuestKind(kind: LegendHookKind, storyKind: StoryKind): QuestKind {
  if (kind === "claimant" || kind === "scandal" || kind === "succession") return "politics";
  if (kind === "cult") return "delve";
  if (kind === "pilgrimage" || kind === "cure") return "escort";
  if (kind === "revenge") return storyKind === "boss" ? "hunt" : "defense";
  return "defense";
}

function legendHookKind(storyKind: StoryKind, decision: LegendDecision, context: LegendHandlingContext, crisisKind?: CrisisKind): LegendHookKind {
  if (context.kind === "expired") {
    if (storyKind === "artifact") return "claimant";
    if (storyKind === "boss") return "cult";
    return crisisKind === "plague" || crisisKind === "famine" ? "scandal" : "grudge";
  }
  if (context.kind === "setback") {
    if (storyKind === "artifact") return decision.tone === "corrupt" ? "claimant" : "grudge";
    if (storyKind === "boss") return decision.tone === "corrupt" ? "cult" : "revenge";
    if (crisisKind === "plague" || crisisKind === "famine") return "cure";
    if (crisisKind === "succession") return "succession";
    return decision.tone === "suppressed" || decision.tone === "corrupt" ? "scandal" : "grudge";
  }
  if (storyKind === "artifact") {
    if (decision.outcome === "bloodbound") return "cult";
    if (decision.tone === "merciful") return "pilgrimage";
    if (decision.tone === "corrupt") return "claimant";
    if (decision.tone === "suppressed") return "scandal";
    return "claimant";
  }
  if (storyKind === "boss") {
    if (decision.tone === "merciful") return "pilgrimage";
    if (decision.tone === "corrupt" || decision.tone === "sacrificial") return "cult";
    if (decision.tone === "suppressed") return "grudge";
    return "revenge";
  }
  if (crisisKind === "plague" || crisisKind === "famine") return "cure";
  if (crisisKind === "succession") return "succession";
  if (decision.tone === "merciful" || decision.outcome === "contained") return "pilgrimage";
  if (decision.tone === "suppressed" || decision.tone === "corrupt") return "scandal";
  return "grudge";
}

function legendHookPressure(decision: LegendDecision, context: LegendHandlingContext): number {
  const motive = Math.max(decision.greed, decision.mercy * 0.8, decision.wrath, decision.sacrifice, decision.corruption, decision.order);
  const contextBoost = context.kind === "expired" ? 34 : context.kind === "setback" ? 30 : 22;
  const toneBoost = decision.tone === "dread" || decision.tone === "corrupt" || decision.tone === "suppressed" ? 16 : decision.tone === "sacrificial" ? 12 : 6;
  return clamp(Math.round(contextBoost + motive * 0.42 + toneBoost), 24, 96);
}

function legendHookText(storyName: string, kind: LegendHookKind, context: LegendHandlingContext): string {
  const actor = context.band?.name ?? storyActorName(context.leader ?? context.receiver);
  const suffix = actor === "unknown hands" ? "after the tale goes unanswered" : `after ${actor} touches the tale`;
  if (kind === "claimant") return `A claimant begins using ${storyName} as proof of a right ${suffix}`;
  if (kind === "grudge") return `A grudge keeps witnesses arguing over ${storyName} ${suffix}`;
  if (kind === "cult") return `A hidden cult starts preaching the lesson of ${storyName} ${suffix}`;
  if (kind === "revenge") return `Followers swear revenge in the shadow of ${storyName} ${suffix}`;
  if (kind === "pilgrimage") return `Pilgrims start planning roads toward ${storyName} ${suffix}`;
  if (kind === "scandal") return `A scandal forms around who profited from ${storyName} ${suffix}`;
  if (kind === "succession") return `Rival heirs cite ${storyName} in their succession claims ${suffix}`;
  return `Healers chase a cure promised by ${storyName} ${suffix}`;
}

function pushLegendHook(
  world: World,
  storyId: Id,
  hooks: LegendHook[],
  kind: LegendHookKind,
  pressure: number,
  text: string,
  questKind: QuestKind,
  locationId: Id
): void {
  hooks.unshift({
    id: makeId("hook", world.tick * 100000 + stableTextCode(`${storyId}:${kind}:${text}:${hooks.length}`)),
    kind,
    pressure,
    text,
    questKind,
    locationId,
    createdTick: world.tick
  });
  hooks.sort((a, b) => b.pressure - a.pressure || b.createdTick - a.createdTick);
  if (hooks.length > maxLegendHooks) {
    hooks.length = maxLegendHooks;
  }
}

function addOutcomeHook(
  world: World,
  storyKind: StoryKind,
  storyId: Id,
  storyName: string,
  locationId: Id,
  hooks: LegendHook[],
  decision: LegendDecision,
  context: LegendHandlingContext,
  crisisKind?: CrisisKind
): void {
  const kind = legendHookKind(storyKind, decision, context, crisisKind);
  pushLegendHook(
    world,
    storyId,
    hooks,
    kind,
    legendHookPressure(decision, context),
    legendHookText(storyName, kind, context),
    legendHookQuestKind(kind, storyKind),
    locationId
  );
}

function seedStartingHook(
  world: World,
  rng: Rng,
  storyKind: StoryKind,
  storyId: Id,
  storyName: string,
  locationId: Id,
  hooks: LegendHook[],
  preferredKind: LegendHookKind
): void {
  pushLegendHook(
    world,
    storyId,
    hooks,
    preferredKind,
    rng.int(42, 66),
    legendHookText(storyName, preferredKind, handlingContext(world, "expired", undefined, undefined)),
    legendHookQuestKind(preferredKind, storyKind),
    locationId
  );
}

function activeStoryQuest(world: World, storyId: Id): Quest | undefined {
  return Object.values(world.quests).find((quest) => quest.storyId === storyId && (quest.status === "open" || quest.status === "active"));
}

function storyQuestCount(world: World): number {
  return Object.values(world.quests).filter((quest) => quest.storyId && (quest.status === "open" || quest.status === "active")).length;
}

function nextQuestId(world: World, rng: Rng): Id {
  let id = "";
  do {
    id = makeId("quest", world.tick * 100 + rng.int(100, 9999) + Object.keys(world.quests).length);
  } while (world.quests[id]);
  return id;
}

function createStoryQuest(
  world: World,
  rng: Rng,
  storyKind: StoryKind,
  storyId: Id,
  kind: QuestKind,
  title: string,
  locationId: Id,
  danger: number,
  summary: string
): Quest | undefined {
  if (storyQuestCount(world) >= 9 || activeStoryQuest(world, storyId)) {
    return undefined;
  }

  const settlement = world.settlements[locationId];
  if (!settlement) {
    return undefined;
  }

  const quest: Quest = {
    id: nextQuestId(world, rng),
    title,
    kind,
    issuerFactionId: settlement.factionId,
    locationId,
    danger: clamp(Math.round(danger), 18, 98),
    rewardGold: Math.ceil(danger * rng.int(5, 9) * 0.4),
    rewardRenown: Math.ceil(danger / 5) + rng.int(2, 8),
    urgency: rng.int(40, 120),
    progress: 0,
    status: "open",
    storyKind,
    storyId,
    summary
  };
  world.quests[quest.id] = quest;
  event(world, "quest", "high", `A legend becomes actionable: ${quest.title}.`, [], [quest.issuerFactionId], quest.locationId);
  return quest;
}

function seedArtifacts(world: World, rng: Rng): void {
  const settlements = Object.values(world.settlements);
  for (let index = 0; index < Math.min(5, settlements.length); index += 1) {
    const settlement = settlements[(index * 2 + rng.int(0, settlements.length - 1)) % settlements.length];
    const biome = biomeAtSettlement(world, settlement.id);
    const cultureId = world.factions[settlement.factionId]?.cultureId;
    const id = makeId("artifact", index);
    const artifact: StoryArtifact = {
      id,
      name: rng.pick(artifactNames.filter((name) => !Object.values(world.story.artifacts).some((artifact) => artifact.name === name))),
      locationId: settlement.id,
      status: rng.chance(0.5) ? "rumored" : "hidden",
      power: rng.int(5, 12),
      fame: rng.int(8, 28),
      attunement: rng.int(0, 20),
      corruption: rng.chance(0.3) ? rng.int(12, 34) : rng.int(0, 12),
      tone: "dormant",
      legend: `Said to answer ${rng.pick(biome.questHooks)} and the old hunger of ${biome.name}.`,
      tags: ["artifact", biome.id, rng.pick(["holy", "cursed", "royal", "ancient", "warded", "hungry"])],
      history: [],
      hooks: [],
      birthrightCultureIds: cultureId ? [cultureId] : [],
      birthrightFamilyName: rng.chance(0.42) ? rng.pick(familyNames) : undefined,
      birthrightAncestry: rng.chance(0.36) ? rng.pick(birthrightAncestries) : undefined
    };
    world.story.artifacts[id] = artifact;
    seedStartingHook(world, rng, "artifact", artifact.id, artifact.name, artifact.locationId, artifact.hooks, rng.chance(0.55) ? "claimant" : "pilgrimage");
  }
}

function seedBosses(world: World, rng: Rng): void {
  const settlements = Object.values(world.settlements);
  const artifacts = Object.values(world.story.artifacts);
  for (let index = 0; index < Math.min(4, settlements.length); index += 1) {
    const settlement = settlements[(index * 3 + rng.int(0, settlements.length - 1)) % settlements.length];
    const biome = biomeAtSettlement(world, settlement.id);
    const artifact = artifacts.find((candidate) => !candidate.guardedByBossId && candidate.locationId === settlement.id) ?? rng.pick(artifacts);
    const id = makeId("boss", index);
    const guardsArtifact = artifact && rng.chance(0.65);
    const boss: StoryBoss = {
      id,
      name: `${rng.pick(biome.threats)} called ${rng.pick(bossTitles)}`,
      locationId: settlement.id,
      status: "active",
      power: rng.int(52, 94),
      threat: rng.int(36, 82),
      dread: rng.int(24, 70),
      following: rng.int(0, 38),
      legacy: "dread",
      desire: rng.pick(["hoard relics", "break roads", "force tribute", "raise a cult", "take a crown", "guard an old wound"]),
      tags: ["boss", biome.id, rng.pick(["raider", "undead", "sorcerous", "beast", "warlord"])],
      history: [],
      hooks: [],
      guardingArtifactId: guardsArtifact ? artifact.id : undefined,
      lastSpawnTick: 0
    };
    world.story.bosses[id] = boss;
    seedStartingHook(world, rng, "boss", boss.id, boss.name, boss.locationId, boss.hooks, rng.chance(0.55) ? "revenge" : "cult");
    if (guardsArtifact) {
      artifact.guardedByBossId = id;
      artifact.status = "rumored";
    }
    settlement.threat = clamp(settlement.threat + rng.int(8, 18), 0, 100);
  }
}

function seedCrises(world: World, rng: Rng): void {
  const settlements = Object.values(world.settlements);
  for (let index = 0; index < Math.min(3, settlements.length); index += 1) {
    const settlement = settlements[(index * 2 + 1 + rng.int(0, settlements.length - 1)) % settlements.length];
    const template = rng.pick(crisisTemplates);
    const id = makeId("crisis", index);
    const crisis: StoryCrisis = {
      id,
      name: `${template.name} at ${settlement.name}`,
      kind: template.kind,
      locationId: settlement.id,
      factionId: settlement.factionId,
      status: "active",
      severity: rng.int(34, 78),
      progress: rng.int(10, 48),
      publicTrust: rng.int(16, 54),
      radicalization: rng.int(10, 46),
      myth: "contested",
      tags: template.tags,
      history: [],
      hooks: [],
      lastPulseTick: 0
    };
    world.story.crises[id] = crisis;
    seedStartingHook(
      world,
      rng,
      "crisis",
      crisis.id,
      crisis.name,
      crisis.locationId,
      crisis.hooks,
      template.kind === "plague" || template.kind === "famine" ? "cure" : template.kind === "succession" ? "succession" : "grudge"
    );
    settlement.unrest = clamp(settlement.unrest + rng.int(4, 12), 0, 100);
  }
}

export function ensureStoryState(world: World, rng: Rng): StoryState {
  world.story ??= emptyStoryState();
  world.story.artifacts ??= {};
  world.story.bosses ??= {};
  world.story.crises ??= {};
  if (Object.keys(world.story.artifacts).length === 0) {
    seedArtifacts(world, rng);
  }
  if (Object.keys(world.story.bosses).length === 0) {
    seedBosses(world, rng);
  }
  if (Object.keys(world.story.crises).length === 0) {
    seedCrises(world, rng);
  }
  for (const artifact of Object.values(world.story.artifacts)) {
    artifact.fame ??= artifact.status === "claimed" ? artifact.power * 4 : rng.int(6, 18);
    artifact.attunement ??= artifact.holderPersonId ? rng.int(16, 42) : 0;
    artifact.corruption ??= artifact.tags.includes("cursed") || artifact.tags.includes("hungry") ? rng.int(18, 36) : rng.int(0, 12);
    artifact.tone ??= "dormant";
    artifact.history ??= [];
    const settlement = world.settlements[artifact.locationId];
    const cultureId = settlement ? world.factions[settlement.factionId]?.cultureId : undefined;
    artifact.birthrightCultureIds ??= cultureId ? [cultureId] : [];
    artifact.hooks = repairLegendHooks(artifact.hooks, artifact.locationId);
  }
  for (const boss of Object.values(world.story.bosses)) {
    boss.dread ??= boss.status === "active" ? clamp(boss.threat + rng.int(-8, 12), 0, 100) : rng.int(8, 30);
    boss.following ??= boss.tags.includes("warlord") || boss.tags.includes("sorcerous") ? rng.int(12, 42) : rng.int(0, 20);
    boss.legacy ??= boss.status === "defeated" ? "contested" : "dread";
    boss.history ??= [];
    boss.hooks = repairLegendHooks(boss.hooks, boss.locationId);
  }
  for (const crisis of Object.values(world.story.crises)) {
    crisis.publicTrust ??= crisis.status === "resolved" ? rng.int(44, 72) : rng.int(18, 52);
    crisis.radicalization ??= crisis.status === "active" ? rng.int(12, 48) : rng.int(0, 28);
    crisis.myth ??= crisis.status === "resolved" ? "glorious" : "contested";
    crisis.history ??= [];
    crisis.hooks = repairLegendHooks(crisis.hooks, crisis.locationId);
  }
  return world.story;
}

function spawnArtifactQuest(world: World, rng: Rng, artifact: StoryArtifact): void {
  if (artifact.status === "claimed" || artifact.holderPersonId) {
    return;
  }
  const boss = artifact.guardedByBossId ? world.story.bosses[artifact.guardedByBossId] : undefined;
  if (boss?.status === "active") {
    spawnBossQuest(world, rng, boss);
    return;
  }
  const settlement = world.settlements[artifact.locationId];
  const biome = biomeAtSettlement(world, artifact.locationId);
  createStoryQuest(
    world,
    rng,
    "artifact",
    artifact.id,
    rng.chance(0.7) ? "delve" : "escort",
    `Recover ${artifact.name} from ${settlement.name}`,
    artifact.locationId,
    42 + artifact.power * 4 + settlement.threat * 0.25,
    `${artifact.legend} Whoever claims it may become important enough for history to notice.`
  );
  artifact.status = "rumored";
  event(world, "world", "medium", `Rumor fixes ${artifact.name} near ${biome.name}.`, [], [settlement.factionId], settlement.id);
}

function spawnBossQuest(world: World, rng: Rng, boss: StoryBoss): void {
  if (boss.status !== "active") {
    return;
  }
  const settlement = world.settlements[boss.locationId];
  createStoryQuest(
    world,
    rng,
    "boss",
    boss.id,
    rng.chance(0.55) ? "hunt" : "defense",
    `Break ${boss.name} near ${settlement.name}`,
    boss.locationId,
    boss.power + boss.threat * 0.16,
    `${boss.name} wants to ${boss.desire}; local roads and oaths bend around that fact.`
  );
  boss.lastSpawnTick = world.tick;
}

function crisisQuestKind(kind: CrisisKind): QuestKind {
  if (kind === "invasion") return "defense";
  if (kind === "plague" || kind === "famine") return "escort";
  if (kind === "curse") return "delve";
  return "politics";
}

function spawnCrisisQuest(world: World, rng: Rng, crisis: StoryCrisis): void {
  if (crisis.status !== "active") {
    return;
  }
  createStoryQuest(
    world,
    rng,
    "crisis",
    crisis.id,
    crisisQuestKind(crisis.kind),
    `Contain ${crisis.name}`,
    crisis.locationId,
    34 + crisis.severity * 0.55 + crisis.progress * 0.18,
    `${crisis.name} is no longer background pressure; it is becoming a public demand.`
  );
}

function updateBosses(world: World, rng: Rng): void {
  for (const boss of Object.values(world.story.bosses)) {
    if (boss.status !== "active") continue;
    const settlement = world.settlements[boss.locationId];
    settlement.threat = clamp(settlement.threat + Math.floor(boss.threat / 28) + rng.int(-1, 2), 0, 100);
    boss.dread = clamp(boss.dread + Math.floor(boss.threat / 45) + rng.int(-1, 1), 0, 100);
    if (boss.dread > 70 && rng.chance(0.22)) {
      boss.following = clamp(boss.following + rng.int(1, 4), 0, 100);
    }
    if (world.tick - boss.lastSpawnTick > 18 && (settlement.threat > 62 || rng.chance(0.24))) {
      spawnBossQuest(world, rng, boss);
    }
  }
}

function updateArtifacts(world: World, rng: Rng): void {
  for (const artifact of Object.values(world.story.artifacts)) {
    if (artifact.status === "hidden" && rng.chance(0.14)) {
      artifact.status = "rumored";
      artifact.fame = clamp(artifact.fame + rng.int(2, 8), 0, 100);
      const settlement = world.settlements[artifact.locationId];
      event(world, "world", "medium", `A trader repeats the old name ${artifact.name}; seekers begin comparing maps.`, [], [settlement.factionId], settlement.id);
    }
    if (artifact.status === "rumored" && rng.chance(0.22)) {
      spawnArtifactQuest(world, rng, artifact);
    }
  }
}

function updateCrises(world: World, rng: Rng): void {
  for (const crisis of Object.values(world.story.crises)) {
    if (crisis.status !== "active") continue;
    const settlement = world.settlements[crisis.locationId];
    const society = world.factions[crisis.factionId];
    crisis.progress = clamp(crisis.progress + crisis.severity * 0.06 + rng.int(0, 4), 0, 120);
    crisis.lastPulseTick = world.tick;
    settlement.unrest = clamp(settlement.unrest + Math.floor(crisis.severity / 38), 0, 100);
    crisis.radicalization = clamp(crisis.radicalization + Math.floor(crisis.severity / 55) + rng.int(0, 1), 0, 100);
    crisis.publicTrust = clamp(crisis.publicTrust - Math.floor(crisis.severity / 70), 0, 100);
    if (crisis.kind === "invasion" || crisis.kind === "uprising" || crisis.kind === "curse") {
      settlement.threat = clamp(settlement.threat + Math.floor(crisis.severity / 42), 0, 100);
    }
    if (crisis.progress >= 100) {
      crisis.progress = rng.int(28, 54);
      crisis.severity = clamp(crisis.severity + rng.int(4, 12), 0, 100);
      society.stability = clamp(society.stability - rng.int(2, 7), 0, 100);
      event(world, "world", "high", `${crisis.name} worsens; ${settlement.name} loses patience with distant promises.`, [], [society.id], settlement.id);
    }
    if (!activeStoryQuest(world, crisis.id) && rng.chance(0.3 + crisis.severity / 240)) {
      spawnCrisisQuest(world, rng, crisis);
    }
  }
}

function decayLegendHooks(hooks: LegendHook[], tick: number, baseDecay: number): void {
  for (let index = hooks.length - 1; index >= 0; index -= 1) {
    const hook = hooks[index];
    const age = tick - hook.createdTick;
    const ageDecay = age > 72 ? 3 : 0;
    hook.pressure = clamp(hook.pressure - baseDecay - ageDecay, 0, 100);
    if (hook.pressure <= 0 || age > hookMaxAgeTicks) {
      hooks.splice(index, 1);
    }
  }
  hooks.sort((a, b) => b.pressure - a.pressure || b.createdTick - a.createdTick);
  if (hooks.length > maxLegendHooks) {
    hooks.length = maxLegendHooks;
  }
}

function storyCanSpawnHookQuest(world: World, storyKind: StoryKind, storyId: Id): boolean {
  if (storyKind === "artifact") {
    const artifact = world.story.artifacts[storyId];
    return Boolean(artifact && artifact.status !== "claimed" && !artifact.holderPersonId);
  }
  if (storyKind === "boss") {
    return world.story.bosses[storyId]?.status === "active";
  }
  return world.story.crises[storyId]?.status === "active";
}

function hookQuestTitle(hook: LegendHook, storyName: string): string {
  if (hook.kind === "claimant") return `Face a claimant to ${storyName}`;
  if (hook.kind === "grudge") return `Settle the grudge around ${storyName}`;
  if (hook.kind === "cult") return `Break the cult of ${storyName}`;
  if (hook.kind === "revenge") return `Answer revenge sworn over ${storyName}`;
  if (hook.kind === "pilgrimage") return `Guide pilgrims toward ${storyName}`;
  if (hook.kind === "scandal") return `Expose the scandal of ${storyName}`;
  if (hook.kind === "succession") return `Arbitrate the claim of ${storyName}`;
  return `Find the cure promised by ${storyName}`;
}

function updateLegendHooks(
  world: World,
  rng: Rng,
  storyKind: StoryKind,
  storyId: Id,
  storyName: string,
  hooks: LegendHook[],
  dangerBias: number
): void {
  if (hooks.length === 0) {
    return;
  }
  hooks.sort((a, b) => b.pressure - a.pressure || b.createdTick - a.createdTick);
  const hook = hooks[0];
  if (hook.pressure >= hookQuestPressure && storyCanSpawnHookQuest(world, storyKind, storyId)) {
    const quest = createStoryQuest(
      world,
      rng,
      storyKind,
      storyId,
      hook.questKind,
      hookQuestTitle(hook, storyName),
      hook.locationId,
      24 + hook.pressure * 0.55 + dangerBias,
      `${hook.text}. The possibility is strong enough to demand action.`
    );
    if (quest) {
      hooks.shift();
      decayLegendHooks(hooks, world.tick, 3);
      return;
    }
  }
  if (hook.pressure >= hookEventPressure) {
    const settlement = world.settlements[hook.locationId];
    event(
      world,
      "world",
      hook.pressure >= hookQuestPressure ? "high" : "medium",
      `An emerging legend takes shape: ${hook.text}.`,
      [],
      settlement ? [settlement.factionId] : [],
      hook.locationId
    );
    hook.pressure = clamp(hook.pressure - 16, 0, 100);
  }
  decayLegendHooks(hooks, world.tick, 8);
}

function updateEmergingLegendHooks(world: World, rng: Rng): void {
  for (const artifact of Object.values(world.story.artifacts)) {
    updateLegendHooks(world, rng, "artifact", artifact.id, artifact.name, artifact.hooks, artifact.power * 2);
  }
  for (const boss of Object.values(world.story.bosses)) {
    updateLegendHooks(world, rng, "boss", boss.id, boss.name, boss.hooks, boss.power * 0.25 + boss.dread * 0.25);
  }
  for (const crisis of Object.values(world.story.crises)) {
    updateLegendHooks(world, rng, "crisis", crisis.id, crisis.name, crisis.hooks, crisis.severity * 0.35 + crisis.radicalization * 0.25);
  }
}

export function updateStoryEngine(world: World, rng: Rng): void {
  ensureStoryState(world, rng);
  if (world.tick % TICKS_PER_DAY !== 0) {
    return;
  }
  updateBosses(world, rng);
  updateArtifacts(world, rng);
  updateCrises(world, rng);
  updateEmergingLegendHooks(world, rng);
}

function artifactBirthrightScore(artifact: StoryArtifact, person: Person): number {
  const cultureIds = artifact.birthrightCultureIds ?? [];
  let score = 0;
  if (artifact.birthrightFamilyName && person.familyName === artifact.birthrightFamilyName) score += 34;
  if (artifact.birthrightAncestry && (person.ancestry === artifact.birthrightAncestry || (person.ancestryLineage ?? []).includes(artifact.birthrightAncestry))) score += 22;
  if (cultureIds.includes(person.birthCultureId)) score += 30;
  if ((person.heritageCultureIds ?? []).some((id) => cultureIds.includes(id))) score += 18;
  if (cultureIds.includes(person.cultureId)) score += 10;
  if (person.adoptionStatus === "ward" || person.adoptionStatus === "adopted") score += 6;
  return score;
}

function artifactBirthrightText(artifact: StoryArtifact, person: Person): string {
  const matches: string[] = [];
  if (artifact.birthrightFamilyName && person.familyName === artifact.birthrightFamilyName) matches.push(`${person.familyName} blood`);
  if (artifact.birthrightAncestry && (person.ancestry === artifact.birthrightAncestry || (person.ancestryLineage ?? []).includes(artifact.birthrightAncestry))) {
    matches.push(`${artifact.birthrightAncestry} ancestry`);
  }
  if ((artifact.birthrightCultureIds ?? []).includes(person.birthCultureId)) matches.push("birth culture");
  if ((person.heritageCultureIds ?? []).some((id) => (artifact.birthrightCultureIds ?? []).includes(id))) matches.push("buried heritage");
  return matches.length ? matches.slice(0, 2).join(" and ") : "old inheritance";
}

function artifactItem(artifact: StoryArtifact): Item {
  const desire: ItemDesire = artifact.tags.includes("hungry")
    ? "bloodshed"
    : artifact.tags.includes("royal")
      ? "dominion"
      : artifact.tags.includes("holy") || artifact.tags.includes("sanctified")
        ? "mercy"
        : artifact.tags.includes("warded")
          ? "protection"
          : "secrets";
  const sentience =
    artifact.power >= 7 || artifact.tags.includes("hungry") || artifact.tags.includes("cursed")
      ? {
          name: `${artifact.name} Will`,
          desire,
          willpower: 48 + artifact.power * 5,
          intelligence: 32 + artifact.power * 4,
          loyalty: artifact.tags.includes("sanctified") ? 16 : artifact.tags.includes("cursed") ? -14 : 0,
          hunger: artifact.tags.includes("hungry") ? 72 : artifact.corruption,
          mood: artifact.tone === "merciful" ? 12 : artifact.tone === "corrupt" ? -16 : 0,
          lastAppeasedTick: 0,
          memories: []
        }
      : undefined;
  return ensureItem({
    id: artifact.id,
    name: artifact.name,
    kind: "relic",
    quality: artifact.power >= 9 || artifact.fame >= 40 ? "legendary" : "enchanted",
    material: artifact.tags.includes("royal")
      ? "auramite"
      : artifact.tags.includes("hungry") || artifact.tags.includes("bloodbound")
        ? "living-iron"
        : artifact.tags.includes("holy") || artifact.tags.includes("sanctified")
          ? "saint-ash"
          : artifact.tags.includes("warded")
            ? "moon-iron"
            : "relic-glass",
    techLevel: "precursor",
    techVariant: artifact.tags.includes("bloodbound") ? "soulforged" : artifact.tags.includes("warded") ? "rune-bound" : "aether-woven",
    power: artifact.power,
    value: artifact.power * 24 + Math.round(artifact.fame),
    durability: 120 + artifact.power * 8,
    maxDurability: 120 + artifact.power * 8,
    tags: [...new Set(["artifact", "relic", ...artifact.tags])],
    effects: [],
    cursed: artifact.tags.includes("cursed") || artifact.tags.includes("hungry"),
    sentience
  });
}

function grantArtifact(artifact: StoryArtifact, receiver: Person, tick: number): string {
  artifact.status = "claimed";
  artifact.holderPersonId = receiver.id;
  const item = artifactItem(artifact);
  item.provenance = makeItemProvenance(item, {
    originKind: "relic",
    settlementId: artifact.locationId,
    createdTick: tick
  });
  if (!receiver.inventory.some((owned) => owned.id === item.id)) {
    receiver.inventory.push(item);
  }
  const equipped = autoEquip(receiver, item);
  rememberItem(item, tick, `${receiver.name} claimed the relic`, 8, ["claim", "artifact"]);
  const birthrightScore = artifactBirthrightScore(artifact, receiver);
  const resonance =
    birthrightScore >= 34
      ? ` ${artifact.name} answers ${artifactBirthrightText(artifact, receiver)}; a birthright stirs.`
      : receiver.adoptionStatus === "ward" || receiver.adoptionStatus === "adopted"
        ? ` ${artifact.name} remains quiet, but ${receiver.name}'s divided inheritance is now part of its story.`
        : "";
  if (birthrightScore >= 34) {
    artifact.resonantPersonId = receiver.id;
    artifact.attunement = clamp(artifact.attunement + Math.round(birthrightScore * 0.22), 0, 100);
    artifact.fame = clamp(artifact.fame + Math.round(birthrightScore * 0.12), 0, 100);
    receiver.status = [...new Set([...receiver.status, "birthright-stirred"])];
    receiver.renown += Math.ceil(birthrightScore / 24);
  }
  receiver.renown += artifact.power;
  return `${receiver.name} claims ${artifact.name}${equipped ? " and bears it openly" : ""}.${resonance}`;
}

function adjudicateArtifactSuccess(world: World, artifact: StoryArtifact, receiver: Person, context: LegendHandlingContext): string {
  const decision = decideLegendMutation(context, artifact.power);
  artifact.status = "claimed";
  artifact.holderPersonId = receiver.id;
  artifact.tone = decision.tone;
  artifact.fame = clamp(artifact.fame + 10 + decision.sacrifice * 0.08 + decision.mercy * 0.04, 0, 100);
  artifact.attunement = clamp(artifact.attunement + 8 + decision.mercy * 0.08 + decision.sacrifice * 0.06, 0, 100);
  artifact.corruption = clamp(
    artifact.corruption + (decision.tone === "corrupt" ? 14 : 0) - (decision.tone === "merciful" ? 10 : 0) + decision.corruption * 0.04,
    0,
    100
  );
  if (decision.tone === "sacrificial") artifact.tags = [...new Set([...artifact.tags, "bloodbound"])];
  if (decision.tone === "merciful") artifact.tags = [...new Set([...artifact.tags, "sanctified"])];
  if (decision.tone === "corrupt") artifact.tags = [...new Set([...artifact.tags, "claimant-bait"])];
  const line = `${storyActorName(receiver)} takes ${artifact.name}; ${decision.text}.`;
  pushLegendHistory(world, artifact.history, decision, context, line);
  addOutcomeHook(world, "artifact", artifact.id, artifact.name, artifact.locationId, artifact.hooks, decision, context);
  return `${grantArtifact(artifact, receiver, world.tick)} ${decision.text}.`;
}

function adjudicateBossSuccess(world: World, boss: StoryBoss, context: LegendHandlingContext): string {
  const settlement = world.settlements[boss.locationId];
  const decision = decideLegendMutation(context, boss.power, boss.threat);
  boss.status = "defeated";
  boss.legacy = decision.tone;
  boss.threat = 0;
  boss.dread = clamp(boss.dread - 18 + (decision.tone === "dread" || decision.tone === "suppressed" ? 12 : 0), 0, 100);
  boss.following = clamp(boss.following - 12 + (decision.tone === "sacrificial" || decision.tone === "dread" ? 10 : 0), 0, 100);
  if (decision.tone === "sacrificial") boss.tags = [...new Set([...boss.tags, "martyr-shadow"])];
  if (decision.tone === "merciful") boss.tags = [...new Set([...boss.tags, "bound"])];
  if (decision.tone === "suppressed") boss.tags = [...new Set([...boss.tags, "grudge"])];
  settlement.threat = clamp(settlement.threat - (decision.tone === "suppressed" ? 30 : 18), 0, 100);
  settlement.unrest = clamp(settlement.unrest + (decision.tone === "suppressed" ? 6 : -4), 0, 100);
  const line = `${boss.name} is defeated by ${context.band?.name ?? storyActorName(context.leader)}; ${decision.text}.`;
  pushLegendHistory(world, boss.history, decision, context, line);
  addOutcomeHook(world, "boss", boss.id, boss.name, boss.locationId, boss.hooks, decision, context);
  return `${boss.name} is broken as a power in ${settlement.name}; ${decision.text}.`;
}

function adjudicateCrisisSuccess(world: World, crisis: StoryCrisis, context: LegendHandlingContext): string {
  const settlement = world.settlements[crisis.locationId];
  const decision = decideLegendMutation(context, crisis.severity, crisis.progress);
  crisis.myth = decision.tone;
  const suppression = decision.tone === "suppressed";
  const corruptDeal = decision.tone === "corrupt";
  crisis.progress = clamp(crisis.progress - (suppression ? 58 : corruptDeal ? 24 : 42), 0, 100);
  crisis.severity = clamp(crisis.severity - (suppression ? 10 : corruptDeal ? 7 : 20), 0, 100);
  crisis.publicTrust = clamp(crisis.publicTrust + (decision.tone === "merciful" ? 20 : suppression ? -8 : corruptDeal ? -12 : 8), 0, 100);
  crisis.radicalization = clamp(crisis.radicalization + (suppression ? 18 : corruptDeal ? 10 : -14), 0, 100);
  settlement.unrest = clamp(settlement.unrest + (suppression ? 5 : -10), 0, 100);
  settlement.threat = clamp(settlement.threat - (crisis.kind === "invasion" || crisis.kind === "curse" ? 8 : 3), 0, 100);
  if (crisis.severity <= 18 || crisis.progress <= 8) {
    crisis.status = "resolved";
    world.factions[crisis.factionId].stability = clamp(world.factions[crisis.factionId].stability + (suppression ? 3 : 9), 0, 100);
  }
  const outcome: LegendOutcome = crisis.status === "resolved" ? (suppression ? "suppressed" : "contained") : decision.outcome;
  const outcomeDecision = { ...decision, outcome };
  const line = `${crisis.name} is handled by ${context.band?.name ?? storyActorName(context.leader)}; ${decision.text}.`;
  pushLegendHistory(world, crisis.history, outcomeDecision, context, line);
  addOutcomeHook(world, "crisis", crisis.id, crisis.name, crisis.locationId, crisis.hooks, outcomeDecision, context, crisis.kind);
  return crisis.status === "resolved"
    ? `${crisis.name} resolves into ${suppression ? "enforced quiet" : "uneasy order"}; ${decision.text}.`
    : `${crisis.name} loses force, but its embers remain; ${decision.text}.`;
}

export function resolveStoryQuest(world: World, band: Band, quest: Quest, receiver: Person, rng: Rng): string | undefined {
  if (!quest.storyId || !quest.storyKind) {
    return undefined;
  }
  ensureStoryState(world, rng);
  const leader = world.persons[band.leaderId] ?? receiver;
  const settlement = world.settlements[quest.locationId];
  const context = handlingContext(world, "success", band, receiver);

  if (quest.storyKind === "artifact") {
    const artifact = world.story.artifacts[quest.storyId];
    if (!artifact || artifact.status === "claimed") return undefined;
    settlement.prosperity = clamp(settlement.prosperity + rng.int(1, 4), 0, 100);
    return adjudicateArtifactSuccess(world, artifact, receiver, context);
  }

  if (quest.storyKind === "boss") {
    const boss = world.story.bosses[quest.storyId];
    if (!boss || boss.status === "defeated") return undefined;
    const bossLine = adjudicateBossSuccess(world, boss, context);
    band.notoriety = clamp(band.notoriety + rng.int(6, 14), 0, 100);
    leader.renown += rng.int(4, 10);
    const artifact = boss.guardingArtifactId ? world.story.artifacts[boss.guardingArtifactId] : undefined;
    const artifactLine = artifact && artifact.status !== "claimed" ? ` ${adjudicateArtifactSuccess(world, artifact, receiver, context)}` : "";
    return `${bossLine}${artifactLine}`;
  }

  const crisis = world.story.crises[quest.storyId];
  if (!crisis || crisis.status === "resolved") return undefined;
  return adjudicateCrisisSuccess(world, crisis, context);
}

export function expireStoryQuest(world: World, quest: Quest, rng: Rng): string | undefined {
  if (!quest.storyId || !quest.storyKind) {
    return undefined;
  }
  ensureStoryState(world, rng);
  const settlement = world.settlements[quest.locationId];
  const context = handlingContext(world, "expired", undefined, undefined);
  if (quest.storyKind === "boss") {
    const boss = world.story.bosses[quest.storyId];
    if (!boss || boss.status !== "active") return undefined;
    const decision = decideLegendMutation(context, boss.power, boss.threat);
    boss.threat = clamp(boss.threat + rng.int(3, 8), 0, 100);
    boss.power = clamp(boss.power + rng.int(1, 4), 0, 120);
    boss.dread = clamp(boss.dread + rng.int(5, 12), 0, 100);
    boss.following = clamp(boss.following + rng.int(2, 8), 0, 100);
    boss.legacy = "neglected";
    settlement.threat = clamp(settlement.threat + rng.int(4, 12), 0, 100);
    const line = `${boss.name} grows bolder after being left unanswered; ${decision.text}.`;
    pushLegendHistory(world, boss.history, decision, context, line);
    addOutcomeHook(world, "boss", boss.id, boss.name, boss.locationId, boss.hooks, decision, context);
    return line;
  }
  if (quest.storyKind === "crisis") {
    const crisis = world.story.crises[quest.storyId];
    if (!crisis || crisis.status !== "active") return undefined;
    const decision = decideLegendMutation(context, crisis.severity, crisis.progress);
    crisis.severity = clamp(crisis.severity + rng.int(4, 10), 0, 100);
    crisis.progress = clamp(crisis.progress + rng.int(8, 18), 0, 120);
    crisis.publicTrust = clamp(crisis.publicTrust - rng.int(4, 10), 0, 100);
    crisis.radicalization = clamp(crisis.radicalization + rng.int(5, 13), 0, 100);
    crisis.myth = "neglected";
    const line = `${crisis.name} spreads while contracts go unsigned; ${decision.text}.`;
    pushLegendHistory(world, crisis.history, decision, context, line);
    addOutcomeHook(world, "crisis", crisis.id, crisis.name, crisis.locationId, crisis.hooks, decision, context, crisis.kind);
    return line;
  }
  const artifact = world.story.artifacts[quest.storyId];
  if (!artifact || artifact.status === "claimed") return undefined;
  artifact.status = "rumored";
  const decision = decideLegendMutation(context, artifact.power);
  artifact.fame = clamp(artifact.fame + rng.int(2, 8), 0, 100);
  artifact.corruption = clamp(artifact.corruption + rng.int(2, 7), 0, 100);
  artifact.tone = "neglected";
  const line = `${artifact.name} slips back into rumor; ${decision.text}.`;
  pushLegendHistory(world, artifact.history, decision, context, line);
  addOutcomeHook(world, "artifact", artifact.id, artifact.name, artifact.locationId, artifact.hooks, decision, context);
  return line;
}

export function setbackStoryQuest(world: World, band: Band, quest: Quest, rng: Rng, reason: string): string | undefined {
  if (!quest.storyId || !quest.storyKind) {
    return undefined;
  }
  ensureStoryState(world, rng);
  const context = handlingContext(world, "setback", band, world.persons[band.leaderId], reason);
  const settlement = world.settlements[quest.locationId];

  if (quest.storyKind === "artifact") {
    const artifact = world.story.artifacts[quest.storyId];
    if (!artifact || artifact.status === "claimed") return undefined;
    const decision = decideLegendMutation(context, artifact.power, quest.danger);
    artifact.status = "rumored";
    artifact.fame = clamp(artifact.fame + 4 + decision.sacrifice * 0.04, 0, 100);
    artifact.corruption = clamp(artifact.corruption + 3 + decision.corruption * 0.04, 0, 100);
    artifact.tone = decision.tone === "dread" ? "contested" : decision.tone;
    artifact.tags = [...new Set([...artifact.tags, "lure"])];
    const line = `${artifact.name} refuses ${band.name}; ${decision.text}.`;
    pushLegendHistory(world, artifact.history, decision, context, line);
    addOutcomeHook(world, "artifact", artifact.id, artifact.name, artifact.locationId, artifact.hooks, decision, context);
    return line;
  }

  if (quest.storyKind === "boss") {
    const boss = world.story.bosses[quest.storyId];
    if (!boss || boss.status !== "active") return undefined;
    const decision = decideLegendMutation(context, boss.power, boss.threat);
    boss.power = clamp(boss.power + rng.int(1, 5), 0, 120);
    boss.threat = clamp(boss.threat + rng.int(4, 10), 0, 100);
    boss.dread = clamp(boss.dread + rng.int(6, 14), 0, 100);
    boss.following = clamp(boss.following + rng.int(2, 8), 0, 100);
    boss.legacy = decision.tone === "corrupt" ? "corrupt" : "dread";
    boss.tags = [...new Set([...boss.tags, band.memberIds.some((id) => (world.persons[id]?.skills.sorcery ?? 0) > 45) ? "anti-magic" : "party-grudge"])];
    settlement.threat = clamp(settlement.threat + rng.int(4, 12), 0, 100);
    const line = `${boss.name} learns from ${band.name}'s failure; ${decision.text}.`;
    pushLegendHistory(world, boss.history, decision, context, line);
    addOutcomeHook(world, "boss", boss.id, boss.name, boss.locationId, boss.hooks, decision, context);
    return line;
  }

  const crisis = world.story.crises[quest.storyId];
  if (!crisis || crisis.status === "resolved") return undefined;
  const decision = decideLegendMutation(context, crisis.severity, crisis.progress);
  crisis.severity = clamp(crisis.severity + rng.int(2, 8), 0, 100);
  crisis.progress = clamp(crisis.progress + rng.int(5, 14), 0, 120);
  crisis.publicTrust = clamp(crisis.publicTrust - rng.int(3, 9), 0, 100);
  crisis.radicalization = clamp(crisis.radicalization + rng.int(4, 12), 0, 100);
  crisis.myth = decision.tone;
  settlement.unrest = clamp(settlement.unrest + rng.int(3, 9), 0, 100);
  const line = `${crisis.name} mutates around ${band.name}'s setback; ${decision.text}.`;
  pushLegendHistory(world, crisis.history, decision, context, line);
  addOutcomeHook(world, "crisis", crisis.id, crisis.name, crisis.locationId, crisis.hooks, decision, context, crisis.kind);
  return line;
}

export function storyQuestBias(world: World, quest: Quest, leader: Person): number {
  if (!quest.storyId || !quest.storyKind) {
    return 0;
  }
  if (quest.storyKind === "artifact") {
    const artifact = world.story.artifacts[quest.storyId];
    return artifact ? 14 + artifact.power * 1.2 + leader.traits.curiosity * 0.14 + leader.traits.ambition * 0.1 : 0;
  }
  if (quest.storyKind === "boss") {
    const boss = world.story.bosses[quest.storyId];
    return boss ? 12 + boss.power * 0.08 + leader.traits.bravery * 0.18 + leader.traits.wrath * 0.08 - leader.traits.caution * 0.08 : 0;
  }
  const crisis = world.story.crises[quest.storyId];
  if (!crisis) {
    return 0;
  }
  const homeBias = crisis.factionId === leader.factionId ? 12 : 0;
  return homeBias + 8 + crisis.severity * 0.1 + leader.traits.loyalty * 0.14 + leader.traits.mercy * 0.1;
}

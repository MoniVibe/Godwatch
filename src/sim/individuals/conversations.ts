import { event } from "../chronicle/events";
import { clamp, makeId } from "../core/math";
import { addMemory } from "./people";
import { deriveIntentProjection, type IntentProjection } from "./ambitions";
import type { ChronicleEvent, Id, Person, Quest, SocialIntent, SocialIntentKind, World } from "../types";

export type ConversationTopicKind =
  | "intent"
  | "relation"
  | "faction"
  | "culture"
  | "condition"
  | "threat"
  | "quest"
  | "deception"
  | "compulsion";

export type ConversationHonestyHint = "plain" | "guarded" | "cover-story" | "lie-risk" | "foreign-will";

export interface ConversationTopic {
  id: Id;
  kind: ConversationTopicKind;
  speakerId: Id;
  listenerId: Id;
  score: number;
  honestyRisk: number;
  intentKind?: SocialIntentKind;
  targetPersonId?: Id;
  targetFactionId?: Id;
  targetLocationId?: Id;
  questId?: Id;
  subject: string;
  text: string;
  reasons: string[];
  tags: string[];
}

export interface ConversationProjection {
  id: Id;
  tick: number;
  speakerId: Id;
  listenerId: Id;
  topic: ConversationTopic;
  alternateTopics: ConversationTopic[];
  speakerVisibleIntents: SocialIntent[];
  listenerVisibleIntents: SocialIntent[];
  speakerHiddenIntent?: SocialIntent;
  honestyRisk: number;
  honestyHint: ConversationHonestyHint;
  trustDelta: number;
  suspicionDelta: number;
  relationDelta: number;
  memoryText: string;
  eventText?: string;
  tags: string[];
}

export interface ConversationProjectionOptions {
  maxTopics?: number;
  includeQuests?: boolean;
  includeHiddenIntentRisk?: boolean;
  minTopicScore?: number;
}

export interface ConversationApplyOptions {
  addMemories?: boolean;
  updateTrust?: boolean;
  updateSuspicion?: boolean;
  updateRelations?: boolean;
  emitEvent?: boolean;
}

export interface ConversationApplyResult {
  applied: boolean;
  speakerId: Id;
  listenerId: Id;
  trustDelta: number;
  suspicionDelta: number;
  relationDelta: number;
  memoryTexts: string[];
  eventText?: string;
  tags: string[];
}

interface TopicDraft {
  kind: ConversationTopicKind;
  score: number;
  honestyRisk?: number;
  intentKind?: SocialIntentKind;
  targetPersonId?: Id;
  targetFactionId?: Id;
  targetLocationId?: Id;
  questId?: Id;
  subject: string;
  text: string;
  reasons: string[];
  tags: string[];
}

interface ConversationContext {
  speakerProjection: IntentProjection;
  listenerProjection: IntentProjection;
  relation: number;
  trust: number;
  suspicion: number;
  sharedLocation: boolean;
  sharedFaction: boolean;
  sharedCulture: boolean;
}

const secretIntentKinds = new Set<SocialIntentKind>(["avenge", "undermine-rival", "hide-truth", "obey-compulsion"]);

function stableTextCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 33 + value.charCodeAt(index)) % 2147483647;
  }
  return code;
}

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function personName(person: Person): string {
  return `${person.name} ${person.familyName}`.trim();
}

function intentSubject(world: World, intent: SocialIntent): string {
  if (intent.targetPersonId && world.persons[intent.targetPersonId]) {
    return personName(world.persons[intent.targetPersonId]);
  }
  if (intent.targetFactionId && world.factions[intent.targetFactionId]) {
    return world.factions[intent.targetFactionId].name;
  }
  if (intent.targetLocationId && world.settlements[intent.targetLocationId]) {
    return world.settlements[intent.targetLocationId].name;
  }
  return intent.text;
}

function describeIntentTopic(world: World, speaker: Person, listener: Person, intent: SocialIntent): string {
  const subject = intentSubject(world, intent);
  if (intent.kind === "recover") return `${personName(speaker)} talks to ${listener.name} about recovering strength around ${subject}.`;
  if (intent.kind === "protect") return `${personName(speaker)} talks to ${listener.name} about protecting ${subject}.`;
  if (intent.kind === "seek-relic") return `${personName(speaker)} shares a careful thought about relic signs near ${subject}.`;
  if (intent.kind === "learn-magic") return `${personName(speaker)} asks ${listener.name} what they know about magic and hidden workings.`;
  if (intent.kind === "master-craft") return `${personName(speaker)} talks to ${listener.name} about craft, methods, and patient practice.`;
  if (intent.kind === "gain-wealth") return `${personName(speaker)} talks to ${listener.name} about coin, work, and opportunity.`;
  if (intent.kind === "gain-renown") return `${personName(speaker)} talks to ${listener.name} about a deed worth remembering.`;
  if (intent.kind === "avenge") return `${personName(speaker)} circles a grudge while speaking with ${listener.name}.`;
  if (intent.kind === "romance") return `${personName(speaker)} speaks warmly with ${listener.name} about bonds and households.`;
  if (intent.kind === "serve-society") return `${personName(speaker)} talks to ${listener.name} about duty to ${subject}.`;
  if (intent.kind === "undermine-rival") return `${personName(speaker)} tests ${listener.name}'s appetite for a rival's weakness.`;
  if (intent.kind === "hide-truth") return `${personName(speaker)} keeps the talk narrow, steering ${listener.name} away from a buried truth.`;
  if (intent.kind === "obey-compulsion") return `${personName(speaker)} speaks with an odd pressure behind the words.`;
  return `${personName(speaker)} talks to ${listener.name} about staying alive.`;
}

function contextFor(world: World, speaker: Person, listener: Person): ConversationContext {
  const speakerProjection = deriveIntentProjection(world, speaker, { visibleCount: 3, hiddenCount: 1 });
  const listenerProjection = deriveIntentProjection(world, listener, { visibleCount: 3, hiddenCount: 1 });
  const relation = speaker.relations[listener.id] ?? listener.relations[speaker.id] ?? 0;
  const trust = listener.social?.trustByPersonId[speaker.id] ?? Math.max(0, relation);
  const suspicion = listener.social?.suspicionByPersonId[speaker.id] ?? Math.max(0, -relation);
  return {
    speakerProjection,
    listenerProjection,
    relation,
    trust,
    suspicion,
    sharedLocation: speaker.locationId === listener.locationId,
    sharedFaction: speaker.factionId === listener.factionId,
    sharedCulture: speaker.cultureId === listener.cultureId
  };
}

function baseHonestyRisk(speaker: Person, listener: Person, context: ConversationContext, intent?: SocialIntent): number {
  const hidden = context.speakerProjection.hiddenIntents[0] ?? speaker.social?.hiddenIntent;
  const hiddenSecrecy = hidden?.secrecy ?? 0;
  const hiddenConflict = hidden && intent && hidden.kind !== intent.kind ? 12 : 0;
  const compulsion = speaker.social?.compulsion ? speaker.social.compulsion.strength * 0.42 : 0;
  const deceptionHistory = (speaker.social?.deceptionHistory ?? []).filter((record) => record.listenerId === listener.id || record.speakerId === speaker.id).length * 3;
  const listenerRead = listener.stats.derived.perception * 0.08 + listener.stats.derived.wisdom * 0.05 + context.suspicion * 0.28;
  const speakerCover = speaker.stats.derived.charisma * 0.07 + speaker.skills.diplomacy * 0.08 + context.trust * 0.1;
  const secretTopic = intent && secretIntentKinds.has(intent.kind) ? 18 : 0;
  return rounded(hiddenSecrecy * 0.5 + hiddenConflict + compulsion + deceptionHistory + listenerRead + secretTopic - speakerCover);
}

function createTopic(world: World, speaker: Person, listener: Person, draft: TopicDraft): ConversationTopic {
  const tags = uniqueText(["conversation", draft.kind, ...draft.tags]).slice(0, 18);
  const reasons = uniqueText(draft.reasons).slice(0, 8);
  const key = `${world.tick}:${speaker.id}:${listener.id}:${draft.kind}:${draft.intentKind ?? ""}:${draft.questId ?? ""}:${draft.subject}`;
  return {
    id: makeId("conversation-topic", stableTextCode(key)),
    kind: draft.kind,
    speakerId: speaker.id,
    listenerId: listener.id,
    score: rounded(draft.score, 0, 160),
    honestyRisk: rounded(draft.honestyRisk ?? 0),
    intentKind: draft.intentKind,
    targetPersonId: draft.targetPersonId,
    targetFactionId: draft.targetFactionId,
    targetLocationId: draft.targetLocationId,
    questId: draft.questId,
    subject: draft.subject,
    text: draft.text,
    reasons,
    tags
  };
}

function intentTopics(world: World, speaker: Person, listener: Person, context: ConversationContext): ConversationTopic[] {
  return context.speakerProjection.visibleIntents.map((intent, index) => {
    const matchingListenerIntent = context.listenerProjection.visibleIntents.find((candidate) => candidate.kind === intent.kind);
    const sharedTagBonus = matchingListenerIntent ? 16 : context.listenerProjection.visibleIntents.some((candidate) => candidate.tags.some((tag) => intent.tags.includes(tag))) ? 7 : 0;
    const relationEase = Math.max(0, context.relation) * 0.08 + context.trust * 0.06 - context.suspicion * 0.08;
    return createTopic(world, speaker, listener, {
      kind: intent.kind === "hide-truth" ? "deception" : intent.kind === "obey-compulsion" ? "compulsion" : "intent",
      score: intent.strength + sharedTagBonus + relationEase - index * 4,
      honestyRisk: baseHonestyRisk(speaker, listener, context, intent),
      intentKind: intent.kind,
      targetPersonId: intent.targetPersonId,
      targetFactionId: intent.targetFactionId,
      targetLocationId: intent.targetLocationId,
      subject: intentSubject(world, intent),
      text: describeIntentTopic(world, speaker, listener, intent),
      reasons: [
        `speaker visible intent: ${intent.kind}`,
        matchingListenerIntent ? `listener also feels ${matchingListenerIntent.kind}` : "listener may react through related pressures"
      ],
      tags: uniqueText([...intent.tags, ...(matchingListenerIntent?.tags ?? []), intent.kind])
    });
  });
}

function relationTopic(world: World, speaker: Person, listener: Person, context: ConversationContext): ConversationTopic | undefined {
  const stance = speaker.relationStances?.[listener.id] ?? listener.relationStances?.[speaker.id];
  const emotionalPressure = Math.abs(context.relation) + context.trust * 0.25 + context.suspicion * 0.4 + (stance?.rivalry ?? 0) * 0.18 + (stance?.friendship ?? 0) * 0.16;
  if (emotionalPressure < 18) {
    return undefined;
  }
  const tense = context.relation < -10 || context.suspicion > 35 || (stance?.rivalry ?? 0) > 35;
  const subject = tense ? "old tension" : "shared trust";
  return createTopic(world, speaker, listener, {
    kind: "relation",
    score: 24 + emotionalPressure * 0.72,
    honestyRisk: rounded(context.suspicion * 0.36 + Math.max(0, -context.relation) * 0.18),
    targetPersonId: listener.id,
    subject,
    text: tense
      ? `${personName(speaker)} and ${listener.name} talk around old tension without fully naming it.`
      : `${personName(speaker)} and ${listener.name} trade small signs of trust.`,
    reasons: [stance ? `relation stance: ${stance.stance}` : `relation ${Math.round(context.relation)}`, `trust ${Math.round(context.trust)}`, `suspicion ${Math.round(context.suspicion)}`],
    tags: uniqueText(["relation", tense ? "tension" : "trust", ...(stance?.tags ?? [])])
  });
}

function factionCultureTopics(world: World, speaker: Person, listener: Person, context: ConversationContext): ConversationTopic[] {
  const topics: ConversationTopic[] = [];
  const speakerFaction = world.factions[speaker.factionId];
  const listenerFaction = world.factions[listener.factionId];
  const speakerCulture = world.cultures[speaker.cultureId];
  const listenerCulture = world.cultures[listener.cultureId];

  if (speakerFaction && listenerFaction) {
    const factionRelation = speakerFaction.relations[listenerFaction.id] ?? (context.sharedFaction ? 35 : 0);
    const atWar = speakerFaction.activeWars.includes(listenerFaction.id) || listenerFaction.activeWars.includes(speakerFaction.id);
    if (context.sharedFaction || atWar || Math.abs(factionRelation) > 24) {
      topics.push(
        createTopic(world, speaker, listener, {
          kind: "faction",
          score: 30 + Math.abs(factionRelation) * 0.38 + (atWar ? 28 : 0) + (context.sharedFaction ? 8 : 0),
          honestyRisk: atWar ? rounded(22 + context.suspicion * 0.24) : rounded(context.suspicion * 0.18),
          targetFactionId: listenerFaction.id,
          subject: context.sharedFaction ? speakerFaction.name : `${speakerFaction.name} and ${listenerFaction.name}`,
          text: atWar
            ? `${personName(speaker)} and ${listener.name} weigh what the war between ${speakerFaction.name} and ${listenerFaction.name} costs.`
            : `${personName(speaker)} speaks with ${listener.name} about where ${speakerFaction.name} stands.`,
          reasons: [atWar ? "their societies are at war" : context.sharedFaction ? "shared faction" : `faction relation ${Math.round(factionRelation)}`],
          tags: uniqueText(["faction", atWar ? "war" : "standing", context.sharedFaction ? "same-faction" : "foreign"])
        })
      );
    }
  }

  if (speakerCulture && listenerCulture && (!context.sharedCulture || speaker.fosterCultureId || listener.fosterCultureId || speaker.cultureBlend > 30 || listener.cultureBlend > 30)) {
    topics.push(
      createTopic(world, speaker, listener, {
        kind: "culture",
        score: 28 + (context.sharedCulture ? 8 : 18) + Math.max(speaker.cultureBlend, listener.cultureBlend) * 0.16 + Math.abs(speakerCulture.level - listenerCulture.level) * 2,
        honestyRisk: rounded(context.suspicion * 0.14 + (context.sharedCulture ? 0 : 8)),
        subject: context.sharedCulture ? speakerCulture.name : `${speakerCulture.name} and ${listenerCulture.name}`,
        text: context.sharedCulture
          ? `${personName(speaker)} and ${listener.name} talk about the customs that still hold them together.`
          : `${personName(speaker)} asks ${listener.name} how ${listenerCulture.name} sees the practices of ${speakerCulture.name}.`,
        reasons: [context.sharedCulture ? "shared culture" : "different cultures", `speaker blend ${Math.round(speaker.cultureBlend)}`, `listener blend ${Math.round(listener.cultureBlend)}`],
        tags: uniqueText(["culture", context.sharedCulture ? "tradition" : "hybrid", speakerCulture.id, listenerCulture.id])
      })
    );
  }

  return topics;
}

function conditionTopic(world: World, speaker: Person, listener: Person, context: ConversationContext): ConversationTopic | undefined {
  const observed = [speaker, listener]
    .map((person) => {
      const hpPressure = person.maxHp > 0 ? (1 - person.hp / person.maxHp) * 42 : 0;
      const injuryPressure = (person.injuries ?? []).reduce((sum, injury) => sum + injury.burden + injury.pain * 0.35, 0);
      const scarPressure = (person.scars ?? []).reduce((sum, scar) => sum + (scar.severity === "legendary" ? 9 : 3) + scar.burden * 0.25, 0);
      const augmentationPressure = (person.augmentations ?? []).reduce((sum, augmentation) => sum + (augmentation.active ? 3 : 12) + Math.max(0, 100 - augmentation.condition) * 0.08, 0);
      const statusPressure = (person.status ?? []).filter((status) => /wound|bleed|poison|curse|haunt|possess|strain|low-power|sick|fever|plague/.test(status)).length * 10;
      return { person, pressure: hpPressure + injuryPressure + scarPressure + augmentationPressure + statusPressure };
    })
    .sort((left, right) => right.pressure - left.pressure || left.person.id.localeCompare(right.person.id))[0];

  if (!observed || observed.pressure < 15) {
    return undefined;
  }

  const selfTalk = observed.person.id === speaker.id;
  return createTopic(world, speaker, listener, {
    kind: "condition",
    score: 24 + observed.pressure * 0.8 + speaker.skills.medicine * 0.12 + listener.stats.derived.perception * 0.08,
    honestyRisk: rounded(baseHonestyRisk(speaker, listener, context) * 0.55 + (observed.person.status.some((status) => /curse|possess|compel/.test(status)) ? 18 : 0)),
    targetPersonId: observed.person.id,
    subject: `${personName(observed.person)}'s condition`,
    text: selfTalk
      ? `${personName(speaker)} lets ${listener.name} see a little of the strain they are carrying.`
      : `${personName(speaker)} notices the strain ${listener.name} is carrying.`,
    reasons: [`condition pressure ${Math.round(observed.pressure)}`, `${observed.person.injuries?.length ?? 0} injuries`, `${observed.person.augmentations?.length ?? 0} augmentations`],
    tags: uniqueText(["condition", "body", ...(observed.person.status ?? []).slice(0, 5)])
  });
}

function threatTopic(world: World, speaker: Person, listener: Person, context: ConversationContext): ConversationTopic | undefined {
  const settlement = world.settlements[speaker.locationId] ?? world.settlements[listener.locationId];
  if (!settlement || (!context.sharedLocation && settlement.id !== speaker.locationId)) {
    return undefined;
  }
  const localQuestPressure = Object.values(world.quests)
    .filter((quest) => (quest.status === "open" || quest.status === "active") && quest.locationId === settlement.id)
    .reduce((sum, quest) => sum + quest.danger * 0.18 + quest.urgency * 0.12, 0);
  const pressure = settlement.threat * 0.75 + settlement.unrest * 0.28 + localQuestPressure;
  if (pressure < 25) {
    return undefined;
  }
  return createTopic(world, speaker, listener, {
    kind: "threat",
    score: 22 + pressure,
    honestyRisk: rounded(context.suspicion * 0.14 + (settlement.unrest > 55 ? 8 : 0)),
    targetLocationId: settlement.id,
    subject: settlement.name,
    text: `${personName(speaker)} and ${listener.name} speak quietly about the danger around ${settlement.name}.`,
    reasons: [`threat ${Math.round(settlement.threat)}`, `unrest ${Math.round(settlement.unrest)}`, `local quest pressure ${Math.round(localQuestPressure)}`],
    tags: uniqueText(["threat", "settlement", settlement.biomeId, settlement.terrain, ...settlement.localThreats.slice(0, 3)])
  });
}

function questTopics(world: World, speaker: Person, listener: Person, context: ConversationContext, includeQuests: boolean): ConversationTopic[] {
  if (!includeQuests) {
    return [];
  }
  return Object.values(world.quests)
    .filter((quest) => quest.status === "open" || quest.status === "active")
    .filter((quest) => quest.locationId === speaker.locationId || quest.locationId === listener.locationId)
    .sort((left, right) => right.urgency + right.danger - (left.urgency + left.danger) || left.id.localeCompare(right.id))
    .slice(0, 3)
    .map((quest) => questTopic(world, speaker, listener, context, quest));
}

function questTopic(world: World, speaker: Person, listener: Person, context: ConversationContext, quest: Quest): ConversationTopic {
  const settlement = world.settlements[quest.locationId];
  const faction = world.factions[quest.issuerFactionId];
  const matchingIntent = context.speakerProjection.visibleIntents.find((intent) => {
    if (quest.kind === "defense") return intent.kind === "protect" || intent.kind === "serve-society";
    if (quest.kind === "delve") return intent.kind === "seek-relic" || intent.kind === "learn-magic";
    if (quest.kind === "hunt") return intent.kind === "gain-renown" || intent.kind === "survive";
    if (quest.kind === "escort") return intent.kind === "gain-wealth" || intent.kind === "protect" || intent.kind === "recover";
    return intent.kind === "serve-society" || intent.kind === "undermine-rival";
  });
  return createTopic(world, speaker, listener, {
    kind: "quest",
    score: 24 + quest.urgency * 0.42 + quest.danger * 0.28 + (matchingIntent ? 14 : 0),
    honestyRisk: rounded(baseHonestyRisk(speaker, listener, context, matchingIntent) * 0.62 + (quest.kind === "politics" ? 10 : 0)),
    intentKind: matchingIntent?.kind,
    targetFactionId: quest.targetFactionId ?? quest.issuerFactionId,
    targetLocationId: quest.locationId,
    questId: quest.id,
    subject: quest.title,
    text: `${personName(speaker)} brings up ${quest.title}${settlement ? ` near ${settlement.name}` : ""}${faction ? ` for ${faction.name}` : ""}.`,
    reasons: [`quest ${quest.kind}`, `urgency ${Math.round(quest.urgency)}`, `danger ${Math.round(quest.danger)}`, matchingIntent ? `matches ${matchingIntent.kind}` : "no direct intent match"],
    tags: uniqueText(["quest", quest.kind, quest.storyKind, matchingIntent?.kind])
  });
}

function sortedTopics(topics: readonly ConversationTopic[]): ConversationTopic[] {
  return [...topics].sort(
    (left, right) =>
      right.score - left.score ||
      right.honestyRisk - left.honestyRisk ||
      left.kind.localeCompare(right.kind) ||
      left.subject.localeCompare(right.subject) ||
      left.id.localeCompare(right.id)
  );
}

function honestyHintFor(speaker: Person, topic: ConversationTopic, hiddenIntent: SocialIntent | undefined): ConversationHonestyHint {
  if (speaker.social?.compulsion || topic.intentKind === "obey-compulsion") return "foreign-will";
  if (topic.honestyRisk >= 68) return "lie-risk";
  if (hiddenIntent && topic.intentKind && hiddenIntent.kind !== topic.intentKind && topic.honestyRisk >= 42) return "cover-story";
  if (topic.honestyRisk >= 28) return "guarded";
  return "plain";
}

function projectionDeltas(topic: ConversationTopic, context: ConversationContext): Pick<ConversationProjection, "trustDelta" | "suspicionDelta" | "relationDelta"> {
  const warmTopic = topic.kind === "relation" || topic.kind === "culture" || topic.kind === "condition";
  const dutyTopic = topic.kind === "faction" || topic.kind === "quest" || topic.kind === "threat";
  const trustBase = warmTopic ? 2 : dutyTopic ? 1 : 0;
  const riskPenalty = topic.honestyRisk >= 70 ? 3 : topic.honestyRisk >= 45 ? 1 : 0;
  const suspicionDelta = topic.honestyRisk >= 70 ? 4 : topic.honestyRisk >= 48 ? 2 : topic.honestyRisk <= 12 && context.suspicion > 0 ? -1 : 0;
  const trustDelta = rounded(trustBase - riskPenalty, -6, 5);
  const relationDelta = rounded((warmTopic && topic.honestyRisk < 50 ? 1 : 0) + (topic.kind === "relation" && context.relation < -20 ? 1 : 0) - (topic.honestyRisk >= 82 ? 1 : 0), -3, 3);
  return { trustDelta, suspicionDelta, relationDelta };
}

function memoryTextFor(speaker: Person, listener: Person, topic: ConversationTopic, hint: ConversationHonestyHint): string {
  if (hint === "foreign-will") return `Heard something foreign behind ${speaker.name}'s words about ${topic.subject}`;
  if (hint === "lie-risk") return `Did not fully believe ${speaker.name}'s talk about ${topic.subject}`;
  if (hint === "cover-story") return `Suspected ${speaker.name}'s talk about ${topic.subject} covered another intent`;
  if (topic.kind === "condition") return `Talked with ${speaker.name} about a condition that mattered`;
  if (topic.kind === "quest") return `Talked with ${speaker.name} about ${topic.subject}`;
  if (topic.kind === "relation") return `Shared a personal conversation with ${speaker.name}`;
  return `${listener.name} heard ${speaker.name} talk about ${topic.subject}`;
}

function eventTextFor(speaker: Person, listener: Person, topic: ConversationTopic, hint: ConversationHonestyHint): string | undefined {
  if (topic.score < 68 && topic.honestyRisk < 64) {
    return undefined;
  }
  if (hint === "foreign-will") return `${listener.name} ${listener.familyName} notices foreign pressure in ${speaker.name} ${speaker.familyName}'s talk about ${topic.subject}.`;
  if (hint === "lie-risk") return `${listener.name} ${listener.familyName} leaves a conversation with ${speaker.name} ${speaker.familyName} unsure what was true about ${topic.subject}.`;
  return `${speaker.name} ${speaker.familyName} and ${listener.name} ${listener.familyName} talk about ${topic.subject}.`;
}

export function deriveConversationTopics(world: World, speaker: Person, listener: Person, options: ConversationProjectionOptions = {}): ConversationTopic[] {
  if (!speaker.alive || !listener.alive || speaker.id === listener.id) {
    return [];
  }

  const context = contextFor(world, speaker, listener);
  const topics = [
    ...intentTopics(world, speaker, listener, context),
    relationTopic(world, speaker, listener, context),
    ...factionCultureTopics(world, speaker, listener, context),
    conditionTopic(world, speaker, listener, context),
    threatTopic(world, speaker, listener, context),
    ...questTopics(world, speaker, listener, context, options.includeQuests ?? true)
  ].filter((topic): topic is ConversationTopic => Boolean(topic));
  const minScore = options.minTopicScore ?? 18;
  return sortedTopics(topics.filter((topic) => topic.score >= minScore)).slice(0, clamp(Math.round(options.maxTopics ?? 6), 1, 12));
}

export function deriveConversationProjection(world: World, speaker: Person, listener: Person, options: ConversationProjectionOptions = {}): ConversationProjection | undefined {
  const context = contextFor(world, speaker, listener);
  const topics = deriveConversationTopics(world, speaker, listener, options);
  const topic = topics[0];
  if (!topic) {
    return undefined;
  }

  const hiddenIntent = (options.includeHiddenIntentRisk ?? true) ? context.speakerProjection.hiddenIntents[0] ?? speaker.social?.hiddenIntent : undefined;
  const honestyRisk = rounded(Math.max(topic.honestyRisk, hiddenIntent && topic.intentKind && hiddenIntent.kind !== topic.intentKind ? hiddenIntent.secrecy * 0.58 : 0));
  const topicWithRisk = { ...topic, honestyRisk };
  const honestyHint = honestyHintFor(speaker, topicWithRisk, hiddenIntent);
  const deltas = projectionDeltas(topicWithRisk, context);
  const memoryText = memoryTextFor(speaker, listener, topicWithRisk, honestyHint);
  const tags = uniqueText([...topicWithRisk.tags, honestyHint, ...(hiddenIntent ? ["hidden-intent"] : [])]).slice(0, 20);

  return {
    id: makeId("conversation", stableTextCode(`${world.tick}:${speaker.id}:${listener.id}:${topicWithRisk.id}:${honestyHint}`)),
    tick: world.tick,
    speakerId: speaker.id,
    listenerId: listener.id,
    topic: topicWithRisk,
    alternateTopics: topics.slice(1, clamp(Math.round(options.maxTopics ?? 4), 1, 8)),
    speakerVisibleIntents: context.speakerProjection.visibleIntents,
    listenerVisibleIntents: context.listenerProjection.visibleIntents,
    speakerHiddenIntent: hiddenIntent,
    honestyRisk,
    honestyHint,
    ...deltas,
    memoryText,
    eventText: eventTextFor(speaker, listener, topicWithRisk, honestyHint),
    tags
  };
}

export function applyConversationProjection(world: World, projection: ConversationProjection, options: ConversationApplyOptions = {}): ConversationApplyResult {
  const speaker = world.persons[projection.speakerId];
  const listener = world.persons[projection.listenerId];
  if (!speaker || !listener) {
    return {
      applied: false,
      speakerId: projection.speakerId,
      listenerId: projection.listenerId,
      trustDelta: 0,
      suspicionDelta: 0,
      relationDelta: 0,
      memoryTexts: [],
      tags: ["conversation", "missing-person"]
    };
  }

  const updateTrust = options.updateTrust ?? true;
  const updateSuspicion = options.updateSuspicion ?? true;
  const updateRelations = options.updateRelations ?? true;
  const addMemories = options.addMemories ?? true;
  const memoryTexts: string[] = [];

  if (updateTrust && listener.social) {
    listener.social.trustByPersonId ??= {};
    listener.social.trustByPersonId[speaker.id] = rounded((listener.social.trustByPersonId[speaker.id] ?? Math.max(0, listener.relations[speaker.id] ?? 0)) + projection.trustDelta, -100, 100);
  }
  if (updateSuspicion && listener.social) {
    listener.social.suspicionByPersonId ??= {};
    listener.social.suspicionByPersonId[speaker.id] = rounded((listener.social.suspicionByPersonId[speaker.id] ?? Math.max(0, -(listener.relations[speaker.id] ?? 0))) + projection.suspicionDelta, 0, 100);
  }
  if (updateRelations && projection.relationDelta !== 0) {
    speaker.relations[listener.id] = rounded((speaker.relations[listener.id] ?? 0) + projection.relationDelta, -100, 100);
    listener.relations[speaker.id] = rounded((listener.relations[speaker.id] ?? 0) + projection.relationDelta, -100, 100);
  }
  if (addMemories) {
    const listenerWeight = projection.honestyHint === "plain" ? 1 : projection.honestyHint === "foreign-will" || projection.honestyHint === "lie-risk" ? 4 : 2;
    addMemory(listener, world, projection.memoryText, listenerWeight, projection.tags);
    memoryTexts.push(projection.memoryText);
    if (projection.topic.kind === "relation" || projection.topic.kind === "condition" || projection.topic.kind === "quest") {
      const speakerMemory = `Talked with ${listener.name} about ${projection.topic.subject}`;
      addMemory(speaker, world, speakerMemory, projection.trustDelta >= 0 ? 1 : -1, projection.tags);
      memoryTexts.push(speakerMemory);
    }
  }
  if ((options.emitEvent ?? false) && projection.eventText) {
    const severity: ChronicleEvent["severity"] = projection.honestyHint === "foreign-will" || projection.honestyHint === "lie-risk" ? "medium" : "low";
    event(world, "relation", severity, projection.eventText, [speaker.id, listener.id], uniqueText([speaker.factionId, listener.factionId]), projection.topic.targetLocationId ?? speaker.locationId);
  }

  return {
    applied: true,
    speakerId: projection.speakerId,
    listenerId: projection.listenerId,
    trustDelta: updateTrust ? projection.trustDelta : 0,
    suspicionDelta: updateSuspicion ? projection.suspicionDelta : 0,
    relationDelta: updateRelations ? projection.relationDelta : 0,
    memoryTexts,
    eventText: options.emitEvent ? projection.eventText : undefined,
    tags: projection.tags
  };
}

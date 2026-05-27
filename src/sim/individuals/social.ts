import { event } from "../chronicle/events";
import { clamp, makeId } from "../core/math";
import type { Rng } from "../core/rng";
import type { DeceptionOutcome, DeceptionRecord, Id, Person, SocialIntent, SocialIntentKind, SocialMind, World } from "../types";

const intentText: Record<SocialIntentKind, string[]> = {
  survive: ["stay alive", "avoid needless danger", "keep out of the grave"],
  recover: ["recover strength", "find time to heal", "sleep without alarms"],
  protect: ["protect companions", "keep their people safe", "stand between danger and kin"],
  "gain-renown": ["be remembered", "win a name worth singing", "earn public glory"],
  "gain-wealth": ["get rich", "secure a private hoard", "turn danger into coin"],
  "learn-magic": ["understand forbidden workings", "master a difficult spell", "see what magic hides"],
  "master-craft": ["learn a legendary method", "perfect a difficult craft", "make something that lasts"],
  "seek-relic": ["find a named relic", "claim a birthright sign", "follow old artifact rumors"],
  avenge: ["settle an old hurt", "make a rival pay", "carry a grudge to its end"],
  romance: ["be seen by someone dear", "build a household", "risk tenderness"],
  "serve-society": ["serve their society", "uphold local custom", "make the elders approve"],
  "undermine-rival": ["weaken a rival quietly", "hide a knife in politics", "turn friends against a rival"],
  "hide-truth": ["keep a secret buried", "make the story sound harmless", "hide what really happened"],
  "obey-compulsion": ["obey a foreign will", "carry out a planted command", "move as something else desires"]
};

function personLabel(person: Person): string {
  return `${person.name} ${person.familyName}`;
}

function rememberSocial(person: Person, world: World, label: string, weight: number, tags: string[]): void {
  person.memories.unshift({
    id: makeId("memory", world.tick * 1000 + world.events.length + label.length + tags.length + person.memories.length),
    tick: world.tick,
    label,
    weight,
    tags
  });
  if (person.memories.length > 12) {
    person.memories.length = 12;
  }
}

function chooseAmbitionKind(person: Person, rng: Rng): SocialIntentKind {
  const weights: { value: SocialIntentKind; weight: number }[] = [
    { value: "survive", weight: 4 + person.traits.caution * 0.08 },
    { value: "protect", weight: 3 + person.traits.loyalty * 0.1 + person.traits.mercy * 0.04 },
    { value: "gain-renown", weight: 3 + person.traits.ambition * 0.1 + person.traits.bravery * 0.05 },
    { value: "gain-wealth", weight: 2 + person.traits.greed * 0.12 },
    { value: "learn-magic", weight: 1 + person.skills.sorcery * 0.08 + person.stats.derived.intelligence * 0.04 },
    { value: "master-craft", weight: 1 + person.skills.survival * 0.03 + person.stats.derived.wisdom * 0.03 },
    { value: "seek-relic", weight: 1.4 + person.traits.curiosity * 0.06 + person.identity.materialistSpiritualist * 0.02 },
    { value: "avenge", weight: 1 + person.traits.wrath * 0.11 },
    { value: "romance", weight: 1 + person.traits.loyalty * 0.03 + person.stats.derived.charisma * 0.03 },
    { value: "serve-society", weight: 2 + person.traits.loyalty * 0.08 + Math.max(0, -person.identity.authoritarianEgalitarian) * 0.04 },
    { value: "undermine-rival", weight: 0.8 + person.traits.ambition * 0.04 + person.traits.wrath * 0.04 }
  ];
  return rng.weighted(weights.map((item) => ({ ...item, weight: Math.max(0.1, item.weight) })));
}

function intentTags(kind: SocialIntentKind): string[] {
  if (kind === "recover" || kind === "survive") {
    return ["health", "self"];
  }
  if (kind === "protect" || kind === "serve-society" || kind === "romance") {
    return ["relation", "society"];
  }
  if (kind === "gain-wealth" || kind === "master-craft") {
    return ["economy"];
  }
  if (kind === "learn-magic" || kind === "seek-relic" || kind === "obey-compulsion") {
    return ["mystery", "magic"];
  }
  if (kind === "avenge" || kind === "undermine-rival") {
    return ["conflict", "secret"];
  }
  return ["renown"];
}

function makeIntent(person: Person, rng: Rng, kind: SocialIntentKind, tick: number, secrecy = 0): SocialIntent {
  return {
    id: makeId("intent", tick * 1000 + person.id.length + rng.int(0, 999)),
    kind,
    text: rng.pick(intentText[kind]),
    targetFactionId: person.factionId,
    targetLocationId: person.locationId,
    strength: clamp(rng.int(28, 70) + person.traits.ambition * 0.25 + (kind === "survive" ? person.traits.caution * 0.2 : 0), 1, 100),
    secrecy,
    createdTick: tick,
    tags: intentTags(kind)
  };
}

function makeAmbitions(person: Person, rng: Rng, tick: number): SocialIntent[] {
  const ambitions: SocialIntent[] = [];
  const seen = new Set<SocialIntentKind>();
  const count = rng.int(2, 3);
  for (let attempt = 0; ambitions.length < count && attempt < 8; attempt += 1) {
    const kind = chooseAmbitionKind(person, rng);
    if (seen.has(kind)) {
      continue;
    }
    seen.add(kind);
    ambitions.push(makeIntent(person, rng, kind, tick, 0));
  }
  if (ambitions.length === 0) {
    ambitions.push(makeIntent(person, rng, "survive", tick, 0));
  }
  return ambitions.sort((a, b) => b.strength - a.strength);
}

function declaredFromActual(person: Person, rng: Rng, actual: SocialIntent, tick: number): SocialIntent {
  if (actual.secrecy < 44 || rng.chance(0.58)) {
    return { ...actual, id: makeId("intent", tick * 1000 + person.id.length + rng.int(1000, 1999)), secrecy: 0 };
  }
  const cover = rng.weighted<SocialIntentKind>([
    { value: "serve-society", weight: 4 },
    { value: "protect", weight: 4 },
    { value: "survive", weight: 3 },
    { value: "recover", weight: 2 },
    { value: "gain-renown", weight: 1 }
  ]);
  return makeIntent(person, rng, cover, tick, 0);
}

export function makeSocialMind(person: Person, rng: Rng, tick = 0): SocialMind {
  const ambitions = makeAmbitions(person, rng, tick);
  const ambition = ambitions[0];
  const hiddenKind = person.traits.wrath > 70 || person.traits.greed > 74 || person.identity.corruptPure < -42 ? chooseAmbitionKind(person, rng) : undefined;
  const hiddenIntent = hiddenKind ? makeIntent(person, rng, hiddenKind === "protect" ? "hide-truth" : hiddenKind, tick, rng.int(48, 86)) : undefined;
  const currentIntent = hiddenIntent && hiddenIntent.strength > ambition.strength ? hiddenIntent : ambition;
  return {
    ambitions,
    ambition,
    currentIntent,
    declaredIntent: declaredFromActual(person, rng, currentIntent, tick),
    hiddenIntent,
    suspicionByPersonId: {},
    trustByPersonId: {},
    deceptionHistory: [],
    lastConversationTick: -999
  };
}

export function ensureSocialMind(person: Person, rng: Rng, tick = 0): SocialMind {
  person.social ??= makeSocialMind(person, rng, tick);
  person.social.suspicionByPersonId ??= {};
  person.social.trustByPersonId ??= {};
  person.social.deceptionHistory ??= [];
  person.social.lastConversationTick ??= -999;
  person.social.ambition ??= makeIntent(person, rng, chooseAmbitionKind(person, rng), tick, 0);
  person.social.ambitions = Array.isArray(person.social.ambitions) && person.social.ambitions.length > 0 ? person.social.ambitions : [person.social.ambition];
  person.social.ambitions = person.social.ambitions
    .filter((intent): intent is SocialIntent => Boolean(intent?.kind && intent.text))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
  if (person.social.ambitions.length === 0) {
    person.social.ambitions.push(person.social.ambition);
  }
  person.social.ambition = person.social.ambitions[0];
  person.social.currentIntent ??= person.social.ambition;
  person.social.declaredIntent ??= declaredFromActual(person, rng, person.social.currentIntent, tick);
  if (person.social.compulsion) {
    person.social.compulsion.detectedByPersonIds ??= [];
  }
  return person.social;
}

export function refreshSocialIntent(world: World, person: Person, rng: Rng): void {
  const mind = ensureSocialMind(person, rng, world.tick);
  if (mind.compulsion) {
    mind.compulsion.remainingTicks -= 1;
    mind.currentIntent = mind.compulsion.intent;
    if (mind.compulsion.remainingTicks <= 0) {
      delete mind.compulsion;
      mind.currentIntent = mind.hiddenIntent && mind.hiddenIntent.strength > mind.ambition.strength ? mind.hiddenIntent : mind.ambition;
    }
  } else if (person.hp < person.maxHp * 0.35 || person.fatigue > 78) {
    mind.currentIntent = makeIntent(person, rng, "recover", world.tick, 0);
  } else if (rng.chance(0.025)) {
    mind.currentIntent = makeIntent(person, rng, chooseAmbitionKind(person, rng), world.tick, rng.chance(0.18) ? rng.int(35, 72) : 0);
    if (mind.currentIntent.secrecy <= 42) {
      mind.ambitions.unshift(mind.currentIntent);
      mind.ambitions = mind.ambitions.sort((a, b) => b.strength - a.strength).slice(0, 4);
      mind.ambition = mind.ambitions[0];
    }
    if (mind.currentIntent.secrecy > 42) {
      mind.hiddenIntent = mind.currentIntent;
    }
  }
  mind.declaredIntent = declaredFromActual(person, rng, mind.currentIntent, world.tick);
}

function suspicionFor(listener: Person, speaker: Person, rng: Rng): number {
  const listenerMind = ensureSocialMind(listener, rng);
  const relation = listener.relations[speaker.id] ?? 0;
  return clamp((listenerMind.suspicionByPersonId[speaker.id] ?? 0) - relation * 0.18, -30, 100);
}

function pushDeceptionRecord(speaker: Person, listener: Person, record: DeceptionRecord): void {
  speaker.social?.deceptionHistory.unshift(record);
  listener.social?.deceptionHistory.unshift(record);
  if (speaker.social && speaker.social.deceptionHistory.length > 16) {
    speaker.social.deceptionHistory.length = 16;
  }
  if (listener.social && listener.social.deceptionHistory.length > 16) {
    listener.social.deceptionHistory.length = 16;
  }
}

export function attemptDeception(world: World, speaker: Person, listener: Person, rng: Rng, reason = "conversation"): DeceptionOutcome {
  const speakerMind = ensureSocialMind(speaker, rng, world.tick);
  const listenerMind = ensureSocialMind(listener, rng, world.tick);
  const hidden = speakerMind.hiddenIntent ?? (speakerMind.currentIntent.secrecy > 35 ? speakerMind.currentIntent : undefined);
  if (!hidden || speakerMind.declaredIntent.text === hidden.text) {
    listenerMind.trustByPersonId[speaker.id] = clamp((listenerMind.trustByPersonId[speaker.id] ?? 0) + 1, -100, 100);
    return "truth";
  }

  const trust = listenerMind.trustByPersonId[speaker.id] ?? Math.max(0, listener.relations[speaker.id] ?? 0);
  const liarScore =
    speaker.stats.derived.charisma * 0.75 +
    speaker.stats.derived.intelligence * 0.34 +
    speaker.skills.diplomacy * 0.55 +
    trust * 0.12;
  const suspicion = suspicionFor(listener, speaker, rng);
  const detectorScore =
    listener.stats.derived.perception * 0.78 +
    listener.stats.derived.wisdom * 0.42 +
    listener.stats.derived.intelligence * 0.28 +
    suspicion * 0.62;
  const lieRoll = liarScore + rng.int(-18, 18);
  const detectionRoll = detectorScore + rng.int(-16, 20);
  const margin = detectionRoll - lieRoll;
  const outcome: DeceptionOutcome = margin > 18 ? "caught" : margin > 2 ? "suspected" : "believed";
  const laterRealizationTick =
    outcome === "believed" && margin > -16 && rng.chance(0.18 + listener.stats.derived.wisdom / 260) ? world.tick + rng.int(2, 12) : undefined;
  const suspicionDelta = outcome === "caught" ? rng.int(18, 34) : outcome === "suspected" ? rng.int(8, 18) : -rng.int(1, 5);
  const trustDelta = outcome === "caught" ? -rng.int(8, 18) : outcome === "suspected" ? -rng.int(2, 8) : rng.int(0, 2);
  listenerMind.suspicionByPersonId[speaker.id] = clamp((listenerMind.suspicionByPersonId[speaker.id] ?? 0) + suspicionDelta, 0, 100);
  listenerMind.trustByPersonId[speaker.id] = clamp((listenerMind.trustByPersonId[speaker.id] ?? 0) + trustDelta, -100, 100);
  listener.relations[speaker.id] = clamp((listener.relations[speaker.id] ?? 0) - (outcome === "caught" ? rng.int(5, 14) : outcome === "suspected" ? rng.int(1, 5) : 0), -100, 100);
  speaker.relations[listener.id] = clamp((speaker.relations[listener.id] ?? 0) - (outcome === "caught" ? rng.int(1, 6) : 0), -100, 100);

  const record: DeceptionRecord = {
    id: makeId("lie", world.tick * 1000 + world.events.length + speaker.id.length + listener.id.length),
    tick: world.tick,
    speakerId: speaker.id,
    listenerId: listener.id,
    declaredText: speakerMind.declaredIntent.text,
    hiddenText: hidden.text,
    outcome,
    suspicionDelta,
    trustDelta,
    liarScore: Math.round(liarScore),
    detectorScore: Math.round(detectorScore),
    margin: Math.round(margin),
    reason,
    laterRealizationTick
  };
  pushDeceptionRecord(speaker, listener, record);
  rememberSocial(speaker, world, `Told ${listener.name} a ${outcome === "believed" ? "clean" : "risky"} lie about ${speakerMind.declaredIntent.text}`, outcome === "caught" ? -5 : 1, [
    "deception",
    reason
  ]);
  rememberSocial(listener, world, `${outcome === "caught" ? "Caught" : outcome === "suspected" ? "Doubted" : "Heard"} ${speaker.name}'s claim about ${speakerMind.declaredIntent.text}`, outcome === "caught" ? 5 : outcome === "suspected" ? 2 : 0, [
    "deception",
    reason
  ]);
  if (outcome === "caught") {
    listener.traits.caution = clamp(listener.traits.caution + 1, 0, 100);
    event(
      world,
      "relation",
      "medium",
      `${listener.name} ${listener.familyName} catches ${speaker.name} ${speaker.familyName} lying about wanting to ${speakerMind.declaredIntent.text}.`,
      [speaker.id, listener.id],
      [speaker.factionId, listener.factionId],
      listener.locationId
    );
  }
  return outcome;
}

export function resolveDelayedDeceptions(world: World, listener: Person, rng: Rng): DeceptionRecord[] {
  const mind = ensureSocialMind(listener, rng, world.tick);
  const realized: DeceptionRecord[] = [];
  for (const record of mind.deceptionHistory) {
    if (record.listenerId !== listener.id || record.outcome !== "believed" || record.realizedTick || !record.laterRealizationTick || record.laterRealizationTick > world.tick) {
      continue;
    }
    const scoreGap = (record.detectorScore ?? 50) - (record.liarScore ?? 50);
    const realizationChance = clamp(0.35 + scoreGap / 100, 0.2, 0.85);
    if (!rng.chance(realizationChance)) {
      record.laterRealizationTick = world.tick + rng.int(2, 8);
      continue;
    }

    const speaker = world.persons[record.speakerId];
    record.outcome = "realized-later";
    record.realizedTick = world.tick;
    const suspicionDelta = rng.int(8, 18);
    const trustDelta = -rng.int(4, 12);
    record.suspicionDelta += suspicionDelta;
    record.trustDelta = (record.trustDelta ?? 0) + trustDelta;
    mind.suspicionByPersonId[record.speakerId] = clamp((mind.suspicionByPersonId[record.speakerId] ?? 0) + suspicionDelta, 0, 100);
    mind.trustByPersonId[record.speakerId] = clamp((mind.trustByPersonId[record.speakerId] ?? 0) + trustDelta, -100, 100);
    if (speaker) {
      listener.relations[speaker.id] = clamp((listener.relations[speaker.id] ?? 0) - rng.int(3, 9), -100, 100);
      rememberSocial(listener, world, `Realized later that ${speaker.name}'s claim about ${record.declaredText} hid ${record.hiddenText}`, 4, [
        "deception",
        "realization"
      ]);
      event(
        world,
        "relation",
        "low",
        `${personLabel(listener)} realizes later that ${personLabel(speaker)} lied about wanting to ${record.declaredText}.`,
        [speaker.id, listener.id],
        [speaker.factionId, listener.factionId],
        listener.locationId
      );
    }
    realized.push(record);
  }
  return realized;
}

export function applyMindCompulsion(
  person: Person,
  rng: Rng,
  tick: number,
  sourceKind: "spell" | "relic" | "curse" | "authority" | "unknown",
  sourceId?: Id,
  durationTicks = 18
): void {
  const mind = ensureSocialMind(person, rng, tick);
  const intent = makeIntent(person, rng, "obey-compulsion", tick, 85);
  mind.compulsion = {
    sourceId,
    sourceKind,
    intent,
    strength: clamp(rng.int(42, 84) + person.stats.derived.wisdom * -0.12 + person.stats.core.willpower * -0.08, 10, 100),
    remainingTicks: durationTicks,
    detectedByPersonIds: []
  };
  mind.hiddenIntent = intent;
  mind.currentIntent = intent;
  mind.declaredIntent = makeIntent(person, rng, "serve-society", tick, 0);
}

export function tickSocialConversation(world: World, people: Person[], rng: Rng, locationId?: Id): void {
  const available = people.filter((person) => person.alive);
  if (available.length < 2) {
    return;
  }
  const speaker = rng.pick(available);
  const listeners = available.filter((person) => person.id !== speaker.id);
  const listener = rng.pick(listeners);
  refreshSocialIntent(world, speaker, rng);
  refreshSocialIntent(world, listener, rng);
  const speakerMind = ensureSocialMind(speaker, rng, world.tick);
  speakerMind.lastConversationTick = world.tick;
  const outcome = rng.chance(Math.max(0.06, speakerMind.currentIntent.secrecy / 120)) ? attemptDeception(world, speaker, listener, rng) : "truth";
  if (outcome === "truth") {
    const relationGain = rng.chance(0.55) ? 1 : 0;
    speaker.relations[listener.id] = clamp((speaker.relations[listener.id] ?? 0) + relationGain, -100, 100);
    listener.relations[speaker.id] = clamp((listener.relations[speaker.id] ?? 0) + relationGain, -100, 100);
    if (rng.chance(0.28)) {
      rememberSocial(listener, world, `${speaker.name} talked about wanting to ${speakerMind.declaredIntent.text}`, 1, ["conversation", ...speakerMind.declaredIntent.tags]);
    }
  }
  if (speakerMind.compulsion && !speakerMind.compulsion.detectedByPersonIds.includes(listener.id)) {
    const detection =
      listener.stats.derived.perception * 0.62 +
      listener.stats.derived.wisdom * 0.58 +
      listener.skills.ward * 0.28 +
      rng.int(-18, 20);
    if (detection > speakerMind.compulsion.strength + 18) {
      speakerMind.compulsion.detectedByPersonIds.push(listener.id);
      rememberSocial(listener, world, `Noticed a foreign pressure behind ${speaker.name}'s words`, 6, ["mind-control", "perception"]);
      event(
        world,
        "relation",
        "medium",
        `${listener.name} ${listener.familyName} notices something foreign moving behind ${speaker.name} ${speaker.familyName}'s intent.`,
        [speaker.id, listener.id],
        [speaker.factionId],
        locationId ?? listener.locationId
      );
    }
  }
}

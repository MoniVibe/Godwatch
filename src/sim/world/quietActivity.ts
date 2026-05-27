import { event } from "../chronicle/events";
import { average, clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type { Band, DecisionScore, OverworldTile, Person, World, WorldFeature } from "../types";
import { addMemory, livingMembers } from "../individuals/people";
import { ensureSocialMind, refreshSocialIntent, resolveDelayedDeceptions, tickSocialConversation } from "../individuals/social";

export const quietActivityAction = "Keep a quiet cadence";

export function isQuietActivityAction(action: string): boolean {
  return action === quietActivityAction;
}

export function quietActivityDecisionScore(world: World, band: Band): DecisionScore | undefined {
  const members = livingMembers(world, band);
  if (members.length === 0) {
    return undefined;
  }

  const leader = world.persons[band.leaderId] ?? members[0];
  const settlement = world.settlements[band.locationId];
  const health = average(members.map((member) => member.hp / member.maxHp));
  const fatigue = average(members.map((member) => member.fatigue));
  const morale = average(members.map((member) => member.morale));
  const localThreat = settlement?.threat ?? 30;
  const localQuestPressure = Object.values(world.quests).reduce((pressure, quest) => {
    if (quest.status !== "open" || quest.locationId !== band.locationId) {
      return pressure;
    }
    return Math.max(pressure, quest.danger * 0.35 + quest.urgency * 0.45);
  }, 0);
  const score =
    34 +
    morale * 0.08 +
    band.cohesion * 0.13 +
    (health > 0.72 ? 8 : 0) +
    (fatigue < 55 ? 8 : -8) +
    leader.identity.warlikePeaceful * 0.08 +
    leader.traits.caution * 0.08 +
    leader.traits.curiosity * 0.07 +
    Math.max(0, band.supplies - 24) * 0.12 +
    Math.max(0, 5 - members.length) * 3 -
    Math.max(0, localThreat - 45) * 0.55 -
    localQuestPressure * 0.12;

  return {
    action: quietActivityAction,
    score,
    reason: "low-pressure local life: roam, talk, forage, rest, and observe"
  };
}

function tileDistance(a: OverworldTile, b: OverworldTile): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
}

function surfaceTilesForBand(world: World, band: Band): OverworldTile[] {
  const settlement = world.settlements[band.travel?.originId ?? band.locationId];
  const sectorId = settlement?.sectorId;
  const sector = sectorId ? world.geography.sectors[sectorId] : undefined;
  const ids = sector?.tileIds ?? [];
  return ids.map((id) => world.geography.tiles[id]).filter((tile): tile is OverworldTile => Boolean(tile) && tile.layer === "surface");
}

function localPeopleForBand(world: World, band: Band): Person[] {
  const memberIds = new Set(band.memberIds);
  return Object.values(world.persons).filter((person) => person.alive && person.locationId === band.locationId && !memberIds.has(person.id));
}

function ensureBandTile(world: World, band: Band, rng: Rng): OverworldTile | undefined {
  const current = band.localTileId ? world.geography.tiles[band.localTileId] : undefined;
  if (current) {
    return current;
  }
  const candidates = surfaceTilesForBand(world, band);
  const tile = candidates.length ? rng.pick(candidates) : undefined;
  band.localTileId = tile?.id;
  band.localTileProgress = band.localTileProgress ?? rng.int(0, 80);
  return tile;
}

function nearbyTile(world: World, band: Band, current: OverworldTile, rng: Rng): OverworldTile {
  const candidates = surfaceTilesForBand(world, band).filter((tile) => tile.id !== current.id && tileDistance(tile, current) <= 1.2);
  if (candidates.length) {
    return rng.weighted(candidates.map((tile) => ({ value: tile, weight: Math.max(1, tile.passability - tile.danger * 0.35) })));
  }
  return current;
}

function moveQuietlyAcrossTiles(world: World, band: Band, members: Person[], rng: Rng): void {
  const current = ensureBandTile(world, band, rng);
  if (!current) {
    return;
  }
  const pace =
    (band.travel ? 18 : 8) +
    Math.floor(members.reduce((sum, member) => sum + member.stats.derived.dexterity + member.skills.survival * 0.4, 0) / Math.max(1, members.length) / 12);
  band.localTileProgress = clamp((band.localTileProgress ?? 0) + pace - current.danger * 0.08, 0, 120);
  if (band.localTileProgress < 100) {
    return;
  }
  const next = nearbyTile(world, band, current, rng);
  band.localTileId = next.id;
  band.localTileProgress = band.localTileProgress - 100;
  for (const member of members) {
    member.fatigue = clamp(member.fatigue + Math.max(0, next.danger - next.passability) / 90 + (band.travel ? 1 : 0), 0, 100);
  }
  if (rng.chance(0.035 + next.danger / 900)) {
    const witness = rng.pick(members);
    addMemory(witness, world, `Crossed ${next.terrain} ground while ${band.travel ? "on the road" : "roaming nearby"}`, 1, [
      "roaming",
      next.terrain,
      next.biomeId
    ]);
  }
}

function quietForage(world: World, band: Band, members: Person[], rng: Rng): void {
  const settlement = world.settlements[band.locationId];
  const tile = band.localTileId ? world.geography.tiles[band.localTileId] : undefined;
  const forageSkill = members.reduce((sum, member) => sum + member.skills.survival + member.stats.derived.wisdom * 0.3, 0) / Math.max(1, members.length);
  const chance = clamp(0.05 + forageSkill / 500 - (tile?.danger ?? settlement?.threat ?? 20) / 900, 0.02, 0.24);
  if (!rng.chance(chance)) {
    return;
  }
  const supplyGain = rng.int(1, 4);
  band.supplies = clamp(band.supplies + supplyGain, 0, 100);
  if (rng.chance(0.22)) {
    const finder = rng.pick(members);
    const resource = rng.pick(tile?.resourceHints?.length ? tile.resourceHints : settlement?.resources ?? ["clean water"]);
    addMemory(finder, world, `Found ${resource} while roaming`, 2, ["forage", "resource"]);
  }
}

function quietRest(members: Person[], rng: Rng): void {
  for (const member of members) {
    if (member.fatigue > 45 && rng.chance(0.38)) {
      member.fatigue = clamp(member.fatigue - rng.int(1, 4), 0, 100);
    }
    if (member.hp < member.maxHp && rng.chance(0.12 + member.skills.medicine / 700)) {
      member.hp = clamp(member.hp + 1, 0, member.maxHp);
    }
    if (member.mana < member.maxMana && rng.chance(0.16 + member.stats.derived.wisdom / 600)) {
      member.mana = clamp(member.mana + 1, 0, member.maxMana);
    }
  }
}

function localObservableFeatures(world: World, band: Band): WorldFeature[] {
  return Object.values(world.planet.features).filter(
    (feature) =>
      feature.nearestSettlementId === band.locationId &&
      feature.status !== "hidden" &&
      feature.status !== "depleted" &&
      feature.exploration < 100
  );
}

function quietObserve(world: World, band: Band, members: Person[], rng: Rng, active: boolean): void {
  if (band.travel) {
    return;
  }
  const settlement = world.settlements[band.locationId];
  if (!settlement) {
    return;
  }

  const observer = rng.weighted(
    members.map((member) => ({
      value: member,
      weight: 4 + member.stats.derived.perception + member.traits.caution * 0.35 + member.skills.survival * 0.25
    }))
  );
  const features = localObservableFeatures(world, band);
  if (features.length > 0 && rng.chance(active ? 0.56 : 0.1)) {
    const feature = rng.weighted(features.map((candidate) => ({ value: candidate, weight: 8 + candidate.danger * 0.1 + Math.max(0, 70 - candidate.exploration) * 0.12 })));
    const before = feature.exploration;
    feature.exploration = clamp(feature.exploration + rng.int(1, active ? 5 : 2) + Math.floor(observer.stats.derived.perception / 46), 0, 100);
    const crossedClaim = before < 42 && feature.exploration >= 42;
    const crossedMapped = before < 100 && feature.exploration >= 100;
    band.goal = `watching ${feature.name}`;
    if (!crossedClaim && !crossedMapped) {
      return;
    }
    addMemory(observer, world, `Understood a quiet pattern in ${feature.name}`, crossedMapped ? 5 : 3, ["quiet", "observe", feature.layer, feature.kind]);
    event(
      world,
      "world",
      crossedMapped ? "medium" : "low",
      `${observer.name} ${observer.familyName} watches ${feature.name} long enough for ${band.name} to understand its ${feature.layer} approaches.`,
      [observer.id],
      [settlement.factionId],
      settlement.id
    );
    return;
  }

  if (!active && !rng.chance(0.12)) {
    return;
  }
  const oldThreat = settlement.threat;
  const oldUnrest = settlement.unrest;
  if (settlement.threat > 35 && rng.chance(active ? 0.58 : 0.28)) {
    settlement.threat = clamp(settlement.threat - 1, 0, 100);
  }
  if (settlement.unrest > 35 && rng.chance(active ? 0.5 : 0.22)) {
    settlement.unrest = clamp(settlement.unrest - 1, 0, 100);
  }
  band.goal = `watching small troubles in ${settlement.name}`;
  if ((oldThreat >= 50 && settlement.threat < 50) || (oldUnrest >= 50 && settlement.unrest < 50)) {
    addMemory(observer, world, `Helped ${settlement.name} breathe easier by noticing small troubles`, 3, ["quiet", "observe", "settlement"]);
    event(world, "world", "low", `${observer.name} ${observer.familyName} notices small trouble early; ${settlement.name} grows calmer.`, [observer.id], [settlement.factionId], settlement.id);
  }
}

function maybeMeaningfulQuietEvent(world: World, band: Band, members: Person[], rng: Rng, active: boolean): void {
  if (!rng.chance(active ? 0.05 : 0.018)) {
    return;
  }
  const unsettled = members
    .map((member) => ({ member, mind: ensureSocialMind(member, rng, world.tick) }))
    .filter(({ mind }) => mind.hiddenIntent || mind.compulsion || Object.values(mind.suspicionByPersonId).some((value) => value > 55));
  if (unsettled.length === 0) {
    return;
  }
  const { member, mind } = rng.pick(unsettled);
  if (mind.compulsion) {
    event(
      world,
      "relation",
      "low",
      `${member.name} ${member.familyName} grows quiet in ${band.name}; their words do not quite match their eyes.`,
      [member.id],
      [member.factionId],
      band.locationId
    );
    return;
  }
  if (mind.hiddenIntent) {
    event(
      world,
      "relation",
      "low",
      `${member.name} ${member.familyName} keeps circling back to ${mind.declaredIntent.text}, though the others sense something unsaid.`,
      [member.id],
      [member.factionId],
      band.locationId
    );
  }
}

export function updateQuietBandActivity(world: World, band: Band, rng: Rng, options: { active?: boolean } = {}): void {
  const members = livingMembers(world, band);
  if (members.length === 0) {
    return;
  }
  const active = Boolean(options.active);
  for (const member of members) {
    refreshSocialIntent(world, member, rng);
    resolveDelayedDeceptions(world, member, rng);
  }
  moveQuietlyAcrossTiles(world, band, members, rng);
  if (!band.travel) {
    const settlement = world.settlements[band.locationId];
    if (active && settlement) {
      band.goal = `keeping a quiet cadence near ${settlement.name}`;
    }
    quietRest(members, rng);
    quietForage(world, band, members, rng);
    quietObserve(world, band, members, rng, active);
  }
  if (rng.chance(active ? 0.78 : band.travel ? 0.18 : 0.34)) {
    const people = active && !band.travel ? [...members, ...localPeopleForBand(world, band).slice(0, 4)] : members;
    tickSocialConversation(world, people, rng, band.locationId);
  }
  maybeMeaningfulQuietEvent(world, band, members, rng, active);
}

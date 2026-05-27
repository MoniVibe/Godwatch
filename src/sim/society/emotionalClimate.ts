import { average, clamp } from "../core/math";
import { deriveLoyaltyState, derivePersonEmotionalState, moodKindForScores, moraleStateForScore } from "../individuals/moods";
import type { Band, EmotionalGroupKind, GroupEmotionalClimate, Id, Organization, Person, World } from "../types";

export interface GroupEmotionalClimateOptions {
  tick?: number;
  cohesion?: number;
  dominantDriverLimit?: number;
  atRiskLimit?: number;
}

function rounded(value: number, min: number, max: number): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function dominantDrivers(members: readonly Person[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    const state = member.emotionalState ?? derivePersonEmotionalState(member);
    for (const driver of state.drivers) {
      counts.set(driver, (counts.get(driver) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([driver]) => driver);
}

function atRiskPersonIds(members: readonly Person[], limit: number): Id[] {
  return members
    .map((person) => ({ person, state: person.emotionalState ?? derivePersonEmotionalState(person) }))
    .filter(({ state }) => state.stress.stress >= 72 || state.stress.resolve <= 28 || ["compelled", "despairing", "wounded"].includes(state.mood))
    .sort((left, right) => right.state.stress.pressure - left.state.stress.pressure || left.person.id.localeCompare(right.person.id))
    .slice(0, limit)
    .map(({ person }) => person.id);
}

function groupMood(
  averageValence: number,
  averageStress: number,
  averageResolve: number,
  averageMorale: number,
  conflictPressure: number,
  compelledShare: number
): GroupEmotionalClimate["mood"] {
  return moodKindForScores({
    valence: averageValence,
    stress: Math.max(averageStress, conflictPressure * 0.85),
    resolve: averageResolve,
    arousal: Math.max(averageStress, conflictPressure),
    morale: averageMorale,
    compelled: compelledShare >= 0.25,
    wounded: false,
    grieving: averageValence < -25 && averageStress > 55,
    fatigued: averageStress > 66 && averageResolve < 48
  });
}

function emptyClimate(groupKind: EmotionalGroupKind, groupId: Id, tick: number, cohesion: number): GroupEmotionalClimate {
  return {
    groupKind,
    groupId,
    memberCount: 0,
    mood: "steady",
    moraleState: "steady",
    averageValence: 0,
    averageStress: 0,
    averageResolve: 0,
    averageMorale: 0,
    cohesion,
    conflictPressure: 0,
    dominantDrivers: [],
    atRiskPersonIds: [],
    updatedTick: tick,
    tags: ["emotional-climate", groupKind, "empty"]
  };
}

export function summarizeGroupEmotionalClimate(
  groupKind: EmotionalGroupKind,
  groupId: Id,
  members: readonly Person[],
  world: World,
  options: GroupEmotionalClimateOptions = {}
): GroupEmotionalClimate {
  const living = members.filter((person) => person.alive);
  const tick = options.tick ?? world.tick;
  const cohesion = rounded(options.cohesion ?? 50, 0, 100);
  if (living.length === 0) {
    return emptyClimate(groupKind, groupId, tick, cohesion);
  }

  const states = living.map((person) => person.emotionalState ?? derivePersonEmotionalState(person, { tick }));
  const loyalties = living.map((person) => person.loyalty ?? deriveLoyaltyState(person, world, { tick }));
  const averageValence = rounded(average(states.map((state) => state.valence)), -100, 100);
  const averageStress = rounded(average(states.map((state) => state.stress.stress)), 0, 100);
  const averageResolve = rounded(average(states.map((state) => state.stress.resolve)), 0, 100);
  const averageMorale = rounded(average(living.map((person) => person.morale)), 0, 100);
  const conflictPressure = rounded(average(loyalties.map((loyalty) => loyalty.pressure)) * 0.72 + Math.max(...loyalties.map((loyalty) => loyalty.pressure)) * 0.28, 0, 100);
  const drivers = dominantDrivers(living, options.dominantDriverLimit ?? 6);
  const atRisk = atRiskPersonIds(living, options.atRiskLimit ?? 6);
  const compelledShare = states.filter((state) => state.mood === "compelled").length / living.length;
  const mood = groupMood(averageValence, averageStress, averageResolve, averageMorale, conflictPressure, compelledShare);
  const moraleState = moraleStateForScore(rounded(averageMorale * 0.78 + cohesion * 0.22 - conflictPressure * 0.18, 0, 100));

  return {
    groupKind,
    groupId,
    memberCount: living.length,
    mood,
    moraleState,
    averageValence,
    averageStress,
    averageResolve,
    averageMorale,
    cohesion,
    conflictPressure,
    dominantDrivers: drivers,
    atRiskPersonIds: atRisk,
    updatedTick: tick,
    tags: ["emotional-climate", groupKind, mood, moraleState, conflictPressure >= 56 ? "conflicted" : "settled"].filter((tag) => tag.length > 0)
  };
}

function peopleForIds(world: World, memberIds: readonly Id[]): Person[] {
  return memberIds.map((id) => world.persons[id]).filter((person): person is Person => Boolean(person));
}

export function summarizeBandEmotionalClimate(world: World, band: Band, options: GroupEmotionalClimateOptions = {}): GroupEmotionalClimate {
  return summarizeGroupEmotionalClimate("band", band.id, peopleForIds(world, band.memberIds), world, { ...options, cohesion: options.cohesion ?? band.cohesion });
}

export function summarizeOrganizationEmotionalClimate(world: World, organization: Organization, options: GroupEmotionalClimateOptions = {}): GroupEmotionalClimate {
  return summarizeGroupEmotionalClimate("organization", organization.id, peopleForIds(world, organization.memberIds), world, {
    ...options,
    cohesion: options.cohesion ?? organization.outlook.cohesion
  });
}

export function updateBandEmotionalClimate(world: World, band: Band, options: GroupEmotionalClimateOptions = {}): GroupEmotionalClimate {
  const climate = summarizeBandEmotionalClimate(world, band, options);
  band.emotionalClimate = climate;
  return climate;
}

export function updateOrganizationEmotionalClimate(world: World, organization: Organization, options: GroupEmotionalClimateOptions = {}): GroupEmotionalClimate {
  const climate = summarizeOrganizationEmotionalClimate(world, organization, options);
  organization.outlook.emotionalClimate = climate;
  return climate;
}

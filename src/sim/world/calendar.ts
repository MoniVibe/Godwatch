import { average, clamp } from "../core/math";
import type { CultureState, Faction, Id, QuestKind, SeasonKind, Settlement, SpecialWorldEventKind, WeatherFront, World, WorldPhaseKind } from "../types";
import type { QuestNeedKind, QuestNeedProposal, QuestNeedSourceKind } from "./questNeeds";

export type CalendarMoonPhase = "new" | "waxing" | "full" | "waning" | "blood";
export type CalendarPeriodId =
  | "dawnseed"
  | "rainmoot"
  | "greenreach"
  | "sunspear"
  | "emberwane"
  | "dustbell"
  | "harvestmere"
  | "mistfall"
  | "ancestor"
  | "frostgate"
  | "longnight"
  | "thawmarch";

export type CalendarWindowKind =
  | "blood-moon-watch"
  | "high-feast"
  | "resource-bloom-watch"
  | "summoning-watch"
  | "culture-festival"
  | "pilgrimage"
  | "market-fair"
  | "memorial-day"
  | "coronation-day"
  | "succession-day"
  | "weather-omen"
  | "world-phase-omen";

export interface CalendarPeriodDefinition {
  id: CalendarPeriodId;
  name: string;
  season: SeasonKind;
  tags: string[];
}

export interface CalendarSnapshot {
  tick: number;
  day: number;
  ticksPerDay: number;
  year: number;
  dayOfYear: number;
  yearLengthDays: number;
  periodIndex: number;
  periodId: CalendarPeriodId;
  periodName: string;
  dayOfPeriod: number;
  periodLengthDays: number;
  season: SeasonKind;
  weatherSeason: SeasonKind;
  phase: WorldPhaseKind;
  hardMode: boolean;
  moonCycleDay: number;
  moonPhase: CalendarMoonPhase;
  daysUntilBloodMoon: number;
  activeSpecialEventIds: Id[];
  tags: string[];
}

export type DayPhase = "dawn" | "day" | "dusk" | "night";

export interface WorldClockSnapshot {
  tick: number;
  day: number;
  tickInDay: number;
  hour: number;
  minute: number;
  timeLabel: string;
  dayLabel: string;
  phase: DayPhase;
  phaseLabel: string;
  dayProgress: number;
  hourProgress: number;
  ticksPerHour: number;
  ticksPerDay: number;
  minutesPerTick: number;
}

export interface CalendarWindow {
  id: Id;
  signature: string;
  kind: CalendarWindowKind;
  name: string;
  summary: string;
  day: number;
  startDay: number;
  peakDay: number;
  endDay: number;
  daysUntilStart: number;
  daysUntilPeak: number;
  active: boolean;
  intensity: number;
  pressure: number;
  urgency: number;
  priority: number;
  season: SeasonKind;
  phase: WorldPhaseKind;
  cultureId?: Id;
  factionId?: Id;
  locationId?: Id;
  weatherFrontId?: Id;
  specialEventId?: Id;
  eventKind?: SpecialWorldEventKind;
  questKind?: QuestKind;
  needKind?: QuestNeedKind;
  sourceKind?: QuestNeedSourceKind;
  sourceId?: Id;
  tags: string[];
}

export interface CalendarEventScheduleHint {
  id: Id;
  kind: SpecialWorldEventKind;
  name: string;
  dueDay: number;
  daysUntil: number;
  shouldSchedule: boolean;
  intensity: number;
  locationId?: Id;
  reason: string;
  tags: string[];
}

export interface CalendarWindowOptions {
  ticksPerDay?: number;
  horizonDays?: number;
  minPressure?: number;
  maxWindows?: number;
  includeCultureWindows?: boolean;
  includeFactionWindows?: boolean;
  includeWeatherOmens?: boolean;
  includeWorldEventWindows?: boolean;
}

export interface CalendarQuestOptions extends CalendarWindowOptions {
  maxProposals?: number;
  maxPerLocation?: number;
  allowExistingQuestDuplicates?: boolean;
  existingSignatures?: readonly string[];
}

export interface CalendarSnapshotOptions {
  ticksPerDay?: number;
}

interface CalendarOccurrence {
  startDay: number;
  peakDay: number;
  endDay: number;
  daysUntilStart: number;
  daysUntilPeak: number;
  active: boolean;
}

interface CalendarWindowDraft {
  kind: CalendarWindowKind;
  name: string;
  summary: string;
  occurrence: CalendarOccurrence;
  intensity: number;
  pressure: number;
  season?: SeasonKind;
  phase?: WorldPhaseKind;
  cultureId?: Id;
  factionId?: Id;
  locationId?: Id;
  weatherFrontId?: Id;
  specialEventId?: Id;
  eventKind?: SpecialWorldEventKind;
  questKind?: QuestKind;
  needKind?: QuestNeedKind;
  sourceKind?: QuestNeedSourceKind;
  sourceId?: Id;
  tags: string[];
}

export const TICKS_PER_HOUR = 15;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;
export const MINUTES_PER_TICK = 60 / TICKS_PER_HOUR;
const dayStartHour = 6;
const defaultTicksPerDay = TICKS_PER_DAY;
const periodLengthDays = 30;
const moonCycleDays = 28;
const eventHorizonDays = 7;
const yearLengthDays = 360;

export const calendarPeriods: CalendarPeriodDefinition[] = [
  { id: "dawnseed", name: "Dawnseed", season: "spring", tags: ["planting", "oaths"] },
  { id: "rainmoot", name: "Rainmoot", season: "spring", tags: ["rain", "roads"] },
  { id: "greenreach", name: "Greenreach", season: "spring", tags: ["growth", "pilgrimage"] },
  { id: "sunspear", name: "Sunspear", season: "summer", tags: ["heat", "war"] },
  { id: "emberwane", name: "Emberwane", season: "summer", tags: ["craft", "market"] },
  { id: "dustbell", name: "Dustbell", season: "summer", tags: ["drought", "watch"] },
  { id: "harvestmere", name: "Harvestmere", season: "autumn", tags: ["harvest", "trade"] },
  { id: "mistfall", name: "Mistfall", season: "autumn", tags: ["mist", "omens"] },
  { id: "ancestor", name: "Ancestor", season: "autumn", tags: ["memory", "grave"] },
  { id: "frostgate", name: "Frostgate", season: "winter", tags: ["snow", "ward"] },
  { id: "longnight", name: "Longnight", season: "winter", tags: ["night", "spirits"] },
  { id: "thawmarch", name: "Thawmarch", season: "winter", tags: ["thaw", "travel"] }
];

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

function boundedTick(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function clockPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 18) return "day";
  if (hour >= 18 && hour < 20) return "dusk";
  return "night";
}

function padTime(value: number): string {
  return value.toString().padStart(2, "0");
}

export function dayForTick(tick: number, ticksPerDay = TICKS_PER_DAY): number {
  return Math.floor(boundedTick(tick) / Math.max(1, Math.floor(ticksPerDay))) + 1;
}

export function tickInDayFor(tick: number, ticksPerDay = TICKS_PER_DAY): number {
  const dayLength = Math.max(1, Math.floor(ticksPerDay));
  return ((boundedTick(tick) % dayLength) + dayLength) % dayLength;
}

export function deriveWorldClock(
  tick: number,
  options: { day?: number; ticksPerDay?: number; ticksPerHour?: number } = {}
): WorldClockSnapshot {
  const ticksPerHour = Math.max(1, Math.floor(options.ticksPerHour ?? TICKS_PER_HOUR));
  const ticksPerDay = Math.max(ticksPerHour, Math.floor(options.ticksPerDay ?? TICKS_PER_DAY));
  const minutesPerTick = 60 / ticksPerHour;
  const currentTick = boundedTick(tick);
  const tickInDay = tickInDayFor(currentTick, ticksPerDay);
  const rawHour = Math.floor(tickInDay / ticksPerHour) % HOURS_PER_DAY;
  const tickInHour = tickInDay % ticksPerHour;
  const hour = (rawHour + dayStartHour) % HOURS_PER_DAY;
  const minute = Math.floor(tickInHour * minutesPerTick);
  const phase = clockPhase(hour);
  const timeLabel = `${padTime(hour)}:${padTime(minute)}`;
  const day = Math.max(1, Math.floor(options.day ?? dayForTick(currentTick, ticksPerDay)));
  return {
    tick: currentTick,
    day,
    tickInDay,
    hour,
    minute,
    timeLabel,
    dayLabel: `Day ${day}`,
    phase,
    phaseLabel: phase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    dayProgress: tickInDay / ticksPerDay,
    hourProgress: tickInHour / ticksPerHour,
    ticksPerHour,
    ticksPerDay,
    minutesPerTick
  };
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function periodForDay(dayOfYear: number): { period: CalendarPeriodDefinition; index: number; dayOfPeriod: number } {
  const index = clamp(Math.floor((dayOfYear - 1) / periodLengthDays), 0, calendarPeriods.length - 1);
  return {
    period: calendarPeriods[index],
    index,
    dayOfPeriod: ((dayOfYear - 1) % periodLengthDays) + 1
  };
}

function moonPhaseForDay(moonCycleDay: number, phase: WorldPhaseKind): CalendarMoonPhase {
  if (phase === "blood-moon" || moonCycleDay === moonCycleDays) return "blood";
  if (moonCycleDay <= 3) return "new";
  if (moonCycleDay <= 13) return "waxing";
  if (moonCycleDay <= 16) return "full";
  return "waning";
}

function daysUntilPeriodicPeak(day: number, cycleDays: number): number {
  const remainder = day % cycleDays;
  return remainder === 0 ? 0 : cycleDays - remainder;
}

function periodicOccurrence(day: number, cycleDays: number, radiusDays: number): CalendarOccurrence {
  const remainder = day % cycleDays;
  const daysSince = remainder === 0 ? 0 : remainder;
  const daysUntil = daysUntilPeriodicPeak(day, cycleDays);
  const peakDay = daysSince <= radiusDays ? day - daysSince : day + daysUntil;
  const startDay = peakDay - radiusDays;
  const endDay = peakDay + radiusDays;
  return {
    startDay,
    peakDay,
    endDay,
    daysUntilStart: Math.max(0, startDay - day),
    daysUntilPeak: Math.max(0, peakDay - day),
    active: day >= startDay && day <= endDay
  };
}

function annualOccurrence(day: number, targetDayOfYear: number, radiusDays: number): CalendarOccurrence {
  const year = Math.floor((Math.max(1, day) - 1) / yearLengthDays) + 1;
  const peaks = [year - 1, year, year + 1]
    .filter((candidateYear) => candidateYear >= 1)
    .map((candidateYear) => (candidateYear - 1) * yearLengthDays + targetDayOfYear)
    .sort((left, right) => left - right);
  const activePeak = peaks.find((peak) => day >= peak - radiusDays && day <= peak + radiusDays);
  const peakDay = activePeak ?? peaks.find((peak) => peak - radiusDays >= day) ?? peaks[peaks.length - 1];
  const startDay = peakDay - radiusDays;
  const endDay = peakDay + radiusDays;
  return {
    startDay,
    peakDay,
    endDay,
    daysUntilStart: Math.max(0, startDay - day),
    daysUntilPeak: Math.max(0, peakDay - day),
    active: day >= startDay && day <= endDay
  };
}

function fixedOccurrence(day: number, startDay: number, peakDay: number, endDay: number): CalendarOccurrence {
  return {
    startDay,
    peakDay,
    endDay,
    daysUntilStart: Math.max(0, startDay - day),
    daysUntilPeak: Math.max(0, peakDay - day),
    active: day >= startDay && day <= endDay
  };
}

function activeSpecialEvents(world: World) {
  return Object.values(world.specialEvents ?? {}).filter((state) => state.remainingTicks > 0).sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
}

export function deriveCalendarSnapshot(world: World, options: CalendarSnapshotOptions = {}): CalendarSnapshot {
  const ticksPerDay = options.ticksPerDay ?? defaultTicksPerDay;
  const day = Math.max(1, world.day || dayForTick(world.tick, ticksPerDay));
  const dayOfYear = ((day - 1) % yearLengthDays) + 1;
  const year = Math.floor((day - 1) / yearLengthDays) + 1;
  const periodState = periodForDay(dayOfYear);
  const phase = world.worldPhase?.current ?? "normal";
  const moonCycleDay = ((day - 1) % moonCycleDays) + 1;
  const events = activeSpecialEvents(world);
  const tags = uniqueText([
    periodState.period.id,
    periodState.period.season,
    phase,
    ...(world.worldPhase?.tags ?? []),
    ...periodState.period.tags,
    ...events.flatMap((state) => state.tags)
  ]);
  return {
    tick: world.tick,
    day,
    ticksPerDay,
    year,
    dayOfYear,
    yearLengthDays,
    periodIndex: periodState.index,
    periodId: periodState.period.id,
    periodName: periodState.period.name,
    dayOfPeriod: periodState.dayOfPeriod,
    periodLengthDays,
    season: periodState.period.season,
    weatherSeason: world.weather?.season ?? periodState.period.season,
    phase,
    hardMode: Boolean(world.worldPhase?.hardMode),
    moonCycleDay,
    moonPhase: moonPhaseForDay(moonCycleDay, phase),
    daysUntilBloodMoon: daysUntilPeriodicPeak(day, moonCycleDays),
    activeSpecialEventIds: events.map((state) => state.id),
    tags
  };
}

function settlementSort(left: Settlement, right: Settlement): number {
  return right.population - left.population || right.prosperity - left.prosperity || left.id.localeCompare(right.id);
}

function settlementsForFaction(world: World, factionId: Id): Settlement[] {
  return Object.values(world.settlements)
    .filter((settlement) => settlement.factionId === factionId)
    .sort(settlementSort);
}

function settlementForFaction(world: World, faction: Faction | undefined): Settlement | undefined {
  if (!faction) return undefined;
  return world.settlements[faction.capitalId] ?? settlementsForFaction(world, faction.id)[0];
}

function settlementForCulture(world: World, culture: CultureState): Settlement | undefined {
  const society = world.factions[culture.societyId] ?? Object.values(world.factions).find((faction) => faction.cultureId === culture.id);
  return settlementForFaction(world, society);
}

function highestThreatSettlement(world: World): Settlement | undefined {
  return Object.values(world.settlements).sort((left, right) => right.threat + right.unrest * 0.4 - (left.threat + left.unrest * 0.4) || settlementSort(left, right))[0];
}

function weatherFrontLocation(world: World, front: WeatherFront): Settlement | undefined {
  return Object.values(world.settlements)
    .filter((settlement) => settlement.mediumRegionId === front.regionId)
    .sort((left, right) => right.threat + right.unrest - (left.threat + left.unrest) || settlementSort(left, right))[0];
}

function axis(culture: CultureState | undefined, key: keyof CultureState["values"]): number {
  return culture?.values[key] ?? 0;
}

function activeEventOfKind(world: World, kind: SpecialWorldEventKind) {
  return activeSpecialEvents(world).find((state) => state.kind === kind);
}

function makeWindow(snapshot: CalendarSnapshot, draft: CalendarWindowDraft): CalendarWindow {
  const pressure = rounded(draft.pressure + (draft.occurrence.active ? 10 : 0) - draft.occurrence.daysUntilStart * 0.9, 0, 140);
  const intensity = rounded(draft.intensity, 1, 100);
  const urgency = rounded((draft.occurrence.active ? 40 : 24) + pressure * 0.72 + intensity * 0.18 - draft.occurrence.daysUntilPeak * 1.4, 0, 150);
  const priority = rounded(pressure + urgency * 0.22 + intensity * 0.2 + (draft.occurrence.active ? 16 : 0), 0, 200);
  const signature = [
    "calendar",
    draft.kind,
    draft.cultureId ?? "",
    draft.factionId ?? "",
    draft.locationId ?? "",
    draft.weatherFrontId ?? draft.specialEventId ?? "",
    draft.eventKind ?? "",
    draft.occurrence.peakDay
  ].join(":");
  return {
    id: stableId("calendar-window", [signature]),
    signature,
    kind: draft.kind,
    name: draft.name,
    summary: draft.summary,
    day: snapshot.day,
    startDay: draft.occurrence.startDay,
    peakDay: draft.occurrence.peakDay,
    endDay: draft.occurrence.endDay,
    daysUntilStart: draft.occurrence.daysUntilStart,
    daysUntilPeak: draft.occurrence.daysUntilPeak,
    active: draft.occurrence.active,
    intensity,
    pressure,
    urgency,
    priority,
    season: draft.season ?? snapshot.season,
    phase: draft.phase ?? snapshot.phase,
    cultureId: draft.cultureId,
    factionId: draft.factionId,
    locationId: draft.locationId,
    weatherFrontId: draft.weatherFrontId,
    specialEventId: draft.specialEventId,
    eventKind: draft.eventKind,
    questKind: draft.questKind,
    needKind: draft.needKind,
    sourceKind: draft.sourceKind,
    sourceId: draft.sourceId,
    tags: uniqueText(["calendar", draft.kind, draft.season ?? snapshot.season, draft.phase ?? snapshot.phase, ...draft.tags]).slice(0, 20)
  };
}

function worldCadenceWindows(world: World, snapshot: CalendarSnapshot): CalendarWindow[] {
  const windows: CalendarWindow[] = [];
  const threatSettlement = highestThreatSettlement(world);
  const holidayEvent = activeEventOfKind(world, "holiday");
  const bloodMoonEvent = activeEventOfKind(world, "blood-moon");
  const resourceEvent = activeEventOfKind(world, "resource-bloom");
  const summoningEvent = activeEventOfKind(world, "summoning-window");
  const gravePressure = world.encounterPressure?.gravebreak ?? 0;
  const summoningPressure = world.encounterPressure?.summoning ?? 0;
  const resourcePressure = world.encounterPressure?.["resource-guardian"] ?? 0;
  const settlementUnrest = average(Object.values(world.settlements).map((settlement) => settlement.unrest));
  const settlementProsperity = average(Object.values(world.settlements).map((settlement) => settlement.prosperity));

  windows.push(
    makeWindow(snapshot, {
      kind: "blood-moon-watch",
      name: "Blood Moon Watch",
      summary: "The lunar cadence is near a blood moon. Wardens, gravekeepers, and nervous villages have a reason to prepare before night pressure becomes an incident.",
      occurrence: periodicOccurrence(snapshot.day, 28, 1),
      intensity: 54 + gravePressure * 0.3 + (snapshot.phase === "blood-moon" ? 22 : 0),
      pressure: 40 + gravePressure * 0.34 + (snapshot.phase === "blood-moon" ? 26 : 0),
      locationId: bloodMoonEvent?.locationId ?? threatSettlement?.id,
      factionId: threatSettlement?.factionId,
      specialEventId: bloodMoonEvent?.id,
      eventKind: "blood-moon",
      questKind: "defense",
      needKind: "organization-wardens",
      sourceKind: "settlement",
      sourceId: bloodMoonEvent?.locationId ?? threatSettlement?.id,
      tags: ["moon", "undead", "grave", "watch"]
    })
  );

  const feastSettlement = Object.values(world.settlements).sort((left, right) => right.population + right.prosperity - (left.population + left.prosperity) || left.id.localeCompare(right.id))[0];
  windows.push(
    makeWindow(snapshot, {
      kind: "high-feast",
      name: "High Feast",
      summary: "A shared feast day approaches. Crowds, stored food, and public vows can become a festival, market, or political pressure point depending on local unrest.",
      occurrence: periodicOccurrence(snapshot.day, 45, 2),
      intensity: 38 + settlementProsperity * 0.28 + (snapshot.phase === "holiday" ? 22 : 0),
      pressure: 30 + settlementUnrest * 0.24 + (snapshot.phase === "holiday" ? 20 : 0),
      locationId: holidayEvent?.locationId ?? feastSettlement?.id,
      factionId: feastSettlement?.factionId,
      specialEventId: holidayEvent?.id,
      eventKind: "holiday",
      questKind: settlementUnrest >= 45 ? "politics" : "escort",
      needKind: settlementUnrest >= 45 ? "organization-mediation" : "organization-supplies",
      sourceKind: "settlement",
      sourceId: holidayEvent?.locationId ?? feastSettlement?.id,
      tags: ["holiday", "festival", "crowd", "trade"]
    })
  );

  windows.push(
    makeWindow(snapshot, {
      kind: "resource-bloom-watch",
      name: "Aether Bloom Watch",
      summary: "A resource bloom cadence is close. Prospectors, guilds, and wardens may compete to secure strange material before guardians or rivals arrive.",
      occurrence: periodicOccurrence(snapshot.day, 37, 1),
      intensity: 44 + resourcePressure * 0.28 + (snapshot.phase === "aether-surge" ? 16 : 0),
      pressure: 28 + resourcePressure * 0.38 + (resourceEvent ? 18 : 0),
      locationId: resourceEvent?.locationId ?? threatSettlement?.id,
      factionId: threatSettlement?.factionId,
      specialEventId: resourceEvent?.id,
      eventKind: "resource-bloom",
      questKind: "delve",
      needKind: "organization-survey",
      sourceKind: "settlement",
      sourceId: resourceEvent?.locationId ?? threatSettlement?.id,
      tags: ["aether", "resource", "prospecting", "guild"]
    })
  );

  windows.push(
    makeWindow(snapshot, {
      kind: "summoning-watch",
      name: "Summoning Window",
      summary: "The ritual calendar is near a thin place. Cults, wardens, and ambitious mages have stronger reasons to open, seal, or exploit a summoning route.",
      occurrence: periodicOccurrence(snapshot.day, 63, 1),
      intensity: 46 + summoningPressure * 0.34 + (snapshot.phase === "aether-surge" ? 12 : 0),
      pressure: 32 + summoningPressure * 0.42 + (summoningEvent ? 20 : 0),
      locationId: summoningEvent?.locationId ?? threatSettlement?.id,
      factionId: threatSettlement?.factionId,
      specialEventId: summoningEvent?.id,
      eventKind: "summoning-window",
      questKind: "delve",
      needKind: "organization-wardens",
      sourceKind: "settlement",
      sourceId: summoningEvent?.locationId ?? threatSettlement?.id,
      tags: ["ritual", "summon", "ward", "aether"]
    })
  );

  return windows;
}

function cultureWindows(world: World, snapshot: CalendarSnapshot): CalendarWindow[] {
  const windows: CalendarWindow[] = [];
  for (const culture of Object.values(world.cultures).sort((left, right) => left.id.localeCompare(right.id))) {
    const faction = world.factions[culture.societyId] ?? Object.values(world.factions).find((candidate) => candidate.cultureId === culture.id);
    const settlement = settlementForCulture(world, culture);
    if (!faction || !settlement) {
      continue;
    }
    const anchor = (stableCode(culture.id) % yearLengthDays) + 1;
    const tradition = culture.tradition;
    const cohesion = culture.cohesion;
    const spiritual = axis(culture, "materialistSpiritualist");
    const peaceful = axis(culture, "warlikePeaceful");
    const vengeful = -axis(culture, "vengefulForgiving");
    const materialist = -spiritual;
    const unresolvedRemains = Object.values(world.remains ?? {}).filter((remains) => remains.cultureId === culture.id && remains.burialStatus !== "buried").length;

    windows.push(
      makeWindow(snapshot, {
        kind: "culture-festival",
        name: `${culture.name} Festival`,
        summary: `${culture.name} has a customary festival window. It can create public cohesion, oath-taking, marriage, adoption, or crowd-control pressure.`,
        occurrence: annualOccurrence(snapshot.day, anchor, 2),
        intensity: 26 + tradition * 0.42 + cohesion * 0.28 + culture.level * 2,
        pressure: 24 + Math.max(0, 55 - cohesion) * 0.2 + tradition * 0.2,
        cultureId: culture.id,
        factionId: faction.id,
        locationId: settlement.id,
        questKind: cohesion < 44 || settlement.unrest > 48 ? "politics" : "escort",
        needKind: cohesion < 44 || settlement.unrest > 48 ? "organization-mediation" : "organization-supplies",
        sourceKind: "settlement",
        sourceId: settlement.id,
        tags: ["culture", "festival", "tradition", ...culture.completedPracticeIds.slice(0, 3)]
      })
    );

    if (spiritual >= 12 || faction.kind === "cult" || culture.completedPracticeIds.includes("ward-letters")) {
      windows.push(
        makeWindow(snapshot, {
          kind: "pilgrimage",
          name: `${culture.name} Pilgrimage`,
          summary: `${culture.name} has enough spiritual or ward practice to support pilgrimage pressure. Escorts, holy people, and rival claimants may care about the route.`,
          occurrence: annualOccurrence(snapshot.day, ((anchor + 69 - 1) % yearLengthDays) + 1, 2),
          intensity: 30 + Math.max(0, spiritual) * 0.38 + tradition * 0.28 + culture.level * 2,
          pressure: 26 + Math.max(0, spiritual) * 0.28 + settlement.threat * 0.16,
          cultureId: culture.id,
          factionId: faction.id,
          locationId: settlement.id,
          questKind: "escort",
          needKind: "organization-escorts",
          sourceKind: "settlement",
          sourceId: settlement.id,
          tags: ["culture", "pilgrimage", "holy", "route"]
        })
      );
    }

    if (materialist >= 10 || faction.kind === "guild" || culture.completedPracticeIds.includes("grain-ledgers")) {
      windows.push(
        makeWindow(snapshot, {
          kind: "market-fair",
          name: `${culture.name} Market Fair`,
          summary: `${culture.name} has commercial pressure for a market fair. Caravan escorts, trade mediation, and supply contracts are more likely to matter.`,
          occurrence: annualOccurrence(snapshot.day, ((anchor + 137 - 1) % yearLengthDays) + 1, 2),
          intensity: 28 + Math.max(0, materialist) * 0.34 + faction.wealth * 0.26 + settlement.prosperity * 0.18,
          pressure: 24 + settlement.threat * 0.16 + Math.max(0, -average(Object.values(faction.relations))) * 0.08,
          cultureId: culture.id,
          factionId: faction.id,
          locationId: settlement.id,
          questKind: "escort",
          needKind: "organization-escorts",
          sourceKind: "settlement",
          sourceId: settlement.id,
          tags: ["culture", "market", "trade", "guild"]
        })
      );
    }

    if (unresolvedRemains > 0 || vengeful >= 10 || peaceful < -18 || faction.activeWars.length > 0) {
      windows.push(
        makeWindow(snapshot, {
          kind: "memorial-day",
          name: `${culture.name} Memorial Day`,
          summary: `${culture.name} has a memorial cadence. Unburied dead, war memory, and vengeance pressure can become burial, cleansing, or reconciliation work.`,
          occurrence: annualOccurrence(snapshot.day, ((anchor + 251 - 1) % yearLengthDays) + 1, 2),
          intensity: 26 + tradition * 0.3 + unresolvedRemains * 5 + Math.max(0, vengeful) * 0.2,
          pressure: 24 + unresolvedRemains * 7 + faction.activeWars.length * 8 + Math.max(0, -peaceful) * 0.16,
          cultureId: culture.id,
          factionId: faction.id,
          locationId: settlement.id,
          questKind: unresolvedRemains > 0 ? "delve" : "politics",
          needKind: unresolvedRemains > 0 ? "organization-wardens" : "organization-mediation",
          sourceKind: "settlement",
          sourceId: settlement.id,
          tags: ["culture", "memorial", "grave", "legacy"]
        })
      );
    }
  }
  return windows;
}

function factionWindows(world: World, snapshot: CalendarSnapshot): CalendarWindow[] {
  const windows: CalendarWindow[] = [];
  const successionCrises = Object.values(world.story.crises ?? {}).filter((crisis) => crisis.status === "active" && crisis.kind === "succession");
  for (const faction of Object.values(world.factions).sort((left, right) => left.id.localeCompare(right.id))) {
    const settlement = settlementForFaction(world, faction);
    if (!settlement) {
      continue;
    }
    const crisis = successionCrises.find((candidate) => candidate.factionId === faction.id);
    const unstable = faction.stability < 38 || settlement.unrest >= 58 || Boolean(crisis);
    const anchor = ((stableCode(`${faction.id}:crown`) % yearLengthDays) + 1 + 180) % yearLengthDays || yearLengthDays;
    windows.push(
      makeWindow(snapshot, {
        kind: unstable ? "succession-day" : "coronation-day",
        name: unstable ? `${faction.name} Succession Day` : `${faction.name} Oath Day`,
        summary: unstable
          ? `${faction.name} has succession pressure around its public oath day. Claimants, guilds, dynasties, and rivals may try to force terms.`
          : `${faction.name} has an oath day where authority is performed publicly. It is a useful hook for coronations, vows, charters, and legitimacy checks.`,
        occurrence: annualOccurrence(snapshot.day, anchor, 1),
        intensity: unstable ? 46 + Math.max(0, 55 - faction.stability) * 0.5 + settlement.unrest * 0.22 : 28 + faction.stability * 0.32,
        pressure: unstable ? 34 + Math.max(0, 52 - faction.stability) * 0.56 + settlement.unrest * 0.3 : 18 + Math.max(0, 45 - faction.stability) * 0.18,
        cultureId: faction.cultureId,
        factionId: faction.id,
        locationId: settlement.id,
        questKind: "politics",
        needKind: unstable ? "organization-mediation" : "organization-charter",
        sourceKind: "settlement",
        sourceId: settlement.id,
        tags: ["faction", unstable ? "succession" : "coronation", faction.kind, "legitimacy"]
      })
    );
  }
  return windows;
}

function weatherOmenWindows(world: World, snapshot: CalendarSnapshot): CalendarWindow[] {
  const omenKinds = new Set(["storm", "ashfall", "aether-wind", "snow", "heatwave", "fog"]);
  const windows: CalendarWindow[] = [];
  for (const front of Object.values(world.weather?.fronts ?? {}).sort((left, right) => left.id.localeCompare(right.id))) {
    if (!omenKinds.has(front.kind)) {
      continue;
    }
    const settlement = weatherFrontLocation(world, front) ?? highestThreatSettlement(world);
    const durationDays = Math.max(1, Math.ceil(front.remainingTicks / snapshot.ticksPerDay));
    const occult = front.kind === "ashfall" || front.kind === "aether-wind";
    windows.push(
      makeWindow(snapshot, {
        kind: "weather-omen",
        name: `${front.kind.replace("-", " ")} omen`,
        summary: `A ${front.kind.replace("-", " ")} front is active. Travel, harvest, warding, and creature behavior can be treated as calendar pressure while it lingers.`,
        occurrence: fixedOccurrence(snapshot.day, snapshot.day, snapshot.day, snapshot.day + durationDays),
        intensity: front.intensity,
        pressure: 24 + front.intensity * 0.48 + Math.max(0, front.threatModifier) * 2.6 + (settlement?.threat ?? 0) * 0.1,
        locationId: settlement?.id,
        factionId: settlement?.factionId,
        weatherFrontId: front.id,
        questKind: occult ? "delve" : "escort",
        needKind: occult ? "organization-wardens" : "organization-supplies",
        sourceKind: "settlement",
        sourceId: settlement?.id,
        tags: ["weather", "omen", front.kind, ...front.tags]
      })
    );
  }
  return windows;
}

function worldEventWindows(world: World, snapshot: CalendarSnapshot): CalendarWindow[] {
  const windows: CalendarWindow[] = [];
  for (const state of activeSpecialEvents(world)) {
    const settlement = state.locationId ? world.settlements[state.locationId] : highestThreatSettlement(world);
    const remainingDays = Math.max(1, Math.ceil(state.remainingTicks / snapshot.ticksPerDay));
    const questKind: QuestKind = state.kind === "holiday" ? "politics" : state.kind === "blood-moon" ? "defense" : "delve";
    const needKind: QuestNeedKind = state.kind === "holiday" ? "organization-supplies" : state.kind === "resource-bloom" ? "organization-survey" : "organization-wardens";
    windows.push(
      makeWindow(snapshot, {
        kind: "world-phase-omen",
        name: state.name,
        summary: `${state.name} is already active. This read model exposes it as calendar pressure without applying additional consequences.`,
        occurrence: fixedOccurrence(snapshot.day, snapshot.day, snapshot.day, snapshot.day + remainingDays),
        intensity: state.intensity,
        pressure: 32 + state.intensity * 0.54,
        phase: state.phase,
        locationId: state.locationId ?? settlement?.id,
        factionId: settlement?.factionId,
        specialEventId: state.id,
        eventKind: state.kind,
        questKind,
        needKind,
        sourceKind: "settlement",
        sourceId: state.locationId ?? settlement?.id,
        tags: ["world-event", state.kind, ...state.tags]
      })
    );
  }
  if (snapshot.hardMode) {
    const settlement = highestThreatSettlement(world);
    windows.push(
      makeWindow(snapshot, {
        kind: "world-phase-omen",
        name: "Hard Mode Age",
        summary: "The world is in hard mode. This is persistent calendar context for harsher rituals, rarer resources, and stronger boss pressure.",
        occurrence: fixedOccurrence(snapshot.day, snapshot.day, snapshot.day, snapshot.day + eventHorizonDays),
        intensity: 86,
        pressure: 54 + (world.encounterPressure?.boss ?? 0) * 0.3,
        phase: "hard-mode",
        locationId: settlement?.id,
        factionId: settlement?.factionId,
        eventKind: "hard-mode-transition",
        questKind: "defense",
        needKind: "organization-wardens",
        sourceKind: "settlement",
        sourceId: settlement?.id,
        tags: ["world-phase", "hard-mode", "boss", "rare-resource"]
      })
    );
  }
  return windows;
}

function sortedWindows(windows: readonly CalendarWindow[]): CalendarWindow[] {
  return [...windows].sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      right.priority - left.priority ||
      left.daysUntilStart - right.daysUntilStart ||
      left.kind.localeCompare(right.kind) ||
      left.signature.localeCompare(right.signature)
  );
}

export function deriveCalendarWindows(world: World, options: CalendarWindowOptions = {}): CalendarWindow[] {
  const snapshot = deriveCalendarSnapshot(world, options);
  const horizonDays = options.horizonDays ?? eventHorizonDays;
  const minPressure = options.minPressure ?? 28;
  const maxWindows = options.maxWindows ?? 24;
  const candidates = [
    ...worldCadenceWindows(world, snapshot),
    ...(options.includeCultureWindows ?? true ? cultureWindows(world, snapshot) : []),
    ...(options.includeFactionWindows ?? true ? factionWindows(world, snapshot) : []),
    ...(options.includeWeatherOmens ?? true ? weatherOmenWindows(world, snapshot) : []),
    ...(options.includeWorldEventWindows ?? true ? worldEventWindows(world, snapshot) : [])
  ];
  const seen = new Set<string>();
  const windows: CalendarWindow[] = [];
  for (const window of sortedWindows(candidates)) {
    if (windows.length >= maxWindows || seen.has(window.signature)) {
      continue;
    }
    if (!window.active && window.daysUntilStart > horizonDays) {
      continue;
    }
    if (window.pressure < minPressure) {
      continue;
    }
    seen.add(window.signature);
    windows.push(window);
  }
  return windows;
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

function titleForWindow(window: CalendarWindow): string {
  if (window.kind === "blood-moon-watch") return `Prepare ${window.name}`;
  if (window.kind === "high-feast") return `Provision ${window.name}`;
  if (window.kind === "resource-bloom-watch") return `Survey ${window.name}`;
  if (window.kind === "summoning-watch") return `Ward ${window.name}`;
  if (window.kind === "culture-festival") return `Keep ${window.name}`;
  if (window.kind === "pilgrimage") return `Escort ${window.name}`;
  if (window.kind === "market-fair") return `Secure ${window.name}`;
  if (window.kind === "memorial-day") return `Honor ${window.name}`;
  if (window.kind === "succession-day") return `Mediate ${window.name}`;
  if (window.kind === "coronation-day") return `Witness ${window.name}`;
  if (window.kind === "weather-omen") return `Answer ${window.name}`;
  return `Respond to ${window.name}`;
}

export function calendarWindowToQuestProposal(world: World, window: CalendarWindow): QuestNeedProposal | undefined {
  if (!window.questKind || !window.needKind || !window.locationId || !window.factionId || !world.settlements[window.locationId] || !world.factions[window.factionId]) {
    return undefined;
  }
  const danger = rounded(10 + window.pressure * 0.38 + window.intensity * 0.24, 10, 98);
  const urgency = rounded(window.urgency + (window.active ? 10 : 0), 20, 150);
  const priority = rounded(window.priority, 0, 200);
  return {
    signature: window.signature,
    needKind: window.needKind,
    title: titleForWindow(window),
    kind: window.questKind,
    issuerFactionId: window.factionId,
    locationId: window.locationId,
    danger,
    rewardGold: Math.ceil(danger * 1.5 + window.pressure * 0.35),
    rewardRenown: Math.ceil(danger / 10 + window.intensity / 34),
    urgency,
    priority,
    summary: window.summary,
    sourceKind: window.sourceKind ?? "settlement",
    sourceId: window.sourceId ?? window.locationId,
    tags: uniqueText([...window.tags, `calendar:${window.kind}`, window.cultureId ? `culture:${window.cultureId}` : undefined, window.eventKind]).slice(0, 20)
  };
}

export function proposeCalendarQuestNeeds(world: World, options: CalendarQuestOptions = {}): QuestNeedProposal[] {
  const maxProposals = options.maxProposals ?? 8;
  const maxPerLocation = options.maxPerLocation ?? 2;
  const seen = new Set(options.existingSignatures ?? []);
  const perLocation = new Map<Id, number>();
  const proposals: QuestNeedProposal[] = [];

  for (const window of deriveCalendarWindows(world, options)) {
    if (proposals.length >= maxProposals || seen.has(window.signature)) {
      continue;
    }
    const proposal = calendarWindowToQuestProposal(world, window);
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

function eventHintName(kind: SpecialWorldEventKind): string {
  if (kind === "blood-moon") return "Blood Moon";
  if (kind === "holiday") return "High Feast";
  if (kind === "resource-bloom") return "Aether Bloom";
  if (kind === "summoning-window") return "Summoning Window";
  if (kind === "boss-stirring") return "Boss Stirring";
  return "World Wound Opens";
}

function eventHintCycle(kind: SpecialWorldEventKind): number | undefined {
  if (kind === "blood-moon") return 28;
  if (kind === "holiday") return 45;
  if (kind === "resource-bloom") return 37;
  if (kind === "summoning-window") return 63;
  return undefined;
}

export function deriveCalendarEventScheduleHints(world: World, options: CalendarSnapshotOptions = {}): CalendarEventScheduleHint[] {
  const snapshot = deriveCalendarSnapshot(world, options);
  const activeKinds = new Set(activeSpecialEvents(world).map((state) => state.kind));
  const settlement = highestThreatSettlement(world);
  const kinds: SpecialWorldEventKind[] = ["blood-moon", "holiday", "resource-bloom", "summoning-window"];
  const hints: CalendarEventScheduleHint[] = kinds.map((kind) => {
    const cycle = eventHintCycle(kind) ?? 1;
    const daysUntil = daysUntilPeriodicPeak(snapshot.day, cycle);
    const dueDay = snapshot.day + daysUntil;
    return {
      id: stableId("calendar-event-hint", [kind, String(dueDay)]),
      kind,
      name: eventHintName(kind),
      dueDay,
      daysUntil,
      shouldSchedule: daysUntil === 0 && !activeKinds.has(kind),
      intensity: kind === "blood-moon" ? 74 : kind === "summoning-window" ? 60 : kind === "resource-bloom" ? 52 : 45,
      locationId: settlement?.id,
      reason: `${eventHintName(kind)} is ${daysUntil === 0 ? "due now" : `due in ${daysUntil} days`} by calendar cadence.`,
      tags: uniqueText(["calendar-schedule", kind, kind === "blood-moon" ? "moon" : undefined, kind === "holiday" ? "festival" : undefined])
    };
  });

  if (!snapshot.hardMode) {
    const daysUntilHardMode = Math.max(0, 120 - snapshot.day);
    hints.push({
      id: stableId("calendar-event-hint", ["hard-mode-transition", String(120)]),
      kind: "hard-mode-transition",
      name: eventHintName("hard-mode-transition"),
      dueDay: Math.max(snapshot.day, 120),
      daysUntil: daysUntilHardMode,
      shouldSchedule: daysUntilHardMode === 0 && !activeKinds.has("hard-mode-transition"),
      intensity: 86,
      locationId: settlement?.id,
      reason: daysUntilHardMode === 0 ? "The world is old enough for a hard-mode transition check." : `The hard-mode transition threshold is ${daysUntilHardMode} days away.`,
      tags: ["calendar-schedule", "hard-mode", "boss", "phase"]
    });
  }

  return hints.sort((left, right) => left.daysUntil - right.daysUntil || left.kind.localeCompare(right.kind));
}

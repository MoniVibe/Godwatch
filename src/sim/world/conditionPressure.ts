import { clamp } from "../core/math";
import { computeAugmentationEffects, deriveInjuryBurden } from "../individuals/augmentations";
import type { AugmentationRecord, CreatureCategory, EncounterKind, Id, InjuryRecord, Person, QuestKind, World } from "../types";
import type { QuestNeedKind, QuestNeedProposal } from "./questNeeds";

export type ConditionPressureKind =
  | "urgent-care"
  | "prosthetic-fitting"
  | "augmentation-maintenance"
  | "ritual-cleansing"
  | "contagion-watch"
  | "blood-scent";

export type ConditionPressureSourceKind = "injury" | "scar" | "augmentation" | "status" | "mixed";

export interface ConditionPressureSignal {
  id: Id;
  signature: string;
  kind: ConditionPressureKind;
  sourceKinds: ConditionPressureSourceKind[];
  personId: Id;
  personName: string;
  factionId: Id;
  locationId: Id;
  subject: string;
  pressure: number;
  danger: number;
  urgency: number;
  priority: number;
  questKind?: QuestKind;
  encounterKind?: EncounterKind;
  encounterCategory?: CreatureCategory;
  encounterDelta?: number;
  injuryIds: Id[];
  scarIds: Id[];
  augmentationIds: Id[];
  statuses: string[];
  drivers: string[];
  tags: string[];
  summary: string;
}

export interface ConditionPressureOptions {
  minPressure?: number;
  maxSignals?: number;
  maxPerPerson?: number;
  includeQuestSignals?: boolean;
  includeEncounterSignals?: boolean;
  includeStableScars?: boolean;
}

export interface ConditionPressureQuestOptions extends ConditionPressureOptions {
  allowExistingQuestDuplicates?: boolean;
  existingSignatures?: readonly string[];
  maxProposals?: number;
  maxPerLocation?: number;
}

export interface ApplyConditionEncounterPressureOptions extends ConditionPressureOptions {
  maxDeltaPerKind?: number;
}

interface StatusProfile {
  kind: ConditionPressureKind;
  pressure: number;
  danger: number;
  sourceKind: ConditionPressureSourceKind;
  questKind?: QuestKind;
  encounterKind?: EncounterKind;
  encounterCategory?: CreatureCategory;
  tags: string[];
}

interface SignalDraft {
  kind: ConditionPressureKind;
  sourceKinds: ConditionPressureSourceKind[];
  subject: string;
  pressure: number;
  danger: number;
  questKind?: QuestKind;
  encounterKind?: EncounterKind;
  encounterCategory?: CreatureCategory;
  encounterDelta?: number;
  injuryIds?: readonly Id[];
  scarIds?: readonly Id[];
  augmentationIds?: readonly Id[];
  statuses?: readonly string[];
  drivers?: readonly string[];
  tags?: readonly string[];
  summary: string;
}

const defaultMinPressure = 36;
const defaultMaxSignals = 12;
const defaultMaxPerPerson = 2;
const defaultMaxProposals = 8;
const defaultMaxPerLocation = 3;
const defaultMaxDeltaPerKind = 34;

const supportableLoci = new Set(["eye", "jaw", "arm", "hand", "spine", "leg", "foot"]);

const statusProfiles: Record<string, StatusProfile> = {
  bleeding: { kind: "urgent-care", pressure: 28, danger: 18, sourceKind: "status", questKind: "escort", tags: ["medicine", "bleeding"] },
  wounded: { kind: "urgent-care", pressure: 22, danger: 14, sourceKind: "status", questKind: "escort", tags: ["medicine", "wound"] },
  poisoned: { kind: "urgent-care", pressure: 34, danger: 22, sourceKind: "status", questKind: "escort", tags: ["medicine", "poison"] },
  fever: { kind: "contagion-watch", pressure: 30, danger: 16, sourceKind: "status", questKind: "escort", tags: ["medicine", "fever"] },
  plague: { kind: "contagion-watch", pressure: 48, danger: 28, sourceKind: "status", questKind: "escort", tags: ["medicine", "plague"] },
  infected: { kind: "contagion-watch", pressure: 34, danger: 18, sourceKind: "status", questKind: "escort", tags: ["medicine", "infection"] },
  cursed: {
    kind: "ritual-cleansing",
    pressure: 42,
    danger: 28,
    sourceKind: "status",
    questKind: "delve",
    encounterKind: "summoning",
    encounterCategory: "otherworldly",
    tags: ["ward", "curse"]
  },
  haunted: {
    kind: "ritual-cleansing",
    pressure: 44,
    danger: 30,
    sourceKind: "status",
    questKind: "delve",
    encounterKind: "gravebreak",
    encounterCategory: "undead",
    tags: ["ward", "haunting"]
  },
  possessed: {
    kind: "ritual-cleansing",
    pressure: 52,
    danger: 34,
    sourceKind: "status",
    questKind: "delve",
    encounterKind: "summoning",
    encounterCategory: "demon",
    tags: ["ward", "possession"]
  },
  compelled: {
    kind: "ritual-cleansing",
    pressure: 34,
    danger: 20,
    sourceKind: "status",
    questKind: "politics",
    encounterKind: "summoning",
    encounterCategory: "summon",
    tags: ["mind-control", "ward"]
  },
  "augmentation-low-power": {
    kind: "augmentation-maintenance",
    pressure: 28,
    danger: 12,
    sourceKind: "status",
    questKind: "escort",
    encounterKind: "resource-guardian",
    encounterCategory: "construct",
    tags: ["augmentation", "power"]
  },
  "augmentation-strain": { kind: "augmentation-maintenance", pressure: 22, danger: 10, sourceKind: "status", questKind: "escort", tags: ["augmentation", "strain"] },
  "augmentation-rejection": { kind: "urgent-care", pressure: 42, danger: 24, sourceKind: "status", questKind: "escort", tags: ["augmentation", "rejection"] },
  "augmentation-maintenance": { kind: "augmentation-maintenance", pressure: 34, danger: 14, sourceKind: "status", questKind: "escort", tags: ["augmentation", "maintenance"] }
};

const conditionNeedKind: Record<ConditionPressureKind, QuestNeedKind> = {
  "urgent-care": "organization-supplies",
  "prosthetic-fitting": "organization-repair",
  "augmentation-maintenance": "organization-repair",
  "ritual-cleansing": "organization-wardens",
  "contagion-watch": "organization-supplies",
  "blood-scent": "clear-fauna"
};

function stableTextCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return code;
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function personName(person: Person): string {
  return `${person.name} ${person.familyName}`.trim();
}

function rounded(value: number, min = 0, max = 100): number {
  return clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
}

function conditionScale(augmentation: AugmentationRecord): number {
  return augmentation.maxCondition > 0 ? clamp(augmentation.condition / augmentation.maxCondition, 0, 1) : 0;
}

function activeReplacementIds(person: Person): Set<Id> {
  return new Set(
    (person.augmentations ?? [])
      .filter((augmentation) => augmentation.active && augmentation.condition > 0)
      .flatMap((augmentation) => augmentation.replacedInjuryIds ?? [])
  );
}

function profileStatuses(person: Person, kind?: ConditionPressureKind): { profiles: StatusProfile[]; statuses: string[]; pressure: number; danger: number; tags: string[] } {
  const statuses: string[] = [];
  const profiles: StatusProfile[] = [];
  for (const status of person.status ?? []) {
    const profile = statusProfiles[status];
    if (!profile || (kind && profile.kind !== kind)) {
      continue;
    }
    statuses.push(status);
    profiles.push(profile);
  }
  return {
    profiles,
    statuses,
    pressure: profiles.reduce((sum, profile) => sum + profile.pressure, 0),
    danger: profiles.reduce((sum, profile) => sum + profile.danger, 0),
    tags: uniqueText(profiles.flatMap((profile) => profile.tags))
  };
}

function sortedSignals(signals: readonly ConditionPressureSignal[]): ConditionPressureSignal[] {
  return [...signals].sort(
    (left, right) =>
      right.priority - left.priority ||
      right.pressure - left.pressure ||
      right.danger - left.danger ||
      left.kind.localeCompare(right.kind) ||
      left.personId.localeCompare(right.personId) ||
      left.signature.localeCompare(right.signature)
  );
}

function signalAllowed(signal: ConditionPressureSignal, options: ConditionPressureOptions): boolean {
  const includeQuest = options.includeQuestSignals ?? true;
  const includeEncounter = options.includeEncounterSignals ?? true;
  return (includeQuest && Boolean(signal.questKind)) || (includeEncounter && Boolean(signal.encounterKind));
}

function createSignal(person: Person, draft: SignalDraft): ConditionPressureSignal {
  const pressure = rounded(draft.pressure);
  const danger = rounded(draft.danger, 1, 100);
  const urgency = rounded(24 + pressure * 0.92 + danger * 0.2, 10, 130);
  const priority = rounded(pressure + danger * 0.3 + urgency * 0.12, 0, 180);
  const tags = uniqueText(["condition-pressure", draft.kind, ...draft.sourceKinds, ...(draft.tags ?? [])]).slice(0, 18);
  const drivers = uniqueText(draft.drivers ?? []).slice(0, 12);
  const statuses = uniqueText(draft.statuses ?? []).slice(0, 10);
  const driverKey = uniqueText([...drivers, ...statuses, ...(draft.injuryIds ?? []), ...(draft.scarIds ?? []), ...(draft.augmentationIds ?? [])]).join("|");
  const signature = ["condition-pressure", draft.kind, person.id, person.locationId, stableTextCode(`${draft.subject}:${driverKey}`).toString(36)].join(":");
  return {
    id: `condition-${stableTextCode(signature).toString(36)}`,
    signature,
    kind: draft.kind,
    sourceKinds: uniqueText(draft.sourceKinds) as ConditionPressureSourceKind[],
    personId: person.id,
    personName: personName(person),
    factionId: person.factionId,
    locationId: person.locationId,
    subject: draft.subject,
    pressure,
    danger,
    urgency,
    priority,
    questKind: draft.questKind,
    encounterKind: draft.encounterKind,
    encounterCategory: draft.encounterCategory,
    encounterDelta: draft.encounterDelta ? rounded(draft.encounterDelta, 0, 100) : undefined,
    injuryIds: uniqueText(draft.injuryIds ?? []),
    scarIds: uniqueText(draft.scarIds ?? []),
    augmentationIds: uniqueText(draft.augmentationIds ?? []),
    statuses,
    drivers,
    tags,
    summary: draft.summary
  };
}

function severeInjuries(person: Person): InjuryRecord[] {
  return (person.injuries ?? []).filter((injury) => injury.severity === "severe" || injury.severity === "critical" || injury.severity === "maiming");
}

function careSignal(person: Person): ConditionPressureSignal | undefined {
  const burden = deriveInjuryBurden(person);
  const status = profileStatuses(person);
  const injuries = severeInjuries(person);
  const careProfiles = profileStatuses(person, "urgent-care");
  const pressure = burden.burden * 0.82 + careProfiles.pressure + injuries.length * 7 + (person.hp <= Math.max(1, person.maxHp * 0.25) ? 12 : 0);
  if (pressure < 30) {
    return undefined;
  }
  const subject = `${personName(person)}'s wounds`;
  return createSignal(person, {
    kind: careProfiles.statuses.includes("augmentation-rejection") ? "urgent-care" : burden.severity === "minor" && careProfiles.statuses.length === 0 ? "urgent-care" : "urgent-care",
    sourceKinds: uniqueText(["injury", ...(careProfiles.statuses.length > 0 ? ["status"] : [])]) as ConditionPressureSourceKind[],
    subject,
    pressure,
    danger: burden.pain * 0.34 + burden.mobilityPenalty * 0.22 + careProfiles.danger + injuries.length * 6,
    questKind: "escort",
    injuryIds: injuries.map((injury) => injury.id),
    statuses: careProfiles.statuses,
    drivers: [...burden.reasons, ...careProfiles.statuses.map((item) => `status:${item}`)],
    tags: ["medicine", "triage", burden.severity, ...burden.tags, ...status.tags],
    summary: `${subject} create care pressure: ${burden.reasons.slice(0, 3).join(", ") || "body strain"}. A healer, apothecary, or safe escort could keep the condition from becoming a local story.`
  });
}

function prostheticSignal(person: Person): ConditionPressureSignal | undefined {
  const replacements = activeReplacementIds(person);
  const unsupported = (person.injuries ?? []).filter(
    (injury) => supportableLoci.has(injury.locus) && !replacements.has(injury.id) && (injury.permanent || injury.severity === "maiming" || injury.severity === "critical")
  );
  if (unsupported.length === 0) {
    return undefined;
  }
  const worst = [...unsupported].sort((left, right) => right.burden - left.burden || left.locus.localeCompare(right.locus))[0];
  const burden = deriveInjuryBurden(person);
  const pressure = Math.max(...unsupported.map((injury) => injury.burden)) * 0.78 + unsupported.length * 10 + burden.mobilityPenalty * 0.32;
  return createSignal(person, {
    kind: "prosthetic-fitting",
    sourceKinds: ["injury"],
    subject: `${personName(person)}'s ${worst.locus}`,
    pressure,
    danger: burden.mobilityPenalty * 0.28 + burden.pain * 0.2 + unsupported.length * 8,
    questKind: "escort",
    injuryIds: unsupported.map((injury) => injury.id),
    drivers: unsupported.map((injury) => `${injury.severity}:${injury.locus}`),
    tags: ["medicine", "prosthetic", "craft", worst.locus, worst.severity],
    summary: `${personName(person)} has unsupported ${worst.severity} ${worst.locus} damage. A fitting, craft commission, or specialist escort can turn a permanent burden into a supported body plan.`
  });
}

function augmentationMaintenanceSignal(person: Person): ConditionPressureSignal | undefined {
  const augmentations = person.augmentations ?? [];
  if (augmentations.length === 0) {
    return undefined;
  }
  const maintenanceStatuses = profileStatuses(person, "augmentation-maintenance");
  const effects = computeAugmentationEffects(person);
  const pressured = augmentations.filter((augmentation) => conditionScale(augmentation) < 0.55 || !augmentation.active || maintenanceStatuses.statuses.length > 0);
  if (pressured.length === 0) {
    return undefined;
  }
  const worst = [...pressured].sort(
    (left, right) =>
      conditionScale(left) - conditionScale(right) ||
      Number(right.powered) - Number(left.powered) ||
      left.id.localeCompare(right.id)
  )[0];
  const conditionDeficit = 100 - Math.round(conditionScale(worst) * 100);
  const poweredRisk = worst.powered && !worst.active ? 24 : worst.powered ? 8 : 0;
  const sideEffectPressure = worst.sideEffects.reduce((sum, effect) => sum + effect.magnitude, 0) * 0.8 + effects.fatiguePenalty * 0.3 + effects.moralePenalty * 0.3;
  return createSignal(person, {
    kind: "augmentation-maintenance",
    sourceKinds: uniqueText(["augmentation", ...(maintenanceStatuses.statuses.length > 0 ? ["status"] : [])]) as ConditionPressureSourceKind[],
    subject: worst.name,
    pressure: conditionDeficit * 0.62 + poweredRisk + sideEffectPressure + maintenanceStatuses.pressure,
    danger: conditionDeficit * 0.28 + poweredRisk + maintenanceStatuses.danger + effects.inactiveIds.length * 4,
    questKind: "escort",
    encounterKind: worst.powered ? "resource-guardian" : undefined,
    encounterCategory: worst.powered ? "construct" : undefined,
    encounterDelta: worst.powered ? conditionDeficit * 0.18 + poweredRisk * 0.4 : undefined,
    augmentationIds: pressured.map((augmentation) => augmentation.id),
    statuses: maintenanceStatuses.statuses,
    drivers: [
      `${worst.kind}:${worst.locus}`,
      `condition:${worst.condition}/${worst.maxCondition}`,
      ...maintenanceStatuses.statuses.map((item) => `status:${item}`),
      ...effects.notes
    ],
    tags: ["augmentation", "maintenance", worst.kind, worst.source, worst.locus, ...worst.tags, ...maintenanceStatuses.tags],
    summary: `${worst.name} is creating maintenance pressure around ${personName(person)}. A technician, artificer, or charged supply run can prevent the body mod from becoming a failure event.`
  });
}

function occultTerms(values: readonly string[]): string[] {
  return values.filter((value) => /(curse|cursed|haunt|ghost|grave|undead|demon|infernal|soul|mind|aether|void|possess|compel)/i.test(value));
}

function occultEncounter(tags: readonly string[]): { encounterKind: EncounterKind; encounterCategory: CreatureCategory } {
  const text = tags.join(" ").toLowerCase();
  if (/(grave|ghost|undead|haunt)/.test(text)) {
    return { encounterKind: "gravebreak", encounterCategory: "undead" };
  }
  if (/(demon|infernal|possess)/.test(text)) {
    return { encounterKind: "summoning", encounterCategory: "demon" };
  }
  if (/(construct|bionic|powered|precursor)/.test(text)) {
    return { encounterKind: "resource-guardian", encounterCategory: "construct" };
  }
  return { encounterKind: "summoning", encounterCategory: "otherworldly" };
}

function ritualSignal(person: Person): ConditionPressureSignal | undefined {
  const ritualStatuses = profileStatuses(person, "ritual-cleansing");
  const occultScars = (person.scars ?? []).filter((scar) => occultTerms([scar.locus, scar.severity, ...scar.tags]).length > 0);
  const occultInjuries = (person.injuries ?? []).filter((injury) => occultTerms([injury.locus, injury.severity, ...injury.tags]).length > 0);
  const occultAugmentations = (person.augmentations ?? []).filter((augmentation) =>
    occultTerms([augmentation.kind, augmentation.source, augmentation.locus, ...augmentation.tags, ...augmentation.compatibilityTags]).length > 0
  );
  if (ritualStatuses.statuses.length === 0 && occultScars.length === 0 && occultInjuries.length === 0 && occultAugmentations.length === 0) {
    return undefined;
  }
  const tags = uniqueText([
    ...ritualStatuses.tags,
    ...occultScars.flatMap((scar) => scar.tags),
    ...occultInjuries.flatMap((injury) => injury.tags),
    ...occultAugmentations.flatMap((augmentation) => augmentation.tags)
  ]);
  const encounter = occultEncounter(tags);
  const scarPressure = occultScars.reduce((sum, scar) => sum + scar.burden * (scar.severity === "legendary" ? 1.4 : 0.8), 0);
  const injuryPressure = occultInjuries.reduce((sum, injury) => sum + injury.burden * 0.58, 0);
  const augmentationPressure = occultAugmentations.reduce((sum, augmentation) => sum + (augmentation.active ? 8 : 18) + (100 - Math.round(conditionScale(augmentation) * 100)) * 0.24, 0);
  return createSignal(person, {
    kind: "ritual-cleansing",
    sourceKinds: uniqueText([
      ...(ritualStatuses.statuses.length > 0 ? ["status"] : []),
      ...(occultScars.length > 0 ? ["scar"] : []),
      ...(occultInjuries.length > 0 ? ["injury"] : []),
      ...(occultAugmentations.length > 0 ? ["augmentation"] : [])
    ]) as ConditionPressureSourceKind[],
    subject: `${personName(person)}'s occult condition`,
    pressure: ritualStatuses.pressure + scarPressure + injuryPressure + augmentationPressure,
    danger: ritualStatuses.danger + scarPressure * 0.22 + injuryPressure * 0.24 + augmentationPressure * 0.28,
    questKind: ritualStatuses.profiles.some((profile) => profile.questKind === "politics") ? "politics" : "delve",
    encounterKind: encounter.encounterKind,
    encounterCategory: encounter.encounterCategory,
    encounterDelta: 8 + ritualStatuses.pressure * 0.16 + scarPressure * 0.08 + augmentationPressure * 0.08,
    injuryIds: occultInjuries.map((injury) => injury.id),
    scarIds: occultScars.map((scar) => scar.id),
    augmentationIds: occultAugmentations.map((augmentation) => augmentation.id),
    statuses: ritualStatuses.statuses,
    drivers: [...ritualStatuses.statuses.map((item) => `status:${item}`), ...tags.slice(0, 6)],
    tags: ["ward", "cleansing", ...tags],
    summary: `${personName(person)} is carrying occult body pressure. Wards, exorcists, truth work, or ritual containment can resolve it before the condition attracts stranger encounters.`
  });
}

function contagionSignal(person: Person): ConditionPressureSignal | undefined {
  const contagion = profileStatuses(person, "contagion-watch");
  if (contagion.statuses.length === 0) {
    return undefined;
  }
  return createSignal(person, {
    kind: "contagion-watch",
    sourceKinds: ["status"],
    subject: `${personName(person)}'s illness`,
    pressure: contagion.pressure + contagion.statuses.length * 8,
    danger: contagion.danger + contagion.statuses.length * 4,
    questKind: "escort",
    statuses: contagion.statuses,
    drivers: contagion.statuses.map((status) => `status:${status}`),
    tags: ["medicine", "quarantine", ...contagion.tags],
    summary: `${personName(person)} shows contagious condition pressure. The settlement needs supplies, isolation, or a healer before an illness becomes social pressure.`
  });
}

function bloodScentSignal(world: World, person: Person): ConditionPressureSignal | undefined {
  const settlement = world.settlements[person.locationId];
  const burden = deriveInjuryBurden(person);
  const isBleeding = person.status.includes("bleeding");
  const badlyWounded = person.maxHp > 0 && person.hp / person.maxHp < 0.35;
  const localThreat = settlement?.threat ?? 0;
  if ((!isBleeding && !badlyWounded) || localThreat < 28) {
    return undefined;
  }
  return createSignal(person, {
    kind: "blood-scent",
    sourceKinds: uniqueText(["status", ...(severeInjuries(person).length > 0 ? ["injury"] : [])]) as ConditionPressureSourceKind[],
    subject: `${personName(person)}'s trail`,
    pressure: localThreat * 0.42 + burden.burden * 0.34 + (isBleeding ? 18 : 0),
    danger: localThreat * 0.5 + burden.pain * 0.2 + (isBleeding ? 12 : 0),
    encounterKind: "random",
    encounterCategory: "beast",
    encounterDelta: localThreat * 0.18 + burden.burden * 0.12 + (isBleeding ? 7 : 0),
    injuryIds: severeInjuries(person).map((injury) => injury.id),
    statuses: person.status.filter((status) => status === "bleeding" || status === "wounded"),
    drivers: ["local-threat", ...(isBleeding ? ["status:bleeding"] : []), ...(badlyWounded ? ["low-health"] : [])],
    tags: ["beast", "blood", "wilderness", settlement?.biomeId ?? "", settlement?.terrain ?? ""],
    summary: `${personName(person)} is hurt in a dangerous area. The condition does not need a contract by itself, but it can increase random beast encounter pressure.`
  });
}

function personSignals(world: World, person: Person, options: ConditionPressureOptions): ConditionPressureSignal[] {
  const candidates = [careSignal(person), prostheticSignal(person), augmentationMaintenanceSignal(person), ritualSignal(person), contagionSignal(person), bloodScentSignal(world, person)].filter(
    (signal): signal is ConditionPressureSignal => Boolean(signal)
  );
  const includeStableScars = options.includeStableScars ?? false;
  return candidates.filter((signal) => includeStableScars || signal.kind !== "ritual-cleansing" || signal.statuses.length > 0 || signal.injuryIds.length > 0 || signal.augmentationIds.length > 0);
}

export function collectConditionPressureSignals(world: World, options: ConditionPressureOptions = {}): ConditionPressureSignal[] {
  const minPressure = options.minPressure ?? defaultMinPressure;
  const maxSignals = options.maxSignals ?? defaultMaxSignals;
  const maxPerPerson = options.maxPerPerson ?? defaultMaxPerPerson;
  const perPerson = new Map<Id, number>();
  const signals: ConditionPressureSignal[] = [];

  for (const person of Object.values(world.persons)) {
    if (!person.alive || !world.settlements[person.locationId] || !world.factions[person.factionId]) {
      continue;
    }
    for (const signal of sortedSignals(personSignals(world, person, options))) {
      if (signal.pressure < minPressure || !signalAllowed(signal, options)) {
        continue;
      }
      const count = perPerson.get(person.id) ?? 0;
      if (count >= maxPerPerson) {
        continue;
      }
      perPerson.set(person.id, count + 1);
      signals.push(signal);
    }
  }

  return sortedSignals(signals).slice(0, maxSignals);
}

function titleForSignal(signal: ConditionPressureSignal): string {
  if (signal.kind === "urgent-care") return `Treat ${signal.personName}`;
  if (signal.kind === "prosthetic-fitting") return `Fit support for ${signal.personName}`;
  if (signal.kind === "augmentation-maintenance") return `Repair ${signal.subject}`;
  if (signal.kind === "ritual-cleansing") return `Cleanse ${signal.personName}`;
  if (signal.kind === "contagion-watch") return `Contain illness around ${signal.personName}`;
  return `Hunt the trail around ${signal.personName}`;
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

export function conditionPressureToQuestProposal(world: World, signal: ConditionPressureSignal): QuestNeedProposal | undefined {
  if (!signal.questKind || !world.settlements[signal.locationId] || !world.factions[signal.factionId]) {
    return undefined;
  }
  const danger = rounded(signal.danger, 12, 98);
  const urgency = rounded(signal.urgency, 20, 130);
  const priority = rounded(signal.priority, 0, 180);
  return {
    signature: signal.signature,
    needKind: conditionNeedKind[signal.kind],
    title: titleForSignal(signal),
    kind: signal.questKind,
    issuerFactionId: signal.factionId,
    locationId: signal.locationId,
    danger,
    rewardGold: Math.ceil(danger * 1.6 + signal.pressure * 0.42),
    rewardRenown: Math.ceil(danger / 9 + signal.pressure / 35),
    urgency,
    priority,
    summary: signal.summary,
    sourceKind: "settlement",
    sourceId: signal.locationId,
    tags: uniqueText([...signal.tags, `person:${signal.personId}`, ...signal.statuses]).slice(0, 18)
  };
}

export function proposeConditionPressureQuestNeeds(world: World, options: ConditionPressureQuestOptions = {}): QuestNeedProposal[] {
  const maxProposals = options.maxProposals ?? defaultMaxProposals;
  const maxPerLocation = options.maxPerLocation ?? defaultMaxPerLocation;
  const seen = new Set(options.existingSignatures ?? []);
  const perLocation = new Map<Id, number>();
  const proposals: QuestNeedProposal[] = [];

  for (const signal of collectConditionPressureSignals(world, { ...options, includeQuestSignals: true })) {
    if (proposals.length >= maxProposals || seen.has(signal.signature)) {
      continue;
    }
    const proposal = conditionPressureToQuestProposal(world, signal);
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

export function conditionPressureEncounterDeltas(signals: readonly ConditionPressureSignal[]): Partial<Record<EncounterKind, number>> {
  const deltas: Partial<Record<EncounterKind, number>> = {};
  for (const signal of signals) {
    if (!signal.encounterKind) {
      continue;
    }
    const delta = signal.encounterDelta ?? Math.max(1, Math.round(signal.pressure * 0.12));
    deltas[signal.encounterKind] = rounded((deltas[signal.encounterKind] ?? 0) + delta, 0, 100);
  }
  return deltas;
}

export function applyConditionEncounterPressure(world: World, options: ApplyConditionEncounterPressureOptions = {}): Partial<Record<EncounterKind, number>> {
  const signals = collectConditionPressureSignals(world, { ...options, includeEncounterSignals: true });
  const deltas = conditionPressureEncounterDeltas(signals);
  const maxDelta = options.maxDeltaPerKind ?? defaultMaxDeltaPerKind;
  world.encounterPressure ??= {};
  for (const [kind, rawDelta] of Object.entries(deltas) as [EncounterKind, number][]) {
    const delta = rounded(rawDelta, 0, maxDelta);
    world.encounterPressure[kind] = rounded((world.encounterPressure[kind] ?? 0) + delta, 0, 100);
    deltas[kind] = delta;
  }
  return deltas;
}

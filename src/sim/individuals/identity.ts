import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type { IdentityAxes, IdentityAxisKey, Person, QuestKind, SkillBlock, TraitBlock } from "../types";

export const identityAxisKeys = [
  "evilGood",
  "corruptPure",
  "authoritarianEgalitarian",
  "warlikePeaceful",
  "materialistSpiritualist",
  "vengefulForgiving",
  "cravenBold",
  "mightMagic"
] as const;

export const identityAxisInfo: Record<IdentityAxisKey, { label: string; negative: string; positive: string }> = {
  evilGood: { label: "Evil / Good", negative: "evil", positive: "good" },
  corruptPure: { label: "Corrupt / Pure", negative: "corrupt", positive: "pure" },
  authoritarianEgalitarian: { label: "Authority / Equality", negative: "authoritarian", positive: "egalitarian" },
  warlikePeaceful: { label: "Warlike / Peaceful", negative: "warlike", positive: "peaceful" },
  materialistSpiritualist: { label: "Materialist / Spiritualist", negative: "materialist", positive: "spiritualist" },
  vengefulForgiving: { label: "Vengeful / Forgiving", negative: "vengeful", positive: "forgiving" },
  cravenBold: { label: "Craven / Bold", negative: "craven", positive: "bold" },
  mightMagic: { label: "Might / Magic", negative: "might", positive: "magic" }
};

type IdentityShift = Partial<Record<IdentityAxisKey, number>>;
type BandAction = "rest" | "patrol" | "train" | "recruit";
type QuestOutcome = "success" | "failure" | "retreat";

const center = (value: number | undefined): number => (value ?? 50) - 50;
const bounded = (value: number): number => clamp(Math.round(value), -100, 100);

export function neutralIdentityAxes(): IdentityAxes {
  return {
    evilGood: 0,
    corruptPure: 0,
    authoritarianEgalitarian: 0,
    warlikePeaceful: 0,
    materialistSpiritualist: 0,
    vengefulForgiving: 0,
    cravenBold: 0,
    mightMagic: 0
  };
}

export function randomIdentityAxes(rng: Rng, role: Person["role"], traits: TraitBlock, skills: SkillBlock): IdentityAxes {
  const roleBias: Record<Person["role"], IdentityShift> = {
    leader: { authoritarianEgalitarian: -14, cravenBold: 18 },
    fighter: { warlikePeaceful: -24, mightMagic: -24, cravenBold: 18 },
    healer: { evilGood: 22, corruptPure: 14, vengefulForgiving: 20, warlikePeaceful: 12, mightMagic: 8 },
    mage: { materialistSpiritualist: 18, mightMagic: 34 },
    scout: { cravenBold: 12, materialistSpiritualist: -8 },
    commoner: {}
  };
  const bias = roleBias[role];
  const roll = () => rng.int(-22, 22);

  return {
    evilGood: bounded(roll() + center(traits.mercy) * 0.75 + center(traits.loyalty) * 0.25 - center(traits.greed) * 0.35 - center(traits.wrath) * 0.45 + (bias.evilGood ?? 0)),
    corruptPure: bounded(roll() + center(traits.loyalty) * 0.4 + center(traits.mercy) * 0.45 - center(traits.greed) * 0.6 - center(traits.ambition) * 0.15 + (bias.corruptPure ?? 0)),
    authoritarianEgalitarian: bounded(roll() + center(traits.mercy) * 0.3 + center(traits.curiosity) * 0.15 - center(traits.ambition) * 0.25 - center(skills.command) * 0.25 + (bias.authoritarianEgalitarian ?? 0)),
    warlikePeaceful: bounded(roll() + center(traits.mercy) * 0.55 + center(traits.caution) * 0.22 - center(traits.bravery) * 0.35 - center(traits.wrath) * 0.5 + (bias.warlikePeaceful ?? 0)),
    materialistSpiritualist: bounded(roll() + center(skills.sorcery) * 0.45 + center(skills.ward) * 0.25 + center(traits.curiosity) * 0.25 - center(skills.blade) * 0.25 - center(traits.greed) * 0.35 + (bias.materialistSpiritualist ?? 0)),
    vengefulForgiving: bounded(roll() + center(traits.mercy) * 0.8 + center(traits.caution) * 0.15 - center(traits.wrath) * 0.75 + (bias.vengefulForgiving ?? 0)),
    cravenBold: bounded(roll() + center(traits.bravery) * 0.75 + center(traits.ambition) * 0.25 - center(traits.caution) * 0.65 + (bias.cravenBold ?? 0)),
    mightMagic: bounded(roll() + center(skills.sorcery) * 0.85 + center(skills.ward) * 0.25 + center(skills.medicine) * 0.1 - center(skills.blade) * 0.65 - center(skills.survival) * 0.15 + (bias.mightMagic ?? 0))
  };
}

export function ensureIdentityAxes(person: Person, rng?: Rng): IdentityAxes {
  const fallback = rng ? randomIdentityAxes(rng, person.role, person.traits, person.skills) : neutralIdentityAxes();
  person.identity = { ...fallback, ...(person.identity ?? {}) };
  for (const key of identityAxisKeys) {
    person.identity[key] = bounded(person.identity[key]);
  }
  return person.identity;
}

export function shiftIdentity(person: Person, shift: IdentityShift): void {
  const identity = ensureIdentityAxes(person);
  for (const key of identityAxisKeys) {
    const delta = shift[key] ?? 0;
    if (delta !== 0) {
      identity[key] = bounded(identity[key] + delta);
    }
  }
}

export function identityQuestBias(person: Person, kind: QuestKind): number {
  const identity = ensureIdentityAxes(person);
  switch (kind) {
    case "defense":
      return identity.evilGood * 0.08 + identity.corruptPure * 0.06 - identity.warlikePeaceful * 0.08 + identity.cravenBold * 0.06 - identity.authoritarianEgalitarian * 0.03;
    case "delve":
      return Math.abs(identity.materialistSpiritualist) * 0.05 + identity.mightMagic * 0.07 + identity.cravenBold * 0.05 - identity.corruptPure * 0.03;
    case "hunt":
      return -identity.warlikePeaceful * 0.12 - identity.vengefulForgiving * 0.06 - identity.mightMagic * 0.04 + identity.cravenBold * 0.08;
    case "escort":
      return identity.evilGood * 0.1 + identity.corruptPure * 0.06 + identity.vengefulForgiving * 0.07 + identity.warlikePeaceful * 0.05;
    case "politics":
      return Math.abs(identity.authoritarianEgalitarian) * 0.08 + identity.warlikePeaceful * 0.07 + identity.materialistSpiritualist * 0.04;
  }
}

export function identityActionBias(person: Person, action: BandAction): number {
  const identity = ensureIdentityAxes(person);
  switch (action) {
    case "rest":
      return identity.warlikePeaceful * 0.07 + identity.vengefulForgiving * 0.04 - identity.cravenBold * 0.08 + identity.materialistSpiritualist * 0.03;
    case "patrol":
      return -identity.warlikePeaceful * 0.1 + identity.evilGood * 0.05 + identity.corruptPure * 0.04 + identity.cravenBold * 0.08 - identity.authoritarianEgalitarian * 0.03;
    case "train":
      return identity.cravenBold * 0.12 - identity.warlikePeaceful * 0.07 + Math.abs(identity.mightMagic) * 0.05;
    case "recruit":
      return identity.authoritarianEgalitarian * 0.1 + identity.vengefulForgiving * 0.08 + identity.evilGood * 0.06 + identity.warlikePeaceful * 0.04;
  }
}

export function mutateIdentityForQuest(person: Person, kind: QuestKind, outcome: QuestOutcome, rng: Rng): void {
  const swing = (min: number, max: number) => rng.int(min, max);
  if (outcome === "failure") {
    shiftIdentity(person, {
      cravenBold: -swing(1, 3),
      vengefulForgiving: -swing(1, 3),
      corruptPure: -rng.int(0, 2)
    });
    return;
  }

  if (outcome === "retreat") {
    shiftIdentity(person, {
      cravenBold: -swing(1, 2),
      vengefulForgiving: -rng.int(0, 2),
      warlikePeaceful: rng.int(0, 1)
    });
    return;
  }

  const magicLean = person.skills.sorcery + person.skills.ward > person.skills.blade + person.skills.survival ? 1 : -1;
  const politicalLean = ensureIdentityAxes(person).authoritarianEgalitarian < 0 ? -1 : 1;
  const successShifts: Record<QuestKind, IdentityShift> = {
    defense: { evilGood: swing(1, 3), corruptPure: rng.int(0, 2), warlikePeaceful: -rng.int(0, 2), cravenBold: rng.int(0, 2) },
    delve: { cravenBold: rng.int(1, 3), materialistSpiritualist: magicLean > 0 ? rng.int(0, 2) : -rng.int(0, 2), mightMagic: magicLean * rng.int(0, 2), corruptPure: -rng.int(0, 1) },
    hunt: { warlikePeaceful: -swing(1, 3), vengefulForgiving: -rng.int(0, 2), mightMagic: -rng.int(0, 2), cravenBold: rng.int(0, 2) },
    escort: { evilGood: swing(1, 3), corruptPure: rng.int(0, 2), vengefulForgiving: rng.int(1, 3), warlikePeaceful: rng.int(0, 2) },
    politics: { authoritarianEgalitarian: politicalLean * rng.int(1, 3), materialistSpiritualist: rng.int(-1, 1), vengefulForgiving: rng.int(0, 2) }
  };
  shiftIdentity(person, successShifts[kind]);
}

export function identityPoleLabel(key: IdentityAxisKey, value: number): string {
  const info = identityAxisInfo[key];
  if (value <= -55) {
    return info.negative;
  }
  if (value >= 55) {
    return info.positive;
  }
  if (value <= -20) {
    return `leaning ${info.negative}`;
  }
  if (value >= 20) {
    return `leaning ${info.positive}`;
  }
  return "balanced";
}

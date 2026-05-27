import { clamp, makeId } from "../core/math";
import type {
  Agreement,
  AgreementKind,
  AgreementStatus,
  Asset,
  AssetKind,
  AssetStatus,
  Faction,
  FactionKind,
  GroupOutlook,
  Id,
  IdentityAxes,
  IdentityAxisKey,
  LegalEntityKind,
  LegalEntityRef,
  MembershipRole,
  MembershipStatus,
  Organization,
  OrganizationKind,
  OrganizationStatus,
  Person,
  PersonMembership,
  Settlement,
  World
} from "../types";

export const organizationKinds = ["guild", "business", "order", "cult", "dynasty", "political-bloc"] as const satisfies readonly OrganizationKind[];
export const agreementKinds = [
  "charter",
  "lease",
  "protection",
  "trade",
  "debt",
  "oath",
  "vassalage",
  "banishment",
  "excommunication",
  "ceasefire"
] as const satisfies readonly AgreementKind[];
export const assetKinds = [
  "mine",
  "forge",
  "apothecary",
  "caravan",
  "graveyard",
  "temple",
  "guildhall",
  "vault",
  "farm",
  "dock",
  "road",
  "fortress"
] as const satisfies readonly AssetKind[];

const organizationStatuses = ["forming", "active", "strained", "outlawed", "dormant", "broken"] as const satisfies readonly OrganizationStatus[];
const membershipRoles = ["founder", "leader", "member", "agent", "patron", "heir", "initiate", "debtor", "exile"] as const satisfies readonly MembershipRole[];
const membershipStatuses = ["active", "oathbound", "strained", "hidden", "suspended", "banished"] as const satisfies readonly MembershipStatus[];
const assetStatuses = ["planned", "active", "damaged", "seized", "abandoned", "sealed"] as const satisfies readonly AssetStatus[];
const agreementStatuses = ["draft", "active", "strained", "breached", "expired", "void"] as const satisfies readonly AgreementStatus[];
const legalEntityKinds = ["person", "band", "faction", "organization", "settlement"] as const satisfies readonly LegalEntityKind[];
const identityAxisKeys = [
  "evilGood",
  "corruptPure",
  "authoritarianEgalitarian",
  "warlikePeaceful",
  "materialistSpiritualist",
  "vengefulForgiving",
  "cravenBold",
  "mightMagic"
] as const satisfies readonly IdentityAxisKey[];

export interface OrganizationEconomyOptions {
  seedDefaults?: boolean;
}

const prioritiesByKind: Record<OrganizationKind, string[]> = {
  guild: ["craft", "wages", "apprenticeship"],
  business: ["profit", "routes", "contracts"],
  order: ["discipline", "defense", "doctrine"],
  cult: ["revelation", "rites", "secrecy"],
  dynasty: ["inheritance", "marriage", "claims"],
  "political-bloc": ["votes", "patrons", "reform"]
};

const taboosByKind: Record<OrganizationKind, string[]> = {
  guild: ["scab labor", "stolen marks"],
  business: ["broken credit", "unsafe roads"],
  order: ["desertion", "cowardice"],
  cult: ["apostasy", "profane witnesses"],
  dynasty: ["bastardy scandals", "lost seals"],
  "political-bloc": ["public betrayal", "secret decrees"]
};

const assetOutputs: Record<AssetKind, string[]> = {
  mine: ["ore", "stone", "hazard"],
  forge: ["arms", "tools", "craft"],
  apothecary: ["medicine", "poisons", "care"],
  caravan: ["trade", "news", "supply"],
  graveyard: ["ancestry", "rites", "memory"],
  temple: ["faith", "healing", "sanctuary"],
  guildhall: ["labor", "training", "contracts"],
  vault: ["coin", "records", "secrets"],
  farm: ["grain", "livestock", "tithes"],
  dock: ["fish", "passage", "cargo"],
  road: ["travel", "tolls", "patrols"],
  fortress: ["defense", "authority", "garrison"]
};

function stableCode(value: string): number {
  let code = 0;
  for (let index = 0; index < value.length; index += 1) {
    code = (code * 33 + value.charCodeAt(index)) % 1000000;
  }
  return code;
}

function stableId(prefix: string, value: string): Id {
  return makeId(prefix, stableCode(value));
}

function bounded(value: unknown, fallback: number, min = 0, max = 100): number {
  return clamp(Math.round(typeof value === "number" && Number.isFinite(value) ? value : fallback), min, max);
}

function boundedTick(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(typeof value === "number" && Number.isFinite(value) ? value : fallback));
}

function known<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function uniqueIds(ids: readonly unknown[]): Id[] {
  return [...new Set(ids.filter((id): id is Id => typeof id === "string" && id.length > 0))];
}

function firstEntityRef(world: World): LegalEntityRef {
  const organizationId = Object.keys(world.organizations ?? {}).sort()[0];
  if (organizationId) return { kind: "organization", id: organizationId };
  const factionId = Object.keys(world.factions ?? {}).sort()[0];
  if (factionId) return { kind: "faction", id: factionId };
  const settlementId = Object.keys(world.settlements ?? {}).sort()[0];
  if (settlementId) return { kind: "settlement", id: settlementId };
  return { kind: "faction", id: "faction-unknown" };
}

function repairLegalRef(input: unknown, fallback: LegalEntityRef): LegalEntityRef {
  if (!input || typeof input !== "object") {
    return fallback;
  }
  const ref = input as Partial<LegalEntityRef>;
  if (typeof ref.id !== "string" || !ref.id) {
    return fallback;
  }
  return {
    kind: known(legalEntityKinds, ref.kind, fallback.kind),
    id: ref.id
  };
}

function knownRef(world: World, ref: LegalEntityRef): boolean {
  if (ref.kind === "person") return Boolean(world.persons[ref.id]);
  if (ref.kind === "band") return Boolean(world.bands[ref.id]);
  if (ref.kind === "faction") return Boolean(world.factions[ref.id]);
  if (ref.kind === "organization") return Boolean(world.organizations?.[ref.id]);
  return Boolean(world.settlements[ref.id]);
}

function repairIdentity(input: Partial<IdentityAxes> | undefined, fallback: Partial<IdentityAxes>): Partial<IdentityAxes> {
  const identity: Partial<IdentityAxes> = {};
  for (const key of identityAxisKeys) {
    const value = input?.[key] ?? fallback[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      identity[key] = clamp(Math.round(value), -100, 100);
    }
  }
  return identity;
}

export function defaultGroupOutlook(kind: OrganizationKind): GroupOutlook {
  const identity: Record<OrganizationKind, Partial<IdentityAxes>> = {
    guild: { materialistSpiritualist: -28, authoritarianEgalitarian: 6, corruptPure: 4 },
    business: { materialistSpiritualist: -38, authoritarianEgalitarian: 2, corruptPure: -6 },
    order: { authoritarianEgalitarian: -26, warlikePeaceful: -10, corruptPure: 8 },
    cult: { materialistSpiritualist: 42, mightMagic: 22, corruptPure: -10 },
    dynasty: { authoritarianEgalitarian: -34, vengefulForgiving: -8, cravenBold: 8 },
    "political-bloc": { authoritarianEgalitarian: 20, warlikePeaceful: 6, evilGood: 4 }
  };
  return {
    identity: identity[kind],
    priorities: prioritiesByKind[kind],
    taboos: taboosByKind[kind],
    reputation: 50,
    cohesion: kind === "business" ? 42 : kind === "cult" || kind === "order" ? 62 : 52,
    legitimacy: kind === "cult" ? 36 : kind === "dynasty" ? 68 : 54,
    secrecy: kind === "cult" ? 72 : kind === "business" ? 22 : 34
  };
}

function repairGroupOutlook(input: Partial<GroupOutlook> | undefined, kind: OrganizationKind): GroupOutlook {
  const fallback = defaultGroupOutlook(kind);
  return {
    identity: repairIdentity(input?.identity, fallback.identity),
    priorities: uniqueText(input?.priorities).length ? uniqueText(input?.priorities).slice(0, 5) : fallback.priorities,
    taboos: uniqueText(input?.taboos).length ? uniqueText(input?.taboos).slice(0, 5) : fallback.taboos,
    reputation: bounded(input?.reputation, fallback.reputation),
    cohesion: bounded(input?.cohesion, fallback.cohesion),
    legitimacy: bounded(input?.legitimacy, fallback.legitimacy),
    secrecy: bounded(input?.secrecy, fallback.secrecy)
  };
}

function uniqueText(values: readonly unknown[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function organizationKindForFaction(kind: FactionKind): OrganizationKind {
  if (kind === "barony") return "dynasty";
  if (kind === "freehold") return "political-bloc";
  if (kind === "guild") return "guild";
  if (kind === "cult") return "cult";
  return "order";
}

function organizationName(faction: Faction, kind: OrganizationKind): string {
  if (kind === "dynasty") return `${faction.name} House`;
  if (kind === "political-bloc") return `${faction.name} Assembly`;
  if (kind === "guild") return `${faction.name} Charter`;
  if (kind === "cult") return `${faction.name} Inner Rite`;
  if (kind === "order") return `${faction.name} Oath Order`;
  return `${faction.name} Concern`;
}

function sortedPeopleForFaction(world: World, factionId: Id): Person[] {
  return Object.values(world.persons)
    .filter((person) => person.factionId === factionId && person.alive)
    .sort((a, b) => (b.role === "leader" ? 1 : 0) - (a.role === "leader" ? 1 : 0) || b.renown - a.renown || a.id.localeCompare(b.id));
}

function defaultMembershipFor(person: Person, organization: Organization, role: MembershipRole): PersonMembership {
  const factionBias = organization.factionId && person.factionId === organization.factionId ? 18 : 0;
  const leader = organization.leaderPersonId ? person.relations[organization.leaderPersonId] ?? 0 : 0;
  return {
    organizationId: organization.id,
    role,
    status: role === "leader" || role === "founder" ? "oathbound" : "active",
    loyalty: clamp(Math.round(44 + factionBias + leader * 0.24), 0, 100),
    influence: role === "leader" || role === "founder" ? 68 : role === "patron" ? 44 : 18,
    obligation: role === "exile" ? 0 : role === "debtor" ? 74 : 36,
    joinedTick: organization.foundedTick,
    public: organization.outlook.secrecy < 60
  };
}

function repairMembership(input: Partial<PersonMembership>, organization: Organization, person: Person): PersonMembership {
  const fallback = defaultMembershipFor(person, organization, organization.leaderPersonId === person.id ? "leader" : "member");
  return {
    organizationId: organization.id,
    role: known(membershipRoles, input.role, fallback.role),
    status: known(membershipStatuses, input.status, fallback.status),
    loyalty: bounded(input.loyalty, fallback.loyalty),
    influence: bounded(input.influence, fallback.influence),
    obligation: bounded(input.obligation, fallback.obligation),
    joinedTick: boundedTick(input.joinedTick, fallback.joinedTick),
    public: typeof input.public === "boolean" ? input.public : fallback.public
  };
}

function assetKindForOrganization(kind: OrganizationKind, settlement: Settlement | undefined): AssetKind {
  if (kind === "guild") return "guildhall";
  if (kind === "business") return settlement?.terrain === "riverlands" ? "dock" : "caravan";
  if (kind === "order") return "fortress";
  if (kind === "cult") return "temple";
  if (kind === "dynasty") return "vault";
  return "road";
}

function assetName(settlement: Settlement | undefined, kind: AssetKind): string {
  const place = settlement?.name ?? "the frontier";
  if (kind === "guildhall") return `${place} Guildhall`;
  if (kind === "fortress") return `${place} Watch Fortress`;
  if (kind === "temple") return `${place} Temple`;
  if (kind === "vault") return `${place} Claim Vault`;
  if (kind === "road") return `${place} Moot Road`;
  if (kind === "dock") return `${place} Dock`;
  if (kind === "caravan") return `${place} Caravan`;
  if (kind === "farm") return `${place} Farm`;
  if (kind === "mine") return `${place} Mine`;
  if (kind === "forge") return `${place} Forge`;
  if (kind === "apothecary") return `${place} Apothecary`;
  return `${place} Graveyard`;
}

function makeDefaultOrganization(world: World, faction: Faction): Organization {
  const kind = organizationKindForFaction(faction.kind);
  const members = sortedPeopleForFaction(world, faction.id).slice(0, 6);
  const leader = members[0];
  return {
    id: stableId("org", faction.id),
    name: organizationName(faction, kind),
    kind,
    status: "active",
    factionId: faction.id,
    cultureId: faction.cultureId || undefined,
    homeSettlementId: faction.capitalId,
    leaderPersonId: leader?.id,
    memberIds: members.map((person) => person.id),
    assetIds: [],
    agreementIds: [],
    wealth: bounded(faction.wealth, 50),
    influence: bounded(faction.stability * 0.5 + faction.military * 0.2 + faction.magic * 0.1, 50),
    outlook: defaultGroupOutlook(kind),
    tags: ["faction-default", kind, faction.kind],
    foundedTick: 0
  };
}

function makeDefaultAsset(world: World, organization: Organization): Asset {
  const settlement = organization.homeSettlementId ? world.settlements[organization.homeSettlementId] : undefined;
  const kind = assetKindForOrganization(organization.kind, settlement);
  const owner = { kind: "organization", id: organization.id } as const;
  return {
    id: stableId("asset", `${organization.id}:${kind}:${organization.homeSettlementId ?? "none"}`),
    name: assetName(settlement, kind),
    kind,
    status: "active",
    owner,
    operator: owner,
    locationId: organization.homeSettlementId,
    value: clamp(Math.round(28 + organization.wealth * 0.55 + organization.influence * 0.25), 1, 160),
    integrity: 100,
    outputTags: [...new Set([...assetOutputs[kind], ...(settlement?.resources ?? []).slice(0, 2)])],
    tags: ["foundation", kind, organization.kind],
    foundedTick: organization.foundedTick
  };
}

function makeDefaultCharter(world: World, organization: Organization, faction: Faction, asset: Asset): Agreement {
  const factionRef: LegalEntityRef = { kind: "faction", id: faction.id };
  const organizationRef: LegalEntityRef = { kind: "organization", id: organization.id };
  return {
    id: stableId("agreement", `${organization.id}:${asset.id}:charter`),
    name: `${organization.name} Charter`,
    kind: "charter",
    status: "active",
    parties: [factionRef, organizationRef],
    assetIds: [asset.id],
    locationId: asset.locationId,
    terms: [
      `${organization.name} may operate ${asset.name}`,
      `${faction.name} recognizes separate owner and operator records`,
      "Disputes are resolved by local charter custom"
    ],
    value: asset.value,
    pressure: bounded(100 - faction.stability, 18),
    signedTick: Math.max(0, world.tick),
    tags: ["foundation", "charter", organization.kind]
  };
}

function repairOrganizationMap(world: World): void {
  const current = Object.values(world.organizations ?? {}) as Partial<Organization>[];
  const repaired: Record<Id, Organization> = {};
  for (const input of current) {
    if (typeof input.id !== "string" || !input.id) {
      continue;
    }
    const kind = known(organizationKinds, input.kind, "business");
    const organization: Organization = {
      id: input.id,
      name: typeof input.name === "string" && input.name ? input.name : `${kind} ${input.id}`,
      kind,
      status: known(organizationStatuses, input.status, "active"),
      factionId: typeof input.factionId === "string" ? input.factionId : undefined,
      cultureId: typeof input.cultureId === "string" ? input.cultureId : undefined,
      homeSettlementId: typeof input.homeSettlementId === "string" ? input.homeSettlementId : undefined,
      leaderPersonId: typeof input.leaderPersonId === "string" ? input.leaderPersonId : undefined,
      memberIds: uniqueIds(input.memberIds ?? []).filter((id) => Boolean(world.persons[id])),
      assetIds: uniqueIds(input.assetIds ?? []),
      agreementIds: uniqueIds(input.agreementIds ?? []),
      wealth: bounded(input.wealth, 40),
      influence: bounded(input.influence, 40),
      outlook: repairGroupOutlook(input.outlook, kind),
      tags: uniqueText(input.tags),
      foundedTick: boundedTick(input.foundedTick, 0)
    };
    repaired[organization.id] = organization;
  }
  world.organizations = repaired;
}

function repairAssetMap(world: World): void {
  const current = Object.values(world.assets ?? {}) as Partial<Asset>[];
  const repaired: Record<Id, Asset> = {};
  const fallbackRef = firstEntityRef(world);
  for (const input of current) {
    if (typeof input.id !== "string" || !input.id) {
      continue;
    }
    const kind = known(assetKinds, input.kind, "guildhall");
    const owner = repairLegalRef(input.owner, fallbackRef);
    const operator = repairLegalRef(input.operator, owner);
    const asset: Asset = {
      id: input.id,
      name: typeof input.name === "string" && input.name ? input.name : assetName(undefined, kind),
      kind,
      status: known(assetStatuses, input.status, "active"),
      owner,
      operator,
      locationId: typeof input.locationId === "string" ? input.locationId : undefined,
      agreementId: typeof input.agreementId === "string" ? input.agreementId : undefined,
      value: bounded(input.value, 30, 0, 200),
      integrity: bounded(input.integrity, 100),
      outputTags: uniqueText(input.outputTags).length ? uniqueText(input.outputTags).slice(0, 8) : assetOutputs[kind],
      tags: uniqueText(input.tags),
      foundedTick: boundedTick(input.foundedTick, 0)
    };
    repaired[asset.id] = asset;
  }
  world.assets = repaired;
}

function repairAgreementMap(world: World): void {
  const current = Object.values(world.agreements ?? {}) as Partial<Agreement>[];
  const repaired: Record<Id, Agreement> = {};
  const fallbackRef = firstEntityRef(world);
  for (const input of current) {
    if (typeof input.id !== "string" || !input.id) {
      continue;
    }
    const kind = known(agreementKinds, input.kind, "charter");
    const parties = (input.parties ?? []).map((party) => repairLegalRef(party, fallbackRef)).filter((party) => knownRef(world, party));
    const agreement: Agreement = {
      id: input.id,
      name: typeof input.name === "string" && input.name ? input.name : `${kind} agreement ${input.id}`,
      kind,
      status: known(agreementStatuses, input.status, "active"),
      parties: parties.length ? parties : [fallbackRef],
      assetIds: uniqueIds(input.assetIds ?? []).filter((id) => Boolean(world.assets?.[id])),
      locationId: typeof input.locationId === "string" ? input.locationId : undefined,
      terms: uniqueText(input.terms).slice(0, 8),
      value: bounded(input.value, 0, 0, 200),
      pressure: bounded(input.pressure, 0),
      signedTick: boundedTick(input.signedTick, 0),
      expiresTick: typeof input.expiresTick === "number" && Number.isFinite(input.expiresTick) ? Math.max(0, Math.floor(input.expiresTick)) : undefined,
      tags: uniqueText(input.tags)
    };
    repaired[agreement.id] = agreement;
  }
  world.agreements = repaired;
}

function repairCrossLinks(world: World): void {
  const organizations = world.organizations ?? {};
  const assets = world.assets ?? {};
  const agreements = world.agreements ?? {};
  for (const organization of Object.values(organizations)) {
    organization.assetIds = uniqueIds(organization.assetIds).filter((id) => Boolean(assets[id]));
    organization.agreementIds = uniqueIds(organization.agreementIds).filter((id) => Boolean(agreements[id]));
    if (organization.leaderPersonId && !world.persons[organization.leaderPersonId]) {
      organization.leaderPersonId = organization.memberIds[0];
    }
  }
  for (const asset of Object.values(assets)) {
    if (asset.agreementId && !agreements[asset.agreementId]) {
      delete asset.agreementId;
    }
    if (!knownRef(world, asset.owner)) {
      asset.owner = firstEntityRef(world);
    }
    if (!knownRef(world, asset.operator)) {
      asset.operator = asset.owner;
    }
    if (asset.owner.kind === "organization") {
      organizations[asset.owner.id]?.assetIds.push(asset.id);
    }
    if (asset.operator.kind === "organization") {
      organizations[asset.operator.id]?.assetIds.push(asset.id);
    }
  }
  for (const agreement of Object.values(agreements)) {
    agreement.assetIds = uniqueIds(agreement.assetIds).filter((id) => Boolean(assets[id]));
    agreement.parties = agreement.parties.filter((party) => knownRef(world, party));
    if (agreement.parties.length === 0) {
      agreement.parties = [firstEntityRef(world)];
    }
    for (const party of agreement.parties) {
      if (party.kind === "organization") {
        organizations[party.id]?.agreementIds.push(agreement.id);
      }
    }
    for (const assetId of agreement.assetIds) {
      assets[assetId].agreementId ??= agreement.id;
    }
  }
  for (const organization of Object.values(organizations)) {
    organization.assetIds = uniqueIds(organization.assetIds);
    organization.agreementIds = uniqueIds(organization.agreementIds);
  }
}

function repairPersonMemberships(world: World): void {
  const organizations = world.organizations ?? {};
  for (const person of Object.values(world.persons)) {
    const memberships = new Map<Id, PersonMembership>();
    for (const input of person.memberships ?? []) {
      const organizationId = typeof input.organizationId === "string" ? input.organizationId : "";
      const organization = organizations[organizationId];
      if (!organization) {
        continue;
      }
      memberships.set(organization.id, repairMembership(input, organization, person));
      if (!organization.memberIds.includes(person.id)) {
        organization.memberIds.push(person.id);
      }
    }
    person.memberships = [...memberships.values()].sort((a, b) => a.organizationId.localeCompare(b.organizationId));
  }

  for (const organization of Object.values(organizations)) {
    organization.memberIds = uniqueIds(organization.memberIds).filter((id) => Boolean(world.persons[id]));
    for (const memberId of organization.memberIds) {
      const person = world.persons[memberId];
      if (!person) {
        continue;
      }
      person.memberships ??= [];
      if (!person.memberships.some((membership) => membership.organizationId === organization.id)) {
        person.memberships.push(defaultMembershipFor(person, organization, organization.leaderPersonId === person.id ? "leader" : "member"));
      }
      person.memberships = person.memberships.sort((a, b) => a.organizationId.localeCompare(b.organizationId));
    }
  }
}

export function seedDefaultOrganizations(world: World): Organization[] {
  world.organizations ??= {};
  world.assets ??= {};
  world.agreements ??= {};

  const created: Organization[] = [];
  const factions = Object.values(world.factions).sort((a, b) => a.id.localeCompare(b.id));
  for (const faction of factions) {
    const existing = Object.values(world.organizations).some((organization) => organization.factionId === faction.id && organization.tags.includes("faction-default"));
    if (existing) {
      continue;
    }
    const organization = makeDefaultOrganization(world, faction);
    const asset = makeDefaultAsset(world, organization);
    const agreement = makeDefaultCharter(world, organization, faction, asset);
    organization.assetIds = [asset.id];
    organization.agreementIds = [agreement.id];
    asset.agreementId = agreement.id;
    world.organizations[organization.id] = organization;
    world.assets[asset.id] = asset;
    world.agreements[agreement.id] = agreement;
    created.push(organization);
  }
  repairCrossLinks(world);
  repairPersonMemberships(world);
  return created;
}

export function ensureOrganizationEconomy(world: World, options: OrganizationEconomyOptions = {}): void {
  world.organizations ??= {};
  world.assets ??= {};
  world.agreements ??= {};
  repairOrganizationMap(world);
  repairAssetMap(world);
  repairAgreementMap(world);
  repairCrossLinks(world);
  repairPersonMemberships(world);
  if (options.seedDefaults && Object.keys(world.organizations).length === 0) {
    seedDefaultOrganizations(world);
  }
}

export function organizationMembership(person: Person, organizationId: Id): PersonMembership | undefined {
  return person.memberships?.find((membership) => membership.organizationId === organizationId);
}

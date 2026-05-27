import type { EventKind, LegalEntityRef, Person, SocialIntentKind, World } from "./types";
import { deriveIntentProjection } from "./individuals/ambitions";
import { collectOccupancySnapshot } from "./world/occupancy";
import { collectSettlementDevelopmentSnapshot, validateSettlementDevelopment } from "./world/buildings";
import { collectQuestNeeds } from "./world/questNeeds";
import { deriveTradeServiceSnapshot } from "./world/trade";

export interface TelemetrySnapshot {
  tick: number;
  day: number;
  population: {
    total: number;
    alive: number;
    children: number;
    orphans: number;
    wards: number;
    adopted: number;
    hybridCulturePeople: number;
  };
  body: {
    injuredPeople: number;
    injuries: number;
    severeInjuries: number;
    scars: number;
    legendaryScars: number;
    augmentedPeople: number;
    augmentations: number;
    activeAugmentations: number;
    poweredAugmentations: number;
    strainedAugmentations: number;
    remains: number;
    unburiedRemains: number;
    hauntedRemains: number;
    unknownRemains: number;
  };
  societies: {
    factions: number;
    activeWars: number;
    settlements: number;
    cultures: number;
    hybridCultures: number;
  };
  organizations: {
    total: number;
    active: number;
    withLeader: number;
    memberships: number;
    uniqueMembers: number;
    assets: number;
    activeAssets: number;
    organizationOwnedAssets: number;
    organizationOperatedAssets: number;
    agreements: number;
    activeAgreements: number;
    linkedAgreementAssets: number;
  };
  builtEnvironment: {
    catalogSize: number;
    buildings: number;
    activeBuildings: number;
    damagedBuildings: number;
    borders: number;
    fortifiedBorders: number;
    fortifiedSettlements: number;
    buildOrders: number;
    queuedBuildOrders: number;
    activeBuildOrders: number;
    completedBuildOrders: number;
    serviceSlots: number;
    serviceCapacity: number;
    occupiedServiceSlots: number;
    housedPeople: number;
  };
  trade: {
    routes: number;
    pressuredRoutes: number;
    signals: number;
    highPressureSignals: number;
    escortSignals: number;
    mediationSignals: number;
    assetHints: number;
    agreementHints: number;
  };
  activity: {
    bands: number;
    travelingBands: number;
    openQuests: number;
    activeQuests: number;
    completedQuests: number;
    questNeeds: number;
    recentEvents: number;
  };
  world: {
    knownFeatures: number;
    claimedFeatures: number;
    holdings: number;
    claimedArtifacts: number;
    resonantArtifacts: number;
    activeBosses: number;
    activeCrises: number;
    territories: number;
    contestedTerritories: number;
    weatherFronts: number;
    sectors: number;
    overworldTiles: number;
    lingeringEffects: number;
    positionEntries: number;
    occupancyBuckets: number;
    settlementOccupancyBuckets: number;
    tileOccupancyBuckets: number;
    routeOccupancyBuckets: number;
    coordinateOccupancyBuckets: number;
  };
  knowledge: {
    knownRecipes: number;
    recipeStudies: number;
    knownAbilities: number;
    abilityStudies: number;
    sentientItems: number;
  };
  minds: {
    socialMinds: number;
    visibleIntents: number;
    hiddenIntents: number;
    hiddenIntentPeople: number;
    implantedIntents: number;
    compelledPeople: number;
    highPressureIntents: number;
    dominantIntentKinds: Partial<Record<SocialIntentKind, number>>;
  };
  recentEventKinds: Partial<Record<EventKind, number>>;
  invariantIssues: string[];
}

function people(world: World): Person[] {
  return Object.values(world.persons);
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter(Boolean)).size;
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function legalEntityLabel(ref: LegalEntityRef): string {
  return `${ref.kind} ${ref.id}`;
}

function hasLegalEntity(world: World, ref: LegalEntityRef): boolean {
  if (ref.kind === "person") return Boolean(world.persons[ref.id]);
  if (ref.kind === "band") return Boolean(world.bands[ref.id]);
  if (ref.kind === "faction") return Boolean(world.factions[ref.id]);
  if (ref.kind === "organization") return Boolean(world.organizations?.[ref.id]);
  return Boolean(world.settlements[ref.id]);
}

function countRecentEventKinds(world: World, windowTicks = 48): Partial<Record<EventKind, number>> {
  const minimumTick = Math.max(0, world.tick - windowTicks);
  const counts: Partial<Record<EventKind, number>> = {};
  for (const event of world.events.filter((item) => item.tick >= minimumTick)) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function countDominantIntentKinds(projections: ReturnType<typeof deriveIntentProjection>[]): Partial<Record<SocialIntentKind, number>> {
  const counts: Partial<Record<SocialIntentKind, number>> = {};
  for (const projection of projections) {
    const kind = projection.dominantSignal?.kind;
    if (kind) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

export function validateWorld(world: World): string[] {
  const issues: string[] = [];
  const factionIds = new Set(Object.keys(world.factions));
  const cultureIds = new Set(Object.keys(world.cultures));
  const settlementIds = new Set(Object.keys(world.settlements));
  const bandIds = new Set(Object.keys(world.bands));
  const organizationIds = new Set(Object.keys(world.organizations ?? {}));
  const assetIds = new Set(Object.keys(world.assets ?? {}));
  const agreementIds = new Set(Object.keys(world.agreements ?? {}));
  const regionIds = new Set(Object.keys(world.planet.regions ?? {}));
  const sectorIds = new Set(Object.keys(world.geography?.sectors ?? {}));

  if (!world.selectedBandId || !world.bands[world.selectedBandId]) {
    issues.push(`selected band ${world.selectedBandId || "(none)"} is missing`);
  }
  if (!world.selectedPersonId || !world.persons[world.selectedPersonId]) {
    issues.push(`selected person ${world.selectedPersonId || "(none)"} is missing`);
  }

  for (const faction of Object.values(world.factions)) {
    if (faction.cultureId && !cultureIds.has(faction.cultureId)) {
      issues.push(`${faction.name} points at missing culture ${faction.cultureId}`);
    }
    for (const enemyId of faction.activeWars) {
      if (!factionIds.has(enemyId)) {
        issues.push(`${faction.name} is at war with missing faction ${enemyId}`);
      }
    }
  }

  for (const culture of Object.values(world.cultures)) {
    for (const parentId of culture.parentCultureIds ?? []) {
      if (!cultureIds.has(parentId)) {
        issues.push(`${culture.name} has missing parent culture ${parentId}`);
      }
    }
  }

  for (const settlement of Object.values(world.settlements)) {
    if (!factionIds.has(settlement.factionId)) {
      issues.push(`${settlement.name} has missing faction ${settlement.factionId}`);
    }
    if (!world.planet.regions[settlement.mediumRegionId]) {
      issues.push(`${settlement.name} has missing medium region ${settlement.mediumRegionId}`);
    }
    if (settlement.sectorId && !sectorIds.has(settlement.sectorId)) {
      issues.push(`${settlement.name} has missing sector ${settlement.sectorId}`);
    }
  }

  for (const person of people(world)) {
    if (!factionIds.has(person.factionId)) {
      issues.push(`${person.name} ${person.familyName} has missing faction ${person.factionId}`);
    }
    if (person.locationId && !settlementIds.has(person.locationId)) {
      issues.push(`${person.name} ${person.familyName} has missing location ${person.locationId}`);
    }
    if (person.cultureId && !cultureIds.has(person.cultureId)) {
      issues.push(`${person.name} ${person.familyName} has missing culture ${person.cultureId}`);
    }
    if (person.birthCultureId && !cultureIds.has(person.birthCultureId)) {
      issues.push(`${person.name} ${person.familyName} has missing birth culture ${person.birthCultureId}`);
    }
    if (person.fosterCultureId && !cultureIds.has(person.fosterCultureId)) {
      issues.push(`${person.name} ${person.familyName} has missing foster culture ${person.fosterCultureId}`);
    }
    for (const guardianId of person.guardianIds ?? []) {
      if (!world.persons[guardianId]) {
        issues.push(`${person.name} ${person.familyName} has missing guardian ${guardianId}`);
      }
    }
    for (const parentId of person.parentIds ?? []) {
      const parent = world.persons[parentId];
      if (!parent) {
        issues.push(`${person.name} ${person.familyName} has missing parent ${parentId}`);
      } else if (!parent.childIds.includes(person.id)) {
        issues.push(`${parent.name} ${parent.familyName} does not list child ${person.id}`);
      }
    }
    for (const childId of person.childIds ?? []) {
      const child = world.persons[childId];
      if (!child) {
        issues.push(`${person.name} ${person.familyName} has missing child ${childId}`);
      } else if (!child.parentIds.includes(person.id)) {
        issues.push(`${person.name} ${person.familyName} lists child ${childId} without parent backref`);
      }
    }
    if (person.bandId && !bandIds.has(person.bandId)) {
      issues.push(`${person.name} ${person.familyName} has missing band ${person.bandId}`);
    }
    const membershipIds = (person.memberships ?? []).map((membership) => membership.organizationId);
    for (const duplicateId of duplicateValues(membershipIds)) {
      issues.push(`${person.name} ${person.familyName} has duplicate membership in ${duplicateId}`);
    }
    for (const membership of person.memberships ?? []) {
      const organization = world.organizations?.[membership.organizationId];
      if (!organization) {
        issues.push(`${person.name} ${person.familyName} has missing organization membership ${membership.organizationId}`);
      } else if (!organization.memberIds.includes(person.id)) {
        issues.push(`${person.name} ${person.familyName} membership does not point back from ${organization.name}`);
      }
    }
  }

  for (const band of Object.values(world.bands)) {
    if (!world.persons[band.leaderId]) {
      issues.push(`${band.name} has missing leader ${band.leaderId}`);
    }
    if (!settlementIds.has(band.locationId)) {
      issues.push(`${band.name} has missing location ${band.locationId}`);
    }
    for (const memberId of band.memberIds) {
      const member = world.persons[memberId];
      if (!member) {
        issues.push(`${band.name} has missing member ${memberId}`);
      } else if (member.bandId !== band.id) {
        issues.push(`${member.name} ${member.familyName} does not point back to ${band.name}`);
      }
    }
    if (band.travel && !world.planet.routes[band.travel.routeId]) {
      issues.push(`${band.name} is traveling on missing route ${band.travel.routeId}`);
    }
  }

  for (const organization of Object.values(world.organizations ?? {})) {
    for (const duplicateId of duplicateValues(organization.memberIds)) {
      issues.push(`${organization.name} has duplicate member ${duplicateId}`);
    }
    for (const duplicateId of duplicateValues(organization.assetIds)) {
      issues.push(`${organization.name} has duplicate asset ${duplicateId}`);
    }
    for (const duplicateId of duplicateValues(organization.agreementIds)) {
      issues.push(`${organization.name} has duplicate agreement ${duplicateId}`);
    }
    if (organization.factionId && !factionIds.has(organization.factionId)) {
      issues.push(`${organization.name} has missing faction ${organization.factionId}`);
    }
    if (organization.cultureId && !cultureIds.has(organization.cultureId)) {
      issues.push(`${organization.name} has missing culture ${organization.cultureId}`);
    }
    if (organization.homeSettlementId && !settlementIds.has(organization.homeSettlementId)) {
      issues.push(`${organization.name} has missing home settlement ${organization.homeSettlementId}`);
    }
    if (organization.leaderPersonId && !world.persons[organization.leaderPersonId]) {
      issues.push(`${organization.name} has missing leader ${organization.leaderPersonId}`);
    }
    if (organization.leaderPersonId && !organization.memberIds.includes(organization.leaderPersonId)) {
      issues.push(`${organization.name} leader ${organization.leaderPersonId} is not a member`);
    }
    for (const memberId of organization.memberIds) {
      const member = world.persons[memberId];
      if (!member) {
        issues.push(`${organization.name} has missing member ${memberId}`);
      } else if (!(member.memberships ?? []).some((membership) => membership.organizationId === organization.id)) {
        issues.push(`${organization.name} member ${memberId} does not carry membership backref`);
      }
    }
    for (const assetId of organization.assetIds) {
      const asset = world.assets?.[assetId];
      if (!asset) {
        issues.push(`${organization.name} has missing asset ${assetId}`);
      } else if (
        !(asset.owner.kind === "organization" && asset.owner.id === organization.id) &&
        !(asset.operator.kind === "organization" && asset.operator.id === organization.id)
      ) {
        issues.push(`${organization.name} lists ${asset.name} without owner or operator backref`);
      }
    }
    for (const agreementId of organization.agreementIds) {
      const agreement = world.agreements?.[agreementId];
      if (!agreement) {
        issues.push(`${organization.name} has missing agreement ${agreementId}`);
      } else if (!agreement.parties.some((party) => party.kind === "organization" && party.id === organization.id)) {
        issues.push(`${organization.name} lists ${agreement.name} without party backref`);
      }
    }
  }

  for (const asset of Object.values(world.assets ?? {})) {
    if (!hasLegalEntity(world, asset.owner)) {
      issues.push(`${asset.name} has missing owner ${legalEntityLabel(asset.owner)}`);
    }
    if (!hasLegalEntity(world, asset.operator)) {
      issues.push(`${asset.name} has missing operator ${legalEntityLabel(asset.operator)}`);
    }
    if (asset.locationId && !settlementIds.has(asset.locationId)) {
      issues.push(`${asset.name} has missing location ${asset.locationId}`);
    }
    if (asset.agreementId) {
      const agreement = world.agreements?.[asset.agreementId];
      if (!agreement) {
        issues.push(`${asset.name} has missing agreement ${asset.agreementId}`);
      } else if (!agreement.assetIds.includes(asset.id)) {
        issues.push(`${asset.name} agreement ${agreement.name} does not list asset backref`);
      }
    }
    if (asset.owner.kind === "organization" && !world.organizations?.[asset.owner.id]?.assetIds.includes(asset.id)) {
      issues.push(`${asset.name} owner organization ${asset.owner.id} does not list asset`);
    }
    if (asset.operator.kind === "organization" && !world.organizations?.[asset.operator.id]?.assetIds.includes(asset.id)) {
      issues.push(`${asset.name} operator organization ${asset.operator.id} does not list asset`);
    }
  }

  for (const agreement of Object.values(world.agreements ?? {})) {
    if (agreement.parties.length === 0) {
      issues.push(`${agreement.name} has no parties`);
    }
    for (const party of agreement.parties) {
      if (!hasLegalEntity(world, party)) {
        issues.push(`${agreement.name} has missing party ${legalEntityLabel(party)}`);
      }
      if (party.kind === "organization" && !world.organizations?.[party.id]?.agreementIds.includes(agreement.id)) {
        issues.push(`${agreement.name} organization party ${party.id} does not list agreement`);
      }
    }
    for (const duplicateId of duplicateValues(agreement.assetIds)) {
      issues.push(`${agreement.name} has duplicate asset ${duplicateId}`);
    }
    for (const assetId of agreement.assetIds) {
      if (!assetIds.has(assetId)) {
        issues.push(`${agreement.name} has missing asset ${assetId}`);
      }
    }
    if (agreement.locationId && !settlementIds.has(agreement.locationId)) {
      issues.push(`${agreement.name} has missing location ${agreement.locationId}`);
    }
    if (agreement.expiresTick !== undefined && agreement.expiresTick < agreement.signedTick) {
      issues.push(`${agreement.name} expires before it is signed`);
    }
  }

  if (organizationIds.size === 0 && (assetIds.size > 0 || agreementIds.size > 0)) {
    issues.push("assets or agreements exist without any organizations");
  }

  for (const quest of Object.values(world.quests)) {
    if (!settlementIds.has(quest.locationId)) {
      issues.push(`${quest.title} has missing location ${quest.locationId}`);
    }
    if (!factionIds.has(quest.issuerFactionId)) {
      issues.push(`${quest.title} has missing issuer ${quest.issuerFactionId}`);
    }
    if (quest.assignedBandId && !bandIds.has(quest.assignedBandId)) {
      issues.push(`${quest.title} is assigned to missing band ${quest.assignedBandId}`);
    }
  }

  for (const feature of Object.values(world.planet.features ?? {})) {
    if (!settlementIds.has(feature.nearestSettlementId)) {
      issues.push(`${feature.name} has missing nearest settlement ${feature.nearestSettlementId}`);
    }
    if (feature.holdingId && !world.planet.holdings[feature.holdingId]) {
      issues.push(`${feature.name} points at missing holding ${feature.holdingId}`);
    }
  }

  for (const territory of Object.values(world.territories ?? {})) {
    if (!factionIds.has(territory.factionId)) {
      issues.push(`${territory.name} has missing faction ${territory.factionId}`);
    }
    if (!settlementIds.has(territory.capitalId)) {
      issues.push(`${territory.name} has missing capital ${territory.capitalId}`);
    }
    for (const settlementId of territory.settlementIds) {
      if (!settlementIds.has(settlementId)) {
        issues.push(`${territory.name} has missing settlement ${settlementId}`);
      }
    }
    for (const regionId of territory.regionIds) {
      if (!regionIds.has(regionId)) {
        issues.push(`${territory.name} has missing region ${regionId}`);
      }
    }
  }

  for (const front of Object.values(world.weather?.fronts ?? {})) {
    if (!regionIds.has(front.regionId)) {
      issues.push(`${front.kind} weather has missing region ${front.regionId}`);
    }
  }

  for (const tile of Object.values(world.geography?.tiles ?? {})) {
    if (!sectorIds.has(tile.sectorId)) {
      issues.push(`${tile.id} has missing sector ${tile.sectorId}`);
    }
  }

  for (const effect of Object.values(world.lingeringEffects ?? {})) {
    if (effect.locationId && !settlementIds.has(effect.locationId)) {
      issues.push(`${effect.name} effect has missing location ${effect.locationId}`);
    }
    if (effect.routeId && !world.planet.routes[effect.routeId]) {
      issues.push(`${effect.name} effect has missing route ${effect.routeId}`);
    }
  }

  for (const remains of Object.values(world.remains ?? {})) {
    if (remains.personId && !world.persons[remains.personId]) {
      issues.push(`${remains.personName} remains point at missing person ${remains.personId}`);
    }
    if (remains.personId && world.persons[remains.personId]?.alive) {
      issues.push(`${remains.personName} remains point at living person ${remains.personId}`);
    }
    if (remains.locationId && !settlementIds.has(remains.locationId)) {
      issues.push(`${remains.personName} remains have missing location ${remains.locationId}`);
    }
    if (remains.burialLocationId && !settlementIds.has(remains.burialLocationId)) {
      issues.push(`${remains.personName} burial points at missing location ${remains.burialLocationId}`);
    }
    if (remains.factionId && !factionIds.has(remains.factionId)) {
      issues.push(`${remains.personName} remains have missing faction ${remains.factionId}`);
    }
    if (remains.claimedByFactionId && !factionIds.has(remains.claimedByFactionId)) {
      issues.push(`${remains.personName} remains have missing claimant faction ${remains.claimedByFactionId}`);
    }
    if (remains.claimedByPersonId && !world.persons[remains.claimedByPersonId]) {
      issues.push(`${remains.personName} remains have missing claimant ${remains.claimedByPersonId}`);
    }
    if (remains.cultureId && !cultureIds.has(remains.cultureId)) {
      issues.push(`${remains.personName} remains have missing culture ${remains.cultureId}`);
    }
    if (remains.graveyardAssetId) {
      const graveyard = world.assets?.[remains.graveyardAssetId];
      if (!graveyard) {
        issues.push(`${remains.personName} remains have missing graveyard ${remains.graveyardAssetId}`);
      } else if (graveyard.kind !== "graveyard") {
        issues.push(`${remains.personName} remains point at non-graveyard asset ${graveyard.name}`);
      }
    }
  }

  for (const artifact of Object.values(world.story.artifacts ?? {})) {
    if (!settlementIds.has(artifact.locationId)) {
      issues.push(`${artifact.name} has missing location ${artifact.locationId}`);
    }
    if (artifact.holderPersonId && !world.persons[artifact.holderPersonId]) {
      issues.push(`${artifact.name} has missing holder ${artifact.holderPersonId}`);
    }
    if (artifact.resonantPersonId && !world.persons[artifact.resonantPersonId]) {
      issues.push(`${artifact.name} has missing resonant person ${artifact.resonantPersonId}`);
    }
  }

  issues.push(...validateSettlementDevelopment(world));
  return issues.slice(0, 24);
}

export function collectTelemetry(world: World): TelemetrySnapshot {
  const allPeople = people(world);
  const alive = allPeople.filter((person) => person.alive);
  const items = allPeople.flatMap((person) => [
    ...(person.inventory ?? []),
    ...(person.equipment.weapon ? [person.equipment.weapon] : []),
    ...(person.equipment.armor ? [person.equipment.armor] : []),
    ...(person.equipment.trinket ? [person.equipment.trinket] : [])
  ]);
  const quests = Object.values(world.quests);
  const features = Object.values(world.planet.features ?? {});
  const artifacts = Object.values(world.story.artifacts ?? {});
  const cultures = Object.values(world.cultures);
  const organizations = Object.values(world.organizations ?? {});
  const assets = Object.values(world.assets ?? {});
  const agreements = Object.values(world.agreements ?? {});
  const memberships = allPeople.flatMap((person) => person.memberships ?? []);
  const injuries = allPeople.flatMap((person) => person.injuries ?? []);
  const scars = allPeople.flatMap((person) => person.scars ?? []);
  const augmentations = allPeople.flatMap((person) => person.augmentations ?? []);
  const remains = Object.values(world.remains ?? {});
  const occupancy = collectOccupancySnapshot(world, { includeEffects: true });
  const development = collectSettlementDevelopmentSnapshot(world);
  const intentProjections = alive.map((person) => deriveIntentProjection(world, person));
  const trade = deriveTradeServiceSnapshot(world, {
    minPressure: 50,
    maxSignals: 12,
    maxPerLocation: 2,
    maxPerRoute: 1,
    maxAssetHints: 8,
    maxAgreementHints: 8
  });

  return {
    tick: world.tick,
    day: world.day,
    population: {
      total: allPeople.length,
      alive: alive.length,
      children: alive.filter((person) => person.age < 16 || person.status.includes("child")).length,
      orphans: alive.filter((person) => person.adoptionStatus === "orphan" || person.status.includes("orphan")).length,
      wards: alive.filter((person) => person.adoptionStatus === "ward" || person.status.includes("ward")).length,
      adopted: alive.filter((person) => person.adoptionStatus === "adopted" || person.status.includes("adopted")).length,
      hybridCulturePeople: alive.filter((person) => (person.heritageCultureIds ?? []).length > 1 || person.status.includes("hybrid-culture")).length
    },
    body: {
      injuredPeople: alive.filter((person) => (person.injuries ?? []).length > 0).length,
      injuries: injuries.length,
      severeInjuries: injuries.filter((injury) => injury.severity === "severe" || injury.severity === "critical" || injury.severity === "maiming").length,
      scars: scars.length,
      legendaryScars: scars.filter((scar) => scar.severity === "legendary").length,
      augmentedPeople: alive.filter((person) => (person.augmentations ?? []).length > 0).length,
      augmentations: augmentations.length,
      activeAugmentations: augmentations.filter((augmentation) => augmentation.active).length,
      poweredAugmentations: augmentations.filter((augmentation) => augmentation.powered).length,
      strainedAugmentations: alive.filter((person) => person.status.includes("augmentation-strain") || person.status.includes("augmentation-low-power")).length,
      remains: remains.length,
      unburiedRemains: remains.filter((record) => record.burialStatus === "unburied" || record.burialStatus === "retrieving").length,
      hauntedRemains: remains.filter((record) => record.hauntingStatus === "haunted" || record.hauntingStatus === "restless").length,
      unknownRemains: remains.filter((record) => record.claimStatus === "unknown" || record.kind === "unknown" || !record.personId).length
    },
    societies: {
      factions: Object.keys(world.factions).length,
      activeWars: Math.floor(Object.values(world.factions).reduce((sum, faction) => sum + faction.activeWars.length, 0) / 2),
      settlements: Object.keys(world.settlements).length,
      cultures: cultures.length,
      hybridCultures: cultures.filter((culture) => (culture.parentCultureIds ?? []).length > 0).length
    },
    organizations: {
      total: organizations.length,
      active: organizations.filter((organization) => organization.status === "active").length,
      withLeader: organizations.filter((organization) => Boolean(organization.leaderPersonId)).length,
      memberships: memberships.length,
      uniqueMembers: allPeople.filter((person) => (person.memberships ?? []).length > 0).length,
      assets: assets.length,
      activeAssets: assets.filter((asset) => asset.status === "active").length,
      organizationOwnedAssets: assets.filter((asset) => asset.owner.kind === "organization").length,
      organizationOperatedAssets: assets.filter((asset) => asset.operator.kind === "organization").length,
      agreements: agreements.length,
      activeAgreements: agreements.filter((agreement) => agreement.status === "active").length,
      linkedAgreementAssets: uniqueCount(agreements.flatMap((agreement) => agreement.assetIds))
    },
    builtEnvironment: {
      catalogSize: development.catalogSize,
      buildings: development.buildings,
      activeBuildings: development.activeBuildings,
      damagedBuildings: development.damagedBuildings,
      borders: development.borders,
      fortifiedBorders: development.fortifiedBorders,
      fortifiedSettlements: development.fortifiedSettlements,
      buildOrders: development.buildOrders,
      queuedBuildOrders: development.queuedBuildOrders,
      activeBuildOrders: development.activeBuildOrders,
      completedBuildOrders: development.completedBuildOrders,
      serviceSlots: development.serviceSlots,
      serviceCapacity: development.serviceCapacity,
      occupiedServiceSlots: development.occupiedServiceSlots,
      housedPeople: development.housedPeople
    },
    trade: {
      routes: trade.routes.length,
      pressuredRoutes: trade.routes.filter((route) => route.pressure >= 50).length,
      signals: trade.signals.length,
      highPressureSignals: trade.signals.filter((signal) => signal.pressure >= 70 || signal.urgency >= 90).length,
      escortSignals: trade.signals.filter((signal) => signal.kind === "route-escort").length,
      mediationSignals: trade.signals.filter((signal) => signal.kind === "agreement-mediation" || signal.kind === "trade-mediation").length,
      assetHints: trade.hints.assets.length,
      agreementHints: trade.hints.agreements.length
    },
    activity: {
      bands: Object.keys(world.bands).length,
      travelingBands: Object.values(world.bands).filter((band) => Boolean(band.travel)).length,
      openQuests: quests.filter((quest) => quest.status === "open").length,
      activeQuests: quests.filter((quest) => quest.status === "active").length,
      completedQuests: quests.filter((quest) => quest.status === "succeeded").length,
      questNeeds: collectQuestNeeds(world).length,
      recentEvents: world.events.filter((event) => event.tick >= Math.max(0, world.tick - 48)).length
    },
    world: {
      knownFeatures: features.filter((feature) => feature.status !== "hidden").length,
      claimedFeatures: features.filter((feature) => feature.status === "claimed").length,
      holdings: Object.keys(world.planet.holdings ?? {}).length,
      claimedArtifacts: artifacts.filter((artifact) => artifact.status === "claimed").length,
      resonantArtifacts: artifacts.filter((artifact) => Boolean(artifact.resonantPersonId)).length,
      activeBosses: Object.values(world.story.bosses ?? {}).filter((boss) => boss.status === "active").length,
      activeCrises: Object.values(world.story.crises ?? {}).filter((crisis) => crisis.status === "active").length,
      territories: Object.keys(world.territories ?? {}).length,
      contestedTerritories: Object.values(world.territories ?? {}).filter((territory) => territory.borderPressure > 55).length,
      weatherFronts: Object.keys(world.weather?.fronts ?? {}).length,
      sectors: Object.keys(world.geography?.sectors ?? {}).length,
      overworldTiles: Object.keys(world.geography?.tiles ?? {}).length,
      lingeringEffects: Object.keys(world.lingeringEffects ?? {}).length,
      positionEntries: occupancy.entries.length,
      occupancyBuckets: occupancy.buckets.length,
      settlementOccupancyBuckets: occupancy.buckets.filter((bucket) => bucket.anchorKind === "settlement").length,
      tileOccupancyBuckets: occupancy.buckets.filter((bucket) => bucket.anchorKind === "tile").length,
      routeOccupancyBuckets: occupancy.buckets.filter((bucket) => bucket.anchorKind === "route").length,
      coordinateOccupancyBuckets: occupancy.buckets.filter((bucket) => bucket.anchorKind === "coordinate").length
    },
    knowledge: {
      knownRecipes: uniqueCount(alive.flatMap((person) => person.recipeIds ?? [])),
      recipeStudies: alive.reduce((sum, person) => sum + Object.keys(person.recipeStudy ?? {}).length, 0),
      knownAbilities: uniqueCount(alive.flatMap((person) => person.abilityIds ?? [])),
      abilityStudies: alive.reduce((sum, person) => sum + Object.keys(person.abilityStudy ?? {}).length, 0),
      sentientItems: items.filter((item) => Boolean(item.sentience)).length
    },
    minds: {
      socialMinds: alive.filter((person) => Boolean(person.social)).length,
      visibleIntents: intentProjections.reduce((sum, projection) => sum + projection.visibleIntents.length, 0),
      hiddenIntents: intentProjections.reduce((sum, projection) => sum + projection.hiddenIntents.length, 0),
      hiddenIntentPeople: intentProjections.filter((projection) => projection.hiddenIntents.length > 0).length,
      implantedIntents: alive.reduce((sum, person) => sum + (person.social?.implantedIntents ?? []).length, 0),
      compelledPeople: alive.filter((person) => Boolean(person.social?.compulsion) || person.status.includes("compelled")).length,
      highPressureIntents: intentProjections.reduce((sum, projection) => sum + projection.signals.filter((signal) => signal.score >= 70).length, 0),
      dominantIntentKinds: countDominantIntentKinds(intentProjections)
    },
    recentEventKinds: countRecentEventKinds(world),
    invariantIssues: validateWorld(world)
  };
}

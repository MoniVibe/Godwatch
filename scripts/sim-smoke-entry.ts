import { createWorld, repairLoadedWorld, tickWorld } from "../src/simulation";
import { Rng } from "../src/sim/core/rng";
import { hybridCultureForParents } from "../src/sim/society/culture";
import { createWardFromConquest, updateOrphansAndWards } from "../src/sim/society/family";
import { validateBiomeCoherency } from "../src/sim/environment/climate";
import { collectTelemetry, validateWorld } from "../src/sim/telemetry";
import type { Person, World } from "../src/sim/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertValid(world: World, label: string): void {
  const issues = validateWorld(world);
  assert(issues.length === 0, `${label} invariants failed:\n${issues.join("\n")}`);
}

function adults(world: World): Person[] {
  return Object.values(world.persons).filter((person) => person.alive && person.age >= 18);
}

function findDifferentCulturePair(world: World): [Person, Person] {
  const candidates = adults(world);
  for (const first of candidates) {
    const second = candidates.find((person) => person.id !== first.id && person.cultureId && first.cultureId && person.cultureId !== first.cultureId);
    if (second) {
      return [first, second];
    }
  }
  throw new Error("No different-culture adult pair found.");
}

function makeExistingPersonAChild(world: World, parents: [Person, Person]): Person {
  const parentIds = new Set(parents.map((parent) => parent.id));
  const child =
    Object.values(world.persons).find(
      (person) => person.alive && !person.bandId && person.role === "commoner" && !parentIds.has(person.id) && (person.childIds ?? []).length === 0
    ) ?? adults(world).find((person) => !parentIds.has(person.id) && (person.childIds ?? []).length === 0);
  assert(child, "No childless person available to convert into smoke-test child.");

  for (const oldParentId of child.parentIds ?? []) {
    const oldParent = world.persons[oldParentId];
    if (oldParent) {
      oldParent.childIds = oldParent.childIds.filter((childId) => childId !== child.id);
    }
  }
  for (const oldChildId of child.childIds ?? []) {
    const oldChild = world.persons[oldChildId];
    if (oldChild) {
      oldChild.parentIds = oldChild.parentIds.filter((parentId) => parentId !== child.id);
    }
  }

  child.age = 8;
  child.role = "commoner";
  child.status = ["child"];
  child.parentIds = parents.map((parent) => parent.id);
  child.childIds = [];
  child.factionId = parents[0].factionId;
  child.locationId = parents[0].locationId;
  child.cultureId = parents[0].cultureId;
  child.birthCultureId = parents[0].cultureId;
  child.heritageCultureIds = [parents[0].cultureId, parents[1].cultureId];
  child.cultureBlend = 0;
  child.adoptionStatus = "birth-family";
  child.guardianIds = [];
  delete child.bandId;
  for (const parent of parents) {
    parent.childIds = [...new Set([...parent.childIds, child.id])];
  }
  return child;
}

function run(): void {
  const rng = new Rng(123456);
  const world = createWorld("smoke-telemetry-heritage");
  assertValid(world, "initial world");
  const climateIssues = validateBiomeCoherency(world.geography, world.generation);
  const sectorClimateIssues = climateIssues.filter((issue) => issue.scope === "sector");
  assert(sectorClimateIssues.length === 0, `Expected coherent sector biomes:\n${sectorClimateIssues.map((issue) => `${issue.id}: ${issue.reason}`).join("\n")}`);
  assert(climateIssues.length <= Math.max(3, Object.keys(world.geography.tiles).length * 0.035), `Too many climate/biome coherency issues: ${climateIssues.length}`);

  const initialTelemetry = collectTelemetry(world);
  assert(initialTelemetry.population.alive > 0, "Expected living people.");
  assert(initialTelemetry.societies.cultures > 0, "Expected cultures.");
  assert(initialTelemetry.world.knownFeatures > 0, "Expected known terrain features.");
  assert(initialTelemetry.world.activeBosses > 0, "Expected active bosses.");
  assert(initialTelemetry.world.territories > 0, "Expected seeded territories.");
  assert(initialTelemetry.world.weatherFronts >= 0, "Expected weather telemetry.");
  assert(initialTelemetry.world.positionEntries >= initialTelemetry.population.alive, "Expected occupancy positions for living people.");
  assert(initialTelemetry.world.occupancyBuckets > 0, "Expected occupancy buckets.");
  assert(initialTelemetry.knowledge.knownRecipes > 0, "Expected known recipes.");
  assert(initialTelemetry.minds.visibleIntents >= initialTelemetry.population.alive, "Expected visible intent projections for living people.");
  assert(initialTelemetry.body.injuries >= 0, "Expected body telemetry.");
  assert(initialTelemetry.body.augmentations >= 0, "Expected augmentation telemetry.");
  assert(initialTelemetry.activity.questNeeds > 0, "Expected derived quest needs.");
  assert(initialTelemetry.organizations.total > 0, "Expected seeded organizations.");
  assert(initialTelemetry.organizations.assets > 0, "Expected seeded organization assets.");
  assert(initialTelemetry.organizations.agreements > 0, "Expected seeded organization agreements.");
  assert(initialTelemetry.organizations.memberships > 0, "Expected seeded organization memberships.");
  assert(initialTelemetry.organizations.organizationOwnedAssets > 0, "Expected organization-owned assets.");
  assert(initialTelemetry.trade.routes > 0, "Expected trade route telemetry.");
  assert(initialTelemetry.builtEnvironment.catalogSize >= 12, "Expected settlement building catalog telemetry.");
  assert(initialTelemetry.builtEnvironment.buildings >= initialTelemetry.societies.settlements, "Expected seeded settlement buildings.");
  assert(initialTelemetry.builtEnvironment.borders >= initialTelemetry.societies.settlements, "Expected settlement border telemetry.");

  tickWorld(world, 72);
  assertValid(world, "post-tick world");

  const pair = findDifferentCulturePair(world);
  const hybrid = hybridCultureForParents(world, pair[0], pair[1], rng, pair[0].factionId);
  assert(hybrid, "Expected hybrid culture creation.");
  assert((hybrid.parentCultureIds ?? []).length === 2, "Hybrid culture should record both parent cultures.");

  const child = makeExistingPersonAChild(world, pair);
  const conqueror = Object.values(world.factions).find((faction) => faction.id !== child.factionId && adults(world).some((person) => person.factionId === faction.id));
  assert(conqueror, "Expected conqueror faction with an adult guardian.");
  const warded = createWardFromConquest(world, child, conqueror.id, child.locationId, rng);
  assert(warded, "Expected conquest warding to assign a guardian.");
  assert(child.adoptionStatus === "ward", "Child should become a ward.");
  assert(child.guardianIds.length > 0, "Ward should have a guardian.");

  for (let index = 0; index < 8; index += 1) {
    updateOrphansAndWards(world, rng);
  }

  const telemetry = collectTelemetry(world);
  assert(telemetry.population.wards >= 1, "Telemetry should count wards.");
  assert(telemetry.societies.hybridCultures >= 1, "Telemetry should count hybrid cultures.");
  assert(telemetry.organizations.total >= initialTelemetry.organizations.total, "Telemetry should preserve organization count.");
  assert(telemetry.organizations.assets >= initialTelemetry.organizations.assets, "Telemetry should preserve asset count.");
  assert(telemetry.organizations.agreements >= initialTelemetry.organizations.agreements, "Telemetry should preserve agreement count.");
  assert(telemetry.organizations.organizationOwnedAssets >= initialTelemetry.organizations.organizationOwnedAssets, "Telemetry should preserve organization-owned assets.");
  assert(telemetry.builtEnvironment.buildings >= initialTelemetry.builtEnvironment.buildings, "Telemetry should preserve settlement buildings.");
  assert(telemetry.builtEnvironment.borders >= telemetry.societies.settlements, "Telemetry should preserve settlement borders.");
  assert(telemetry.invariantIssues.length === 0, `Telemetry should be clean:\n${telemetry.invariantIssues.join("\n")}`);

  const repaired = repairLoadedWorld(JSON.parse(JSON.stringify(world)));
  assert(repaired, "Serialized world should repair.");
  assertValid(repaired, "repaired world");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tick: telemetry.tick,
        alive: telemetry.population.alive,
        injuredPeople: telemetry.body.injuredPeople,
        scars: telemetry.body.scars,
        augmentedPeople: telemetry.body.augmentedPeople,
        activeAugmentations: telemetry.body.activeAugmentations,
        wards: telemetry.population.wards,
        hybridCultures: telemetry.societies.hybridCultures,
        knownRecipes: telemetry.knowledge.knownRecipes,
        visibleIntents: telemetry.minds.visibleIntents,
        hiddenIntentPeople: telemetry.minds.hiddenIntentPeople,
        highPressureIntents: telemetry.minds.highPressureIntents,
        organizations: telemetry.organizations.total,
        memberships: telemetry.organizations.memberships,
        assets: telemetry.organizations.assets,
        organizationOwnedAssets: telemetry.organizations.organizationOwnedAssets,
        agreements: telemetry.organizations.agreements,
        linkedAgreementAssets: telemetry.organizations.linkedAgreementAssets,
        tradeRoutes: telemetry.trade.routes,
        tradeSignals: telemetry.trade.signals,
        tradeAssetHints: telemetry.trade.assetHints,
        tradeAgreementHints: telemetry.trade.agreementHints,
        settlementBuildings: telemetry.builtEnvironment.buildings,
        settlementBorders: telemetry.builtEnvironment.borders,
        buildOrders: telemetry.builtEnvironment.buildOrders,
        questNeeds: telemetry.activity.questNeeds,
        territories: telemetry.world.territories,
        weatherFronts: telemetry.world.weatherFronts,
        positionEntries: telemetry.world.positionEntries,
        occupancyBuckets: telemetry.world.occupancyBuckets,
        routeOccupancyBuckets: telemetry.world.routeOccupancyBuckets,
        climateIssues: climateIssues.length,
        events: telemetry.activity.recentEvents
      },
      null,
      2
    )
  );
}

run();

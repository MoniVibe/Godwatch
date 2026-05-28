import { createWorld, repairLoadedWorld, tickWorld } from "../src/simulation";
import { event } from "../src/sim/chronicle/events";
import { simulateCombat } from "../src/sim/combat/combat";
import { Rng } from "../src/sim/core/rng";
import { deriveAlloyProfile, deriveMaterialItemAdjustments, ensureItemMaterialProfile, ensureItemPowerCell, ensurePersonResources } from "../src/sim/economy/power";
import { computeAugmentationEffects, deriveInjuryBurden, installAugmentation, payAugmentationUpkeep, tickAugmentations } from "../src/sim/individuals/augmentations";
import { attemptMindCompulsion, teachAbility, tickInfluenceState } from "../src/sim/individuals/influence";
import { classifyRelationStance, deriveLoyaltyState, derivePersonEmotionalState } from "../src/sim/individuals/moods";
import { summarizeBandEmotionalClimate } from "../src/sim/society/emotionalClimate";
import { createWardFromConquest } from "../src/sim/society/family";
import { collectTelemetry, validateWorld } from "../src/sim/telemetry";
import { deriveWorldClock, TICKS_PER_DAY, TICKS_PER_HOUR } from "../src/sim/world/calendar";
import {
  advanceSettlementConstruction,
  buildingCatalog,
  collectSettlementBuildSignals,
  ensureSettlementDevelopment,
  issueSettlementBuildOrders,
  updateSettlementBuildingServices
} from "../src/sim/world/buildings";
import { ensureLocalMapForSettlement, validLocalTileIdForMap } from "../src/sim/world/localMap";
import { collectOccupancySnapshot } from "../src/sim/world/occupancy";
import { createRenderSnapshot, snapshotDebugSummary } from "../src/view/snapshot";
import type {
  AssetKind,
  Band,
  ChronicleEvent,
  Item,
  Person,
  Quest,
  SettlementBorder,
  SettlementBuildOrder,
  SettlementBuilding,
  SettlementBuildingKind,
  SkillKey,
  World
} from "../src/sim/types";

interface ScenarioResult {
  name: string;
  events: number;
  detail: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function scenario(name: string, run: () => string): ScenarioResult {
  const detail = run();
  return { name, events: 1, detail };
}

function assertValid(world: World, label: string): void {
  const issues = validateWorld(world);
  assert(issues.length === 0, `${label} invariants failed:\n${issues.join("\n")}`);
}

function firstBand(world: World): Band {
  const band = Object.values(world.bands)[0];
  assert(band, "Expected at least one band.");
  return band;
}

function makeQuest(world: World, band: Band, danger: number): Quest {
  const settlement = world.settlements[band.locationId];
  assert(settlement, "Expected band settlement.");
  return {
    id: `scenario-quest-${world.tick}-${danger}`,
    title: `Scenario Fight ${danger}`,
    kind: "hunt",
    issuerFactionId: settlement.factionId,
    locationId: settlement.id,
    danger,
    rewardGold: 0,
    rewardRenown: 0,
    urgency: 100,
    progress: 0,
    status: "active",
    assignedBandId: band.id,
    summary: "Micro-scenario combat fixture."
  };
}

function weakenSoloBand(seed: number): { world: World; band: Band; leader: Person; quest: Quest } {
  const world = createWorld(`micro-combat-${seed}`);
  const band = firstBand(world);
  const leader = world.persons[band.leaderId];
  assert(leader, "Expected band leader.");

  for (const memberId of band.memberIds) {
    const member = world.persons[memberId];
    if (member && member.id !== leader.id) {
      member.bandId = undefined;
    }
  }

  band.memberIds = [leader.id];
  band.supplies = 0;
  leader.alive = true;
  leader.hp = 6;
  leader.maxHp = 24;
  leader.mana = 0;
  leader.maxMana = 0;
  leader.fatigue = 0;
  leader.morale = 45;
  leader.inventory = [];
  leader.equipment = {};
  leader.status = [];
  leader.abilityIds = ["rough-strike"];
  leader.abilityStudy = {};
  for (const key of Object.keys(leader.skills) as SkillKey[]) {
    leader.skills[key] = 1;
  }
  leader.stats.core = { physique: 1, finesse: 1, willpower: 1 };
  leader.stats.derived = {
    strength: 2,
    dexterity: 2,
    endurance: 2,
    intelligence: 2,
    wisdom: 2,
    perception: 2,
    charisma: 2
  };
  world.doctrine = {
    targetPolicy: "weakest",
    healBelow: 1,
    aoeAt: 6,
    spendConsumables: "sparingly",
    retreatBelow: 0,
    riskStance: "bold",
    preferredQuest: "any"
  };
  return { world, band, leader, quest: makeQuest(world, band, 98) };
}

function newEvents(world: World, before: number): ChronicleEvent[] {
  return world.events.slice(0, Math.max(0, world.events.length - before));
}

function adults(world: World): Person[] {
  return Object.values(world.persons).filter((person) => person.alive && person.age >= 18);
}

function makeScenarioChild(world: World): Person {
  const parents = adults(world).slice(0, 2);
  assert(parents.length === 2, "Expected two adult parents.");
  const child =
    Object.values(world.persons).find((person) => person.alive && !person.bandId && person.role === "commoner" && !parents.some((parent) => parent.id === person.id)) ??
    adults(world).find((person) => !parents.some((parent) => parent.id === person.id));
  assert(child, "Expected available scenario child.");
  child.age = 8;
  child.role = "commoner";
  child.status = ["child"];
  child.parentIds = parents.map((parent) => parent.id);
  child.childIds = [];
  child.factionId = parents[0].factionId;
  child.locationId = parents[0].locationId;
  child.cultureId = parents[0].cultureId;
  child.birthCultureId = parents[0].cultureId;
  child.heritageCultureIds = [...new Set(parents.map((parent) => parent.cultureId))];
  child.adoptionStatus = "birth-family";
  child.guardianIds = [];
  child.cultureBlend = 0;
  delete child.bandId;
  for (const parent of parents) {
    parent.childIds = [...new Set([...parent.childIds, child.id])];
  }
  return child;
}

const results: ScenarioResult[] = [];

results.push(
  scenario("combat emits and damages", () => {
    const { world, band, leader, quest } = weakenSoloBand(10);
    const beforeEvents = world.events.length;
    const beforeHp = leader.hp;
    const result = simulateCombat(world, band, quest, new Rng(10));
    const emitted = newEvents(world, beforeEvents);
    assert(emitted.some((item) => item.kind === "combat"), "Expected combat event emission.");
    assert(leader.hp < beforeHp || !leader.alive || leader.status.includes("wounded"), "Expected HP loss, wound, or death.");
    assert(["victory", "retreat", "defeat"].includes(result), `Unexpected combat result ${result}.`);
    assertValid(world, "combat damage scenario");
    return `${result}; hp ${beforeHp}->${leader.hp}; events ${emitted.length}`;
  })
);

results.push(
  scenario("death path is reachable", () => {
    let found: { seed: number; text: string } | undefined;
    for (let seed = 1; seed <= 900; seed += 1) {
      const { world, band, leader, quest } = weakenSoloBand(seed);
      leader.hp = 1;
      leader.status = ["wounded"];
      const beforeEvents = world.events.length;
      simulateCombat(world, band, quest, new Rng(seed));
      const emitted = newEvents(world, beforeEvents);
      if (!leader.alive) {
        found = { seed, text: emitted[0]?.text ?? "death without event text" };
        assert(emitted.some((item) => item.kind === "combat"), "Death scenario should emit combat event.");
        assertValid(world, "combat death scenario");
        break;
      }
    }
    assert(found, "Expected at least one deterministic death path within seed budget.");
    return `seed ${found.seed}; ${found.text}`;
  })
);

results.push(
  scenario("telemetry counts emitted events", () => {
    const world = createWorld("micro-telemetry-event");
    const before = collectTelemetry(world).recentEventKinds.divine ?? 0;
    event(world, "divine", "low", "Scenario telemetry marker");
    const after = collectTelemetry(world).recentEventKinds.divine ?? 0;
    assert(after === before + 1, `Expected divine event count ${before + 1}, got ${after}.`);
    assertValid(world, "telemetry event scenario");
    return `divine events ${before}->${after}`;
  })
);

results.push(
  scenario("organizations seed and asset needs become quests", () => {
    const world = createWorld("micro-organizations-need-lane");
    const organizations = Object.values(world.organizations ?? {});
    const assets = Object.values(world.assets ?? {});
    const agreements = Object.values(world.agreements ?? {});
    const member = Object.values(world.persons).find((person) => (person.memberships ?? []).length > 0);
    assert(organizations.length > 0, "Expected default organizations.");
    assert(assets.length > 0, "Expected default organization assets.");
    assert(agreements.length > 0, "Expected default organization agreements.");
    assert(member, "Expected at least one person with organization membership.");

    const feature = Object.values(world.planet.features ?? {})[0];
    assert(feature, "Expected generated terrain feature.");
    const settlement = world.settlements[feature.nearestSettlementId];
    assert(settlement, "Expected feature settlement.");
    const holding = {
      id: "scenario-holding-mine",
      name: `${feature.name} Scenario Mine`,
      kind: "mine" as const,
      status: "active" as const,
      featureId: feature.id,
      factionId: settlement.factionId,
      level: 1,
      integrity: 42,
      workers: 12,
      garrison: 0,
      stockpile: 0,
      outputResource: feature.resources[0] ?? "ore"
    };
    world.planet.holdings[holding.id] = holding;

    world.quests = {};
    world.tick = TICKS_PER_DAY * 2 - 1;
    world.day = 2;
    feature.holdingId = holding.id;
    feature.status = "claimed";
    feature.fauna = ["warg spiders"];
    feature.threats = ["warg spiders"];
    feature.danger = 96;
    feature.stability = 20;
    feature.ownerFactionId = holding.factionId;
    settlement.threat = 72;

    tickWorld(world, 1);
    const needQuest = Object.values(world.quests).find((quest) => quest.title.startsWith("Clear ") && quest.locationId === settlement.id);
    assert(needQuest, "Expected daily quest-need lane to materialize a mine fauna quest.");
    assertValid(world, "organization quest need scenario");
    return `${organizations.length} organizations; ${assets.length} assets; quest ${needQuest.title}`;
  })
);

results.push(
  scenario("settlement construction queues and completes defenses", () => {
    const world = createWorld("micro-settlement-construction");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");
    const defensiveKinds = new Set<SettlementBuildingKind>(["watchtower", "palisade", "wall", "gatehouse", "barracks"]);
    settlement.population = Math.max(settlement.population, 1200);
    settlement.prosperity = Math.max(settlement.prosperity, 70);
    settlement.threat = 96;
    settlement.defense = 4;
    settlement.buildings = (settlement.buildings ?? []).filter((building) => !defensiveKinds.has(building.catalogId));
    settlement.borders = [];
    settlement.buildOrders = [];

    const signals = collectSettlementBuildSignals(world, {
      minPressure: 42,
      maxSignals: 8,
      maxPerSettlement: 4
    }).filter((signal) => signal.settlementId === settlement.id);
    const defenseSignal = signals.find((signal) => defensiveKinds.has(signal.catalogId));
    assert(defenseSignal, "Expected high-threat settlement to emit a defensive build signal.");

    const issued = issueSettlementBuildOrders(world, {
      minPressure: 42,
      maxSignals: 8,
      maxPerSettlement: 4,
      maxNewOrders: 1
    });
    const order = issued.find((candidate) => candidate.catalogId === defenseSignal.catalogId) ?? issued[0];
    assert(order, "Expected collective AI to issue a build order.");
    assert(defensiveKinds.has(order.catalogId), `Expected defensive order, got ${order.catalogId}.`);

    let completed = false;
    for (let index = 0; index < 40 && !completed; index += 1) {
      const result = advanceSettlementConstruction(world, { maxActivePerSettlement: 1 });
      completed = result.completed.some((candidate) => candidate.id === order.id);
    }
    assert(completed, "Expected construction labor to complete the defensive order.");
    assert(settlement.buildings.some((building) => building.catalogId === order.catalogId && building.status === "active"), "Expected completed order to create active building.");
    assert(settlement.buildOrders?.some((candidate) => candidate.id === order.id && candidate.status === "complete"), "Expected order to remain as completed history.");
    assert((settlement.borders ?? []).length >= 1, "Expected settlement borders after construction.");
    assert(settlement.defense > 4, "Expected completed defense building to improve defense.");
    assertValid(world, "settlement construction scenario");
    const completedOrder = settlement.buildOrders?.find((candidate) => candidate.id === order.id);
    return `${settlement.name}: ${order.catalogId} ${completedOrder?.progress ?? order.progress}% defense ${settlement.defense} borders ${settlement.borders?.length ?? 0}`;
  })
);

results.push(
  scenario("service construction creates persistent asset", () => {
    const world = createWorld("micro-settlement-service-asset");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");

    const catalogId: SettlementBuildingKind = "forge";
    const assetKind: AssetKind = "forge";
    const definition = buildingCatalog[catalogId];
    assert(definition, "Expected forge building definition.");

    settlement.population = Math.max(settlement.population, 900);
    settlement.prosperity = Math.max(settlement.prosperity, 72);
    settlement.threat = Math.min(settlement.threat, 18);
    settlement.unrest = Math.min(settlement.unrest, 8);
    settlement.resources = [...new Set(["iron ore", "charcoal", ...settlement.resources])];
    settlement.buildings = (settlement.buildings ?? []).filter((building) => building.catalogId !== catalogId);
    settlement.buildOrders = (settlement.buildOrders ?? []).filter((candidate) => candidate.catalogId !== catalogId);

    const existingAsset = Object.values(world.assets ?? {}).find((asset) => asset.locationId === settlement.id && asset.kind === assetKind);
    const beforeAssetCount = Object.keys(world.assets ?? {}).length;
    const existingAssetId = existingAsset?.id;
    if (existingAsset) {
      existingAsset.status = "damaged";
      existingAsset.integrity = 12;
      existingAsset.value = 1;
      existingAsset.outputTags = [];
    }

    const order: SettlementBuildOrder = {
      id: `scenario-service-build-${settlement.id}-${catalogId}`,
      catalogId,
      kind: catalogId,
      category: definition.category,
      name: `Build ${definition.name}`,
      status: "queued",
      priority: 100,
      pressure: 100,
      reason: "scenario completes a service building into an economic asset",
      progress: 0,
      laborRequired: 1,
      laborInvested: 0,
      cost: definition.cost,
      createdTick: world.tick,
      tags: ["scenario", "service", catalogId]
    };
    settlement.buildOrders = [...(settlement.buildOrders ?? []), order];

    const result = advanceSettlementConstruction(world, { maxActivePerSettlement: 1 });
    assert(result.completed.some((candidate) => candidate.id === order.id), "Expected service build order to complete.");

    const building = settlement.buildings?.find((candidate) => candidate.catalogId === catalogId);
    assert(building?.status === "active", "Expected completed forge building to be active.");
    const asset = Object.values(world.assets ?? {}).find((candidate) => candidate.locationId === settlement.id && candidate.kind === assetKind);
    assert(asset, "Expected completed forge building to create or activate a persistent economic asset.");
    assert(asset.status === "active", "Expected service asset to be active.");
    assert(asset.tags.includes("settlement-building") && asset.tags.includes(catalogId), "Expected service asset to be tagged from settlement construction.");
    assert(asset.outputTags.includes("arms") && asset.outputTags.includes("tools"), "Expected forge asset to expose economic output tags.");

    const afterAssetCount = Object.keys(world.assets ?? {}).length;
    if (existingAssetId) {
      assert(asset.id === existingAssetId, "Expected completion to activate existing service asset instead of duplicating it.");
      assert(afterAssetCount === beforeAssetCount, "Expected existing service asset activation to preserve asset count.");
      assert(asset.integrity > 12 && asset.value > 1, "Expected activated service asset to restore integrity and value.");
    } else {
      assert(afterAssetCount === beforeAssetCount + 1, "Expected service building completion to create one persistent asset.");
      assert(asset.owner.kind === "faction" && asset.owner.id === settlement.factionId, "Expected created service asset to be faction-owned.");
      assert(asset.operator.kind === "settlement" && asset.operator.id === settlement.id, "Expected created service asset to be settlement-operated.");
    }

    assertValid(world, "settlement service asset scenario");
    return `${settlement.name}: ${catalogId} -> ${asset.kind} asset ${asset.status}; assets ${beforeAssetCount}->${afterAssetCount}`;
  })
);

results.push(
  scenario("settlement local map bounds repair", () => {
    const world = createWorld("micro-settlement-local-map-bounds");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");
    ensureSettlementDevelopment(world);

    const map = ensureLocalMapForSettlement(settlement, world.tick);
    assert(map.width > 0 && map.height > 0, "Expected settlement local map dimensions.");
    assert(validLocalTileIdForMap(settlement.id, map, map.entranceTileId), "Expected settlement local map entrance in bounds.");

    for (const building of settlement.buildings ?? []) {
      assert(building.footprint, `Expected ${building.name} to have a footprint.`);
      for (const tileId of building.footprint.tileIds) {
        assert(validLocalTileIdForMap(settlement.id, map, tileId), `Expected ${building.name} footprint tile to be in bounds.`);
      }
    }

    const building = settlement.buildings?.find((candidate) => candidate.status === "active" && (candidate.services?.length ?? 0) > 0);
    assert(building?.footprint, "Expected active service building with footprint.");
    const service = building.services?.[0];
    assert(service, "Expected service slot.");
    const person =
      Object.values(world.persons).find((candidate) => candidate.alive && !candidate.bandId && candidate.locationId === settlement.id) ??
      Object.values(world.persons).find((candidate) => candidate.alive);
    assert(person, "Expected local person fixture.");
    person.locationId = settlement.id;
    person.bandId = undefined;
    person.buildingId = building.id;
    person.currentService = service.kind;
    person.localTileId = "local-tile:invalid:surface:9999:9999";
    service.occupantIds = [person.id];
    building.occupantIds = [person.id];

    ensureSettlementDevelopment(world);
    const repairedBuilding = settlement.buildings?.find((candidate) => candidate.id === building.id);
    assert(repairedBuilding?.footprint, "Expected repaired building footprint.");
    assert(person.localTileId, "Expected invalid assigned person local tile to repair.");
    assert(repairedBuilding.footprint.tileIds.includes(person.localTileId), "Expected repaired assigned person local tile inside building footprint.");
    assert(validLocalTileIdForMap(settlement.id, ensureLocalMapForSettlement(settlement, world.tick), person.localTileId), "Expected repaired assigned person local tile in bounds.");

    const telemetry = collectTelemetry(world);
    assert(telemetry.invariantIssues.length === 0, `Expected telemetry-clean local map repair world:\n${telemetry.invariantIssues.join("\n")}`);
    assertValid(world, "settlement local map repair scenario");
    return `${settlement.name}: ${map.kind} ${map.width}x${map.height}; repaired ${person.name} to ${person.localTileId}`;
  })
);

results.push(
  scenario("render snapshot is read-only and deterministic", () => {
    const world = createWorld("micro-render-snapshot-readonly");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");
    ensureSettlementDevelopment(world);

    const before = JSON.stringify(world);
    const snapshot = createRenderSnapshot(world, { mode: "local", overlay: "biomes", selectedSettlementId: settlement.id });
    const repeat = createRenderSnapshot(world, { mode: "local", overlay: "biomes", selectedSettlementId: settlement.id });
    const after = JSON.stringify(world);

    assert(after === before, "Expected render snapshot creation not to mutate world.");
    assert(JSON.stringify(snapshotDebugSummary(snapshot)) === JSON.stringify(snapshotDebugSummary(repeat)), "Expected stable snapshot summary for the same world state.");
    assert(snapshot.tick === world.tick && snapshot.day === world.day, "Expected snapshot clock to mirror world clock.");
    assert(snapshot.camera.mode === "local" && snapshot.camera.overlay === "biomes", "Expected requested snapshot camera state.");
    assert(snapshot.selections.settlementId === settlement.id, "Expected snapshot to preserve selected settlement.");
    assert(snapshot.settlements.length === Object.keys(world.settlements).length, "Expected snapshot settlement list.");
    assert(snapshot.local?.map?.settlementId === settlement.id, "Expected local snapshot map for selected settlement.");
    assert((snapshot.local?.buildings.length ?? 0) === (settlement.buildings?.length ?? 0), "Expected local snapshot buildings.");
    assert(snapshot.entities.some((entry) => entry.subjectKind === "settlement" && entry.subjectId === settlement.id), "Expected settlement occupancy in render snapshot.");
    assert(snapshot.occupancyBuckets.length > 0, "Expected render snapshot occupancy buckets.");
    assertValid(world, "render snapshot scenario");

    return `snapshot ${snapshot.camera.mode}; settlements ${snapshot.settlements.length}; entities ${snapshot.entities.length}; local ${snapshot.local?.map?.width}x${snapshot.local?.map?.height}`;
  })
);

results.push(
  scenario("render snapshot carries selected band position", () => {
    const world = createWorld("micro-render-snapshot-band-position");
    const band = firstBand(world);
    const settlement = world.settlements[band.locationId];
    assert(settlement, "Expected selected band settlement.");

    const before = JSON.stringify(world);
    const snapshot = createRenderSnapshot(world, { mode: "region", overlay: "political", selectedBandId: band.id, selectedSettlementId: settlement.id });
    const repeat = createRenderSnapshot(world, { mode: "region", overlay: "political", selectedBandId: band.id, selectedSettlementId: settlement.id });
    const after = JSON.stringify(world);

    const bandEntity = snapshot.entities.find((entry) => entry.subjectKind === "band" && entry.subjectId === band.id);
    const repeatedBandEntity = repeat.entities.find((entry) => entry.subjectKind === "band" && entry.subjectId === band.id);

    assert(after === before, "Expected selected band render snapshot creation not to mutate world.");
    assert(snapshot.selections.bandId === band.id, "Expected render snapshot selection to carry selected band id.");
    assert(bandEntity, "Expected selected band entity in render snapshot.");
    assert(repeatedBandEntity, "Expected selected band entity in repeated render snapshot.");
    assert(Number.isFinite(bandEntity.x) && Number.isFinite(bandEntity.y), "Expected selected band snapshot coordinates to be finite.");
    assert(bandEntity.subjectKind === "band" && bandEntity.subjectId === band.id, "Expected selected band entity identity.");
    assert(["settlement", "route", "tile"].includes(bandEntity.anchorKind), `Expected selected band anchor to be settlement, route, or tile; got ${bandEntity.anchorKind}.`);
    assert(bandEntity.x === repeatedBandEntity.x && bandEntity.y === repeatedBandEntity.y, "Expected selected band snapshot coordinates to be stable.");
    assert(JSON.stringify(snapshotDebugSummary(snapshot)) === JSON.stringify(snapshotDebugSummary(repeat)), "Expected selected band snapshot summary to be stable.");
    assertValid(world, "render snapshot selected band position scenario");

    return `${band.name}: ${bandEntity.anchorKind} ${bandEntity.x.toFixed(3)},${bandEntity.y.toFixed(3)} selected ${snapshot.selections.bandId}`;
  })
);

results.push(
  scenario("world render snapshot carries terrain and routes read-only", () => {
    const world = createWorld("micro-world-render-snapshot-stability");
    const before = JSON.stringify(world);
    const snapshot = createRenderSnapshot(world, { mode: "world", overlay: "biomes" });
    const repeat = createRenderSnapshot(world, { mode: "world", overlay: "biomes" });
    const after = JSON.stringify(world);

    assert(after === before, "Expected world render snapshot creation not to mutate world.");
    assert(JSON.stringify(snapshotDebugSummary(snapshot)) === JSON.stringify(snapshotDebugSummary(repeat)), "Expected stable world snapshot summary for the same world state.");
    assert(snapshot.camera.mode === "world" && snapshot.camera.overlay === "biomes", "Expected requested world snapshot camera state.");
    assert(snapshot.sectors.length === Object.keys(world.geography.sectors).length, "Expected world snapshot to include all sectors.");
    assert(snapshot.tiles.length === Object.keys(world.geography.tiles).length, "Expected world snapshot to include all tiles.");
    assert(snapshot.routes.length === Object.keys(world.planet.routes).length, "Expected world snapshot to include all routes.");
    assert(snapshot.sectors.length > 0, "Expected world snapshot sectors.");
    assert(snapshot.tiles.length > 0, "Expected world snapshot tiles.");
    assert(snapshot.routes.length > 0, "Expected world snapshot routes.");
    assertValid(world, "world render snapshot stability scenario");

    return `world snapshot sectors ${snapshot.sectors.length}; tiles ${snapshot.tiles.length}; routes ${snapshot.routes.length}`;
  })
);

results.push(
  scenario("world clock uses 360 ticks per day", () => {
    const dawn = deriveWorldClock(0);
    const hourOne = deriveWorldClock(TICKS_PER_HOUR);
    const dusk = deriveWorldClock(TICKS_PER_HOUR * 12);
    const nextDay = deriveWorldClock(TICKS_PER_DAY);
    const world = createWorld("micro-world-clock-cadence");
    tickWorld(world, TICKS_PER_HOUR);
    const snapshot = createRenderSnapshot(world, { mode: "world", overlay: "biomes" });

    assert(TICKS_PER_DAY === 360, `Expected 360 ticks per day, got ${TICKS_PER_DAY}.`);
    assert(TICKS_PER_HOUR === 15, `Expected 15 ticks per hour, got ${TICKS_PER_HOUR}.`);
    assert(dawn.day === 1 && dawn.timeLabel === "06:00" && dawn.phase === "dawn", `Expected tick 0 dawn at 06:00, got ${dawn.phase} ${dawn.timeLabel}.`);
    assert(hourOne.day === 1 && hourOne.timeLabel === "07:00" && hourOne.phase === "day", `Expected tick 15 day at 07:00, got ${hourOne.phase} ${hourOne.timeLabel}.`);
    assert(dusk.timeLabel === "18:00" && dusk.phase === "dusk", `Expected half-day to be dusk at 18:00, got ${dusk.phase} ${dusk.timeLabel}.`);
    assert(nextDay.day === 2 && nextDay.tickInDay === 0 && nextDay.timeLabel === "06:00", `Expected tick 360 to wrap to day 2 dawn, got day ${nextDay.day} ${nextDay.timeLabel}.`);
    assert(world.tick === TICKS_PER_HOUR && world.day === 1, `Expected first simulated hour to stay on day 1, got day ${world.day} tick ${world.tick}.`);
    assert(snapshot.clock.timeLabel === "07:00" && snapshot.clock.phase === "day", "Expected render snapshot clock to mirror shared cadence.");
    assertValid(world, "world clock cadence scenario");

    return `${TICKS_PER_DAY}/day; tick ${world.tick} ${snapshot.clock.dayLabel} ${snapshot.clock.timeLabel} ${snapshot.clock.phase}`;
  })
);

results.push(
  scenario("building service assigns local occupant and tile", () => {
    const world = createWorld("micro-building-service-occupancy");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");
    ensureSettlementDevelopment(world);

    const building =
      settlement.buildings?.find((candidate) => candidate.status === "active" && candidate.services?.some((service) => service.kind === "craft")) ??
      settlement.buildings?.find((candidate) => candidate.status === "active" && (candidate.services?.length ?? 0) > 0);
    assert(building, "Expected active settlement building with service slots.");
    const service = building.services?.find((candidate) => candidate.kind === "craft") ?? building.services?.[0];
    assert(service, "Expected building service slot.");
    assert(service.capacity > 0, "Expected service capacity.");
    const footprint = building.footprint;
    assert(footprint, "Expected active service building footprint.");
    assert(footprint.width > 0 && footprint.height > 0, "Expected active service building footprint to have positive dimensions.");
    assert(footprint.tileIds.length > 0, "Expected active service building footprint to include local tiles.");
    const tileId = footprint.tileIds[0];
    assert(tileId, "Expected building footprint local tile.");

    settlement.buildings = [building];
    const person =
      Object.values(world.persons).find((candidate) => candidate.alive && !candidate.bandId && candidate.locationId === settlement.id) ??
      Object.values(world.persons).find((candidate) => candidate.alive);
    assert(person, "Expected non-band local person candidate.");
    person.locationId = settlement.id;
    person.bandId = undefined;
    person.skills.survival = 100;
    person.stats.derived.dexterity = 100;
    person.stats.derived.intelligence = 100;
    person.traits.curiosity = 100;
    person.fatigue = 100;
    person.hp = Math.max(1, Math.min(person.hp, Math.floor(person.maxHp * 0.45)));
    delete person.buildingId;
    delete person.localTileId;
    delete person.currentService;
    building.occupantIds = [];
    service.occupantIds = [];
    service.lastSimulatedTick = 0;

    const serviceResult = updateSettlementBuildingServices(world, { cadenceTicks: 1, maxOccupantsPerBuilding: 4 });
    assert(serviceResult.servicedBuildings >= 1, "Expected service simulation to process the building.");
    assert(serviceResult.occupiedServiceSlots >= 1, "Expected service simulation to assign at least one occupant.");

    ensureSettlementDevelopment(world);
    const repairedBuilding = settlement.buildings?.find((candidate) => candidate.id === building.id);
    const repairedService = repairedBuilding?.services?.find((candidate) => candidate.kind === service.kind);
    assert(repairedBuilding?.occupantIds?.includes(person.id), "Expected building occupant assignment to survive repair.");
    assert(repairedService?.occupantIds.includes(person.id), "Expected service occupant assignment to survive repair.");
    const repairedFootprint = repairedBuilding.footprint;
    assert(repairedBuilding.status === "active", "Expected assigned service building to remain active.");
    assert(repairedFootprint, "Expected assigned service building footprint to survive repair.");
    assert(repairedFootprint.width > 0 && repairedFootprint.height > 0, "Expected assigned service building footprint to have positive dimensions.");
    assert(repairedFootprint.tileIds.length > 0, "Expected assigned service building footprint to include local tiles.");
    assert(person.buildingId === repairedBuilding.id, "Expected person to point at assigned building.");
    assert(person.currentService === repairedService.kind, "Expected person to point at assigned service.");
    assert(person.localTileId, "Expected assigned service person to have a local tile.");
    assert(repairedFootprint.tileIds.includes(person.localTileId), "Expected assigned service person local tile to sit inside building footprint.");

    const occupancy = collectOccupancySnapshot(world);
    const personPosition = occupancy.bySubjectId[`person:${person.id}`];
    assert(personPosition?.settlementId === settlement.id, "Expected assigned person to remain visible in settlement occupancy.");
    const bucket = occupancy.byOccupancyKey[personPosition.occupancyKey];
    assert(bucket?.entries.some((entry) => entry.subjectKind === "person" && entry.subjectId === person.id), "Expected occupancy bucket to include assigned person.");

    const telemetry = collectTelemetry(world);
    assert(telemetry.invariantIssues.length === 0, `Expected telemetry-clean service occupancy world:\n${telemetry.invariantIssues.join("\n")}`);
    assertValid(world, "building service occupancy scenario");
    return `${person.name} ${person.familyName}: ${repairedBuilding.name} ${repairedService.kind} tile ${person.localTileId}; occupancy ${bucket.key}`;
  })
);

results.push(
  scenario("settlement development repair feeds telemetry", () => {
    const world = createWorld("micro-settlement-development-repair");
    const settlement = Object.values(world.settlements)[0];
    assert(settlement, "Expected settlement fixture.");

    const serialized = JSON.parse(JSON.stringify(world)) as World;
    const legacySettlement = serialized.settlements[settlement.id] as unknown as {
      buildings?: Partial<SettlementBuilding>[];
      borders?: Partial<SettlementBorder>[];
      buildOrders?: Partial<SettlementBuildOrder>[];
    };
    legacySettlement.buildings = [
      {
        kind: "wall",
        status: "damaged",
        level: 0,
        integrity: 140,
        progress: 125,
        builtTick: -5,
        tags: ["scenario-legacy"]
      }
    ];
    legacySettlement.borders = [
      {
        kind: "wall",
        radius: -2,
        integrity: 135,
        coverage: 180,
        gateCount: 0,
        status: "fortified",
        tags: ["scenario-legacy"]
      }
    ];
    legacySettlement.buildOrders = [
      {
        kind: "library",
        status: "building",
        pressure: 82,
        laborRequired: 10,
        laborInvested: 99,
        progress: 240,
        createdTick: world.tick,
        tags: ["scenario-legacy"]
      },
      {
        kind: "school",
        status: "complete",
        laborRequired: 12,
        laborInvested: 0,
        createdTick: world.tick,
        tags: ["scenario-legacy"]
      }
    ];

    const repaired = repairLoadedWorld(serialized);
    assert(repaired, "Expected serialized world to repair.");
    const repairedSettlement = repaired.settlements[settlement.id];
    assert(repairedSettlement, "Expected repaired settlement to remain.");
    const repairedWall = repairedSettlement.buildings?.find((building) => building.catalogId === "wall");
    assert(repairedWall, "Expected legacy wall building to repair.");
    assert(repairedWall.id && repairedWall.name && repairedWall.category === "defense", "Expected repaired wall metadata.");
    assert(repairedWall.integrity === 100 && repairedWall.progress === 100 && repairedWall.level === 1, "Expected repaired wall values to clamp.");

    const repairedWallBorder = repairedSettlement.borders?.find((border) => border.kind === "wall");
    assert(repairedWallBorder, "Expected repaired wall border from damaged wall.");
    assert(repairedWallBorder.radius > 0 && repairedWallBorder.coverage <= 100 && repairedWallBorder.gateCount >= 1, "Expected repaired border geometry.");

    const buildingOrder = repairedSettlement.buildOrders?.find((order) => order.catalogId === "library");
    const completedOrder = repairedSettlement.buildOrders?.find((order) => order.catalogId === "school");
    assert(buildingOrder?.status === "building", "Expected active legacy build order to repair.");
    assert(buildingOrder.laborInvested === buildingOrder.laborRequired && buildingOrder.progress === 100, "Expected active build order labor to clamp.");
    assert(completedOrder?.status === "complete", "Expected completed legacy build order to repair.");
    assert(completedOrder.laborInvested === completedOrder.laborRequired && completedOrder.progress === 100, "Expected completed build order labor to fill.");

    const telemetry = collectTelemetry(repaired);
    assert(telemetry.builtEnvironment.damagedBuildings >= 1, "Expected repaired damaged building in telemetry.");
    assert(telemetry.builtEnvironment.fortifiedSettlements >= 1, "Expected repaired fortified settlement in telemetry.");
    assert(telemetry.builtEnvironment.activeBuildOrders >= 1, "Expected repaired active build order in telemetry.");
    assert(telemetry.builtEnvironment.completedBuildOrders >= 1, "Expected repaired completed build order in telemetry.");
    assertValid(repaired, "settlement development repair scenario");
    return `${repairedSettlement.name}: damaged ${telemetry.builtEnvironment.damagedBuildings}; orders ${telemetry.builtEnvironment.activeBuildOrders}/${telemetry.builtEnvironment.completedBuildOrders}`;
  })
);

results.push(
  scenario("warding emits and changes state", () => {
    const world = createWorld("micro-ward-event");
    const child = makeScenarioChild(world);
    const guardian = adults(world).find((person) => person.factionId !== child.factionId && person.id !== child.id);
    assert(guardian, "Expected adult guardian from another faction.");
    guardian.locationId = child.locationId;
    const conqueror = world.factions[guardian.factionId];
    assert(conqueror, "Expected conqueror faction with guardian adults.");
    const beforeEvents = world.events.length;
    const warded = createWardFromConquest(world, child, conqueror.id, child.locationId, new Rng(44));
    const emitted = newEvents(world, beforeEvents);
    assert(warded, "Expected child to become ward.");
    assert(child.adoptionStatus === "ward", "Expected adoption status ward.");
    assert(child.guardianIds.length > 0, "Expected guardian assignment.");
    assert(child.fosterCultureId, "Expected foster culture.");
    assert(child.memories.some((memory) => memory.tags.includes("ward")), "Expected ward memory.");
    assert(emitted.length === 0, "createWardFromConquest mutates state; caller owns event emission.");
    assertValid(world, "warding scenario");
    return `guardian ${child.guardianIds[0]}; foster ${child.fosterCultureId}`;
  })
);

results.push(
  scenario("influence and powered materials derive deterministically", () => {
    const world = createWorld("micro-influence-power-foundation");
    const [teacher, learner, target] = adults(world);
    assert(teacher && learner && target, "Expected at least three adults.");

    teacher.abilityIds = [...new Set([...teacher.abilityIds, "guarded-cut"])];
    teacher.skills.blade = 80;
    teacher.skills.command = 75;
    teacher.skills.sorcery = 72;
    teacher.stats.core.willpower = 84;
    teacher.stats.derived.intelligence = 78;
    teacher.stats.derived.wisdom = 72;
    teacher.stats.derived.charisma = 82;

    learner.skills.blade = 36;
    learner.traits.curiosity = 86;
    learner.stats.derived.dexterity = 50;
    learner.stats.derived.intelligence = 70;
    learner.stats.derived.wisdom = 64;
    learner.stats.derived.perception = 66;
    learner.abilityIds = learner.abilityIds.filter((id) => id !== "guarded-cut");
    learner.abilityStudy["guarded-cut"] = {
      abilityId: "guarded-cut",
      exposure: 40,
      attempts: 0,
      lastObservedTick: 0,
      lastAttemptTick: -1,
      affinity: 12
    };

    target.stats.core.willpower = 4;
    target.stats.derived.wisdom = 5;
    target.stats.derived.perception = 5;
    target.traits.caution = 4;
    target.traits.loyalty = 4;

    const lesson = teachAbility(world, teacher, learner, "guarded-cut", new Rng(101), { intensity: 80, privateLesson: true });
    assert(lesson.success, "Expected focused teaching to succeed.");
    assert((learner.abilityStudy["guarded-cut"]?.exposure ?? 0) > 40, "Expected teaching to increase ability exposure.");

    const compulsion = attemptMindCompulsion(world, teacher, target, new Rng(102), { strength: 45, durationTicks: 5, sourceKind: "authority" });
    assert(compulsion.success, "Expected deterministic compulsion to land.");
    assert(target.social?.compulsion?.remainingTicks === 5, "Expected compulsion state on target social mind.");
    const influenceTick = tickInfluenceState(world, new Rng(103), [target]);
    assert(influenceTick.compelled === 1, "Expected influence tick to count compelled target.");

    ensurePersonResources(teacher, world.tick);
    assert((teacher.resources?.focus.max ?? 0) > 0, "Expected focus resource pool.");

    const item: Item = {
      id: "scenario-powered-armor",
      name: "scenario storm-quartz power armor",
      kind: "armor",
      quality: "masterwork",
      material: "storm-quartz",
      techLevel: "aetheric",
      techVariant: "vibro",
      power: 14,
      value: 180,
      durability: 92,
      maxDurability: 92,
      tags: ["power-armor"],
      effects: []
    };
    const profile = ensureItemMaterialProfile(item);
    const adjustments = deriveMaterialItemAdjustments(item, profile);
    const cell = ensureItemPowerCell(item);
    const alloy = deriveAlloyProfile([
      { material: "iron", ratio: 2 },
      { material: "storm-quartz", ratio: 1, purity: 8 }
    ]);

    assert(profile.conductivity >= 90, "Expected storm-quartz aetheric vibro item to be highly conductive.");
    assert(adjustments.durabilityDelta > 0, "Expected material adjustment to improve durability.");
    assert(cell.capacity > 0 && cell.charge === cell.capacity, "Expected powered item cell to initialize charged.");
    assert(alloy.tags.includes("alloy") && alloy.conductivity > 50, "Expected alloy derivation to preserve conductive properties.");
    assertValid(world, "influence and powered material scenario");
    return `lesson +${lesson.exposureDelta}; compulsion ${target.social.compulsion.remainingTicks}; conductivity ${profile.conductivity}; cell ${cell.capacity}`;
  })
);

results.push(
  scenario("augmentation foundation records scars and power consequences", () => {
    const world = createWorld("micro-augmentation-foundation");
    const subject = adults(world)[0];
    assert(subject, "Expected adult subject for augmentation fixture.");

    subject.alive = true;
    subject.maxHp = Math.max(subject.maxHp, 40);
    subject.hp = 1;
    subject.fatigue = 10;
    subject.morale = 55;
    subject.status = ["wounded", "bleeding", "road-worn"];
    subject.memories = [
      {
        id: "scenario-near-death-memory",
        tick: world.tick,
        label: "Scenario near-death collapse",
        weight: -10,
        tags: ["near-death", "combat", "wound", "bleeding", "leg"]
      },
      ...subject.memories
    ];
    subject.injuries = [];
    subject.scars = [];
    subject.augmentations = [];
    subject.inventory = [];
    subject.equipment = {};
    subject.resources = ensurePersonResources(subject, world.tick);

    const woundTick = tickAugmentations(subject, { tick: 40, recordCurrentInjury: true, scarSevereInjuries: true });
    const injury = woundTick.injuriesCreated[0];
    assert(injury, "Expected low-hp/status/memory pressure to record an injury.");
    assert(["severe", "critical", "maiming"].includes(injury.severity), `Expected severe-or-worse injury, got ${injury.severity}.`);
    assert(injury.locus === "leg", `Expected scenario pressure to infer leg injury, got ${injury.locus}.`);
    const woundScar = woundTick.scarsCreated.find((scar) => scar.fromInjuryId === injury.id);
    assert(woundScar, "Expected severe injury to create a scar.");
    assert(subject.injuries.some((candidate) => candidate.id === injury.id), "Expected injury to be retained on subject.");
    assert(subject.scars.some((candidate) => candidate.id === woundScar.id), "Expected scar to be retained on subject.");

    subject.hp = subject.maxHp;
    subject.status = [];
    subject.memories = [];
    const unsupportedBurden = deriveInjuryBurden(subject);
    const supportInstall = installAugmentation(
      subject,
      {
        id: "scenario-prosthetic-leg",
        name: "Scenario Prosthetic Leg",
        kind: "prosthetic",
        source: "crafted",
        locus: injury.locus,
        powered: false,
        effects: [{ kind: "derived-stat", target: "dexterity", magnitude: 4, tags: ["mobility-support"] }],
        sideEffects: [],
        tags: ["scenario", "injury-support"]
      },
      { tick: 41, replacingInjuryIds: [injury.id] }
    );
    assert(supportInstall.success && supportInstall.augmentation, `Expected prosthetic install to succeed: ${supportInstall.reasons.join(", ")}.`);
    const supportEffects = computeAugmentationEffects(subject);
    const supportedBurden = deriveInjuryBurden(subject);
    assert(supportEffects.activeIds.includes("scenario-prosthetic-leg"), "Expected prosthetic to be active.");
    assert((supportEffects.derivedStatBonuses.dexterity ?? 0) > 0, "Expected prosthetic dexterity support bonus.");
    assert(supportEffects.burdenOffset > 0, "Expected augmentation effects to report burden offset.");
    assert(supportedBurden.burden < unsupportedBurden.burden, `Expected supported burden below unsupported burden: ${unsupportedBurden.burden}->${supportedBurden.burden}.`);

    const armor: Item = {
      id: "scenario-cell-armor",
      name: "Scenario Cell Armor",
      kind: "armor",
      quality: "fine",
      material: "storm-quartz",
      techLevel: "aetheric",
      techVariant: "vibro",
      power: 8,
      value: 150,
      durability: 80,
      maxDurability: 80,
      tags: ["power-armor", "battery"],
      effects: [],
      powerCell: {
        channel: "aether",
        charge: 2,
        capacity: 5,
        drainPerUse: 5,
        rechargePerTick: 0,
        stable: true,
        tags: ["power-cell", "aether"]
      }
    };
    subject.inventory = [armor];
    subject.resources.energy.max = Math.max(subject.resources.energy.max, 10);
    subject.resources.energy.current = 10;
    const poweredInstall = installAugmentation(
      subject,
      {
        id: "scenario-powered-brace",
        name: "Scenario Powered Brace",
        kind: "powered-armor",
        source: "crafted",
        locus: "torso",
        itemId: armor.id,
        powered: true,
        active: true,
        effects: [{ kind: "power", target: "mobility", magnitude: 3, requiresPower: true, tags: ["powered"] }],
        sideEffects: [],
        upkeep: { channel: "item-cell", amount: 5, itemId: armor.id, required: true, intervalTicks: 1, tags: ["scenario"] },
        tags: ["scenario", "powered"]
      },
      { tick: 42, itemId: armor.id }
    );
    assert(poweredInstall.success && poweredInstall.augmentation, `Expected powered augmentation install to succeed: ${poweredInstall.reasons.join(", ")}.`);
    const beforeCell = armor.powerCell?.charge ?? 0;
    const beforeEnergy = subject.resources.energy.current;
    const paid = payAugmentationUpkeep(subject, poweredInstall.augmentation, { tick: 43, allowFallback: true, fallbackChannel: "energy" });
    assert(paid, "Expected powered upkeep result.");
    assert(paid.paid && paid.shortfall === 0, `Expected item-cell upkeep with energy fallback to be paid, shortfall ${paid.shortfall}.`);
    assert(paid.spentFromItems[0]?.amount === beforeCell, `Expected item cell to drain first, spent ${paid.spentFromItems[0]?.amount}.`);
    assert((paid.spentFromPerson.energy ?? 0) === 3, `Expected 3 energy fallback, got ${paid.spentFromPerson.energy ?? 0}.`);
    assert((armor.powerCell?.charge ?? -1) === 0, "Expected item cell to be empty after partial drain.");
    assert(beforeEnergy - subject.resources.energy.current === 3, "Expected person energy to cover remaining powered upkeep.");
    const afterPaidEnergy = subject.resources.energy.current;
    if (poweredInstall.augmentation.upkeep) {
      poweredInstall.augmentation.upkeep.lastPaidTick = 44;
    }

    const strainInstall = installAugmentation(
      subject,
      {
        id: "scenario-heart-driver",
        name: "Scenario Heart Driver",
        kind: "implant",
        source: "precursor",
        locus: "heart",
        powered: true,
        active: true,
        effects: [{ kind: "resource", target: "energy", magnitude: 2, requiresPower: true, tags: ["circulatory"] }],
        sideEffects: [{ kind: "fatigue", magnitude: 3, threshold: 1, tags: ["strain"] }],
        upkeep: { channel: "energy", amount: 4, required: true, intervalTicks: 1, tags: ["required", "scenario"] },
        tags: ["scenario", "required-power"]
      },
      { tick: 44 }
    );
    assert(strainInstall.success && strainInstall.augmentation, `Expected required powered install to succeed: ${strainInstall.reasons.join(", ")}.`);
    subject.resources.energy.current = 1;
    const beforeLowPowerEnergy = subject.resources.energy.current;
    const beforeFatigue = subject.fatigue;
    const lowPowerTick = tickAugmentations(subject, { tick: 44, recordCurrentInjury: false, scarSevereInjuries: false });
    const unpaid = lowPowerTick.upkeep.find((result) => result.augmentationId === "scenario-heart-driver");
    const strainedAugmentation = subject.augmentations.find((augmentation) => augmentation.id === "scenario-heart-driver");
    assert(unpaid, "Expected required powered augmentation upkeep result.");
    assert(!unpaid.paid && unpaid.shortfall === 3, `Expected required upkeep shortfall 3, got paid=${unpaid.paid} shortfall=${unpaid.shortfall}.`);
    assert(strainedAugmentation && !strainedAugmentation.active, "Expected unpaid required powered augmentation to become inactive.");
    assert(lowPowerTick.effects.inactiveIds.includes("scenario-heart-driver"), "Expected inactive augmentation in effect summary.");
    assert(lowPowerTick.statusAdded.includes("augmentation-low-power"), "Expected low-power status consequence.");
    assert(lowPowerTick.statusAdded.includes("augmentation-strain"), "Expected strain status consequence.");
    assert(subject.fatigue > beforeFatigue, "Expected unpaid powered strain to increase fatigue.");

    assertValid(world, "augmentation foundation scenario");
    return `injury ${injury.severity}/${injury.locus} burden ${injury.burden}; scar ${woundScar.severity}; support ${unsupportedBurden.burden}->${supportedBurden.burden} offset ${supportEffects.burdenOffset}; paid cell ${beforeCell}->${armor.powerCell?.charge ?? 0} energy ${beforeEnergy}->${afterPaidEnergy}; unpaid energy ${beforeLowPowerEnergy}->${subject.resources.energy.current} shortfall ${unpaid.shortfall} active ${strainedAugmentation?.active} statuses ${lowPowerTick.statusAdded.join("|")}`;
  })
);

results.push(
  scenario("social-emotional helpers survive simulation tick", () => {
    const world = createWorld("micro-social-emotional-tranche");
    const band = firstBand(world);
    const subject = world.persons[band.leaderId];
    assert(subject, "Expected band leader subject.");
    const candidates = adults(world).filter((person) => person.id !== subject.id);
    assert(candidates.length >= 3, "Expected enough adults for social-emotional fixture.");
    const [source, trusted, rival] = candidates;
    assert(subject.social, "Expected subject social mind.");

    const factionIds = Object.keys(world.factions);
    const otherFactionId = factionIds.find((id) => id !== subject.factionId);
    assert(otherFactionId, "Expected a second faction for loyalty pressure.");
    const conflictOrg =
      Object.values(world.organizations ?? {}).find((organization) => organization.factionId === otherFactionId) ??
      Object.values(world.organizations ?? {})[0];
    assert(conflictOrg, "Expected seeded organization for loyalty pressure.");
    conflictOrg.factionId = otherFactionId;
    conflictOrg.status = "strained";
    conflictOrg.outlook.cohesion = 24;
    world.factions[subject.factionId].relations[otherFactionId] = -82;
    world.factions[otherFactionId].relations[subject.factionId] = -82;

    const attachMembership = (person: Person, loyalty: number): void => {
      conflictOrg.memberIds = [...new Set([...conflictOrg.memberIds, person.id])];
      person.memberships = [
        ...(person.memberships ?? []).filter((membership) => membership.organizationId !== conflictOrg.id),
        {
          organizationId: conflictOrg.id,
          role: "agent",
          status: "oathbound",
          loyalty,
          influence: 68,
          obligation: 96,
          joinedTick: world.tick,
          public: true
        }
      ];
    };
    attachMembership(subject, 78);
    attachMembership(trusted, 70);

    band.purpose = "rebellion";
    band.supplies = 18;
    band.cohesion = 34;
    subject.parentIds = [...new Set([...subject.parentIds, trusted.id])];
    trusted.childIds = [...new Set([...trusted.childIds, subject.id])];
    trusted.familyName = subject.familyName;
    subject.adoptionStatus = "ward";
    subject.status = [...new Set([...subject.status, "wounded", "war-ward"])];
    subject.hp = Math.min(subject.hp, 5);
    subject.maxHp = Math.max(subject.maxHp, 28);
    subject.fatigue = 94;
    subject.morale = 14;
    subject.stats.core.willpower = 4;
    subject.stats.derived.wisdom = 5;
    subject.traits.caution = 4;

    source.stats.derived.charisma = 95;
    source.stats.derived.intelligence = 92;
    source.stats.derived.wisdom = 88;
    source.skills.sorcery = 96;
    source.skills.command = 94;
    source.skills.ward = 90;
    const compulsion = attemptMindCompulsion(world, source, subject, new Rng(701), {
      strength: 80,
      durationTicks: 12,
      sourceKind: "authority"
    });
    assert(compulsion.success, "Expected deterministic compulsion to land on stressed subject.");

    subject.relations[trusted.id] = 72;
    trusted.relations[subject.id] = 68;
    subject.social.trustByPersonId[trusted.id] = 82;
    subject.relations[rival.id] = -86;
    rival.relations[subject.id] = -78;
    subject.social.suspicionByPersonId[rival.id] = 94;

    const emotional = derivePersonEmotionalState(subject, { tick: world.tick, extraStress: 8 });
    subject.emotionalState = emotional;
    assert(
      emotional.stress.pressure >= 70 || ["compelled", "wounded", "grim", "despairing"].includes(emotional.mood),
      `Expected high pressure or compelled/wounded/grim mood, got ${emotional.mood} pressure ${emotional.stress.pressure}.`
    );

    const positiveStance = classifyRelationStance(subject, trusted);
    const rivalStance = classifyRelationStance(subject, rival);
    assert(["kin", "trusted-friend", "friend", "ally"].includes(positiveStance.stance), `Expected positive/kin stance, got ${positiveStance.stance}.`);
    assert(positiveStance.membershipOverlap.includes(conflictOrg.id), "Expected shared organization membership in positive stance.");
    assert(positiveStance.familyOverlap || positiveStance.tags.includes("shared-membership"), "Expected family or shared membership signal.");
    assert(["suspicious", "rival", "enemy", "uneasy"].includes(rivalStance.stance), `Expected suspicious/rival stance, got ${rivalStance.stance}.`);
    assert(rivalStance.rivalry > rivalStance.friendship, "Expected rivalry pressure to exceed friendship.");

    const loyalty = deriveLoyaltyState(subject, world, { tick: world.tick, includeHiddenMemberships: true });
    subject.loyalty = loyalty;
    const anchorKinds = new Set(loyalty.anchors.map((anchor) => anchor.kind));
    for (const kind of ["band", "compulsion", "faction", "family", "organization"]) {
      assert(anchorKinds.has(kind), `Expected ${kind} loyalty anchor.`);
    }
    assert(loyalty.conflicts.length > 0, "Expected at least one loyalty conflict.");
    assert(loyalty.conflicts.some((conflict) => conflict.reasons.length > 0 && conflict.pressure > 0), "Expected conflict pressure with reasons.");

    const climate = summarizeBandEmotionalClimate(world, band, { tick: world.tick });
    band.emotionalClimate = climate;
    assert(climate.memberCount === band.memberIds.filter((id) => world.persons[id]?.alive).length, "Expected band climate member count.");
    assert(climate.atRiskPersonIds.includes(subject.id), "Expected stressed subject to be at-risk in band climate.");
    assert(climate.dominantDrivers.length > 0, "Expected band climate dominant drivers.");
    assert(climate.conflictPressure > 0, "Expected band climate conflict pressure.");

    tickWorld(world, 1);
    const tickedSubject = world.persons[subject.id];
    assert(tickedSubject.emotionalState?.updatedTick === world.tick, "Expected ticked emotional state from orchestrator.");
    assert(tickedSubject.loyalty?.updatedTick === world.tick, "Expected ticked loyalty state from orchestrator.");
    assert(tickedSubject.relationStances?.[trusted.id]?.membershipOverlap.includes(conflictOrg.id), "Expected ticked positive relation stance.");
    assert((tickedSubject.relationStances?.[rival.id]?.rivalry ?? 0) > (tickedSubject.relationStances?.[rival.id]?.friendship ?? 0), "Expected ticked rival stance pressure.");
    assert(world.bands[band.id].emotionalClimate?.memberCount === climate.memberCount, "Expected ticked band emotional climate.");
    assert(world.organizations?.[conflictOrg.id]?.outlook.emotionalClimate?.memberCount, "Expected ticked organization emotional climate.");

    const telemetry = collectTelemetry(world);
    assert(telemetry.invariantIssues.length === 0, `Expected telemetry-valid world:\n${telemetry.invariantIssues.join("\n")}`);
    assertValid(world, "social-emotional scenario");
    return `${emotional.mood} pressure ${emotional.stress.pressure}; ${positiveStance.stance}/${rivalStance.stance}; conflicts ${loyalty.conflicts.length}; climate ${climate.memberCount}/${climate.conflictPressure}`;
  })
);

console.log(JSON.stringify({ ok: true, scenarios: results }, null, 2));

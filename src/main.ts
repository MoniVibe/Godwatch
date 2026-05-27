import { questKindLabels, skillLabels } from "./content";
import { abilityList, knownAbilities, studiedAbilities } from "./sim/abilities/compendium";
import { knownRecipes, recipeList, studiedRecipes } from "./sim/economy/recipes";
import { identityAxisInfo, identityAxisKeys, identityPoleLabel } from "./sim/individuals/identity";
import { archetypeInfo, coreStatKeys, derivedStatKeys, statLabels } from "./sim/individuals/stats";
import { culturePracticeDefinitions } from "./sim/society/culture";
import { featureKindLabels, layerLabels } from "./sim/environment/planet";
import {
  blessPerson,
  createWorld,
  defaultWorldGenConfig,
  repairLoadedWorld,
  setFavoredBand,
  setOmen,
  tickWorld,
  toggleWatchedPerson
} from "./simulation";
import "./styles.css";
import type {
  AbilityDefinition,
  Agreement,
  Asset,
  Band,
  ChronicleEvent,
  CraftingRecipeDefinition,
  CultureState,
  Faction,
  GroupOutlook,
  LegendHook,
  LegalEntityRef,
  LingeringEffect,
  Organization,
  Person,
  Quest,
  QuestKind,
  Settlement,
  SettlementBuilding,
  StoryArtifact,
  StoryBoss,
  StoryCrisis,
  TerrainHolding,
  TravelRoute,
  WeatherFront,
  WorldFeature,
  WorldGenConfig,
  World
} from "./types";
import { createRenderSnapshot, type RenderSnapshot } from "./view/snapshot";

const storageKey = "godwatch.save.v1";
type ActivityScope = "person" | "band" | "village" | "empire";
type ActivityCategory = "general" | "diplomacy" | "health" | "economy" | "conflict" | "quests" | "world";
type OrganizationView = "groups" | "assets" | "agreements";
type AtlasZoom = "world" | "region" | "local";
type AtlasOverlay = "biomes" | "elevation" | "threat" | "political";

const speeds = [
  { label: "Slow", ms: 1800, steps: 1 },
  { label: "Steady", ms: 950, steps: 1 },
  { label: "Fast", ms: 360, steps: 1 },
  { label: "Rush", ms: 180, steps: 2 }
] as const;
const activityScopes: { id: ActivityScope; label: string }[] = [
  { id: "person", label: "Person" },
  { id: "band", label: "Band" },
  { id: "village", label: "Village" },
  { id: "empire", label: "Society" }
];
const activityCategories: { id: ActivityCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "diplomacy", label: "Diplomacy" },
  { id: "health", label: "Health" },
  { id: "economy", label: "Economy" },
  { id: "conflict", label: "Conflict" },
  { id: "quests", label: "Quests" },
  { id: "world", label: "World" }
];
const atlasZoomModes: { id: AtlasZoom; label: string }[] = [
  { id: "world", label: "World" },
  { id: "region", label: "Region" },
  { id: "local", label: "Local" }
];
const atlasOverlayModes: { id: AtlasOverlay; label: string }[] = [
  { id: "biomes", label: "Biomes" },
  { id: "elevation", label: "Elevation" },
  { id: "threat", label: "Threat" },
  { id: "political", label: "Political" }
];

let world = loadWorld() ?? createWorld("first-frontier");
let running = true;
let speedIndex = 1;
let rosterView: "living" | "graveyard" = "living";
let chronicleView: "major" | "all" = "major";
let activityScope: ActivityScope = "person";
let activityCategory: ActivityCategory = "general";
let organizationView: OrganizationView = "groups";
let atlasZoom: AtlasZoom = "world";
let atlasOverlay: AtlasOverlay = "biomes";
let selectedFactionId = Object.values(world.factions)[0]?.id ?? "";
let selectedOrganizationId = Object.keys(world.organizations ?? {})[0] ?? "";
let selectedMapSettlementId = world.bands[world.selectedBandId]?.locationId ?? Object.values(world.settlements)[0]?.id ?? "";
let worldGenDraft: WorldGenConfig = { ...defaultWorldGenConfig(), ...world.generation };
let pendingRender = false;
let timer: number | undefined;
const planetSurfaceYaw = -Math.PI * 0.08;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing app root.");
}

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <h1>Godwatch</h1>
          <p>A living frontier chronicle</p>
        </div>
      </div>
      <div class="top-controls">
        <button class="icon-button" data-action="toggle-run" type="button">Pause</button>
        <button class="icon-button" data-action="step" type="button">Tick</button>
        <button class="icon-button" data-action="cycle-speed" type="button">Steady</button>
        <button class="icon-button" data-action="save" type="button">Save</button>
        <button class="icon-button" data-action="load" type="button">Load</button>
        <button class="icon-button danger" data-action="reset" type="button">Reset</button>
      </div>
    </header>
    <main class="dashboard">
      <section class="left-rail" aria-label="Deity controls and favored band"></section>
      <section class="chronicle" aria-label="Chronicle"></section>
      <section class="right-rail" aria-label="World state"></section>
    </main>
  </div>
`;

const leftRail = document.querySelector<HTMLElement>(".left-rail")!;
const chronicle = document.querySelector<HTMLElement>(".chronicle")!;
const rightRail = document.querySelector<HTMLElement>(".right-rail")!;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPersonName(person: Person): string {
  const title = person.title ? ` ${person.title}` : "";
  return `${person.name} ${person.familyName}${title}`;
}

function formatPersonNames(ids: string[]): string {
  const names = ids
    .map((id) => world.persons[id])
    .filter((person): person is Person => Boolean(person))
    .map(formatPersonName);
  return names.length ? names.join(", ") : "none";
}

function ratio(current: number, max: number): string {
  return `${Math.max(0, Math.round(current))}/${Math.round(max)}`;
}

function elevationBandColor(band: string): string {
  if (band === "alpine") {
    return "rgba(222, 235, 232, 0.42)";
  }
  if (band === "high") {
    return "rgba(183, 139, 83, 0.38)";
  }
  if (band === "middle") {
    return "rgba(198, 166, 77, 0.28)";
  }
  return "rgba(93, 139, 145, 0.26)";
}

function saveWorld(): void {
  localStorage.setItem(storageKey, JSON.stringify(world));
}

function loadWorld(): World | undefined {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return undefined;
  }
  try {
    return repairLoadedWorld(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function selectedBand(): Band {
  return world.bands[world.selectedBandId] ?? world.bands[world.deity.favoredBandId] ?? Object.values(world.bands)[0];
}

function selectedPerson(): Person {
  return world.persons[world.selectedPersonId] ?? world.persons[selectedBand().leaderId] ?? Object.values(world.persons)[0];
}

function selectedSettlement(): Settlement {
  const band = selectedBand();
  return world.settlements[selectedMapSettlementId] ?? world.settlements[band.locationId] ?? Object.values(world.settlements)[0];
}

function currentRenderSnapshot(): RenderSnapshot {
  return createRenderSnapshot(world, {
    mode: atlasZoom,
    overlay: atlasOverlay,
    selectedSettlementId: selectedSettlement().id,
    selectedMapSettlementId,
    selectedBandId: world.selectedBandId,
    selectedPersonId: world.selectedPersonId,
    includeEffects: true
  });
}

function selectedSociety(): Faction {
  const person = selectedPerson();
  const settlement = selectedSettlement();
  return world.factions[selectedFactionId] ?? world.factions[person.factionId] ?? world.factions[settlement.factionId] ?? Object.values(world.factions)[0];
}

function ensureUiSelections(): void {
  if (!world.settlements[selectedMapSettlementId]) {
    selectedMapSettlementId = world.bands[world.selectedBandId]?.locationId ?? Object.values(world.settlements)[0]?.id ?? "";
  }
  if (!world.factions[selectedFactionId]) {
    selectedFactionId = world.factions[selectedPerson().factionId]?.id ?? world.settlements[selectedSettlement().id]?.factionId ?? Object.values(world.factions)[0]?.id ?? "";
  }
  if (!selectedOrganizationId || !world.organizations?.[selectedOrganizationId]) {
    selectedOrganizationId = Object.keys(world.organizations ?? {})[0] ?? "";
  }
}

function cultureName(id: string | undefined): string {
  return id ? (world.cultures[id]?.name ?? id) : "none";
}

function bandTravelLabel(band: Band): string {
  if (!band.travel) {
    return world.settlements[band.locationId]?.name ?? "Unknown";
  }
  const origin = world.settlements[band.travel.originId]?.name ?? "Unknown";
  const destination = world.settlements[band.travel.destinationId]?.name ?? "Unknown";
  return `${origin} to ${destination}`;
}

function statusPill(label: string, value: string | number): string {
  return `<span class="pill"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></span>`;
}

function titleLabel(value: string | undefined): string {
  return (value ?? "unknown")
    .replace(/-/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function renderAbilityRow(ability: AbilityDefinition, compact = false): string {
  const cost = ability.manaCost > 0 ? `${ability.manaCost} mana` : "free";
  const area = ability.target === "cluster" ? `aoe ${ability.aoe}` : ability.target;
  return `
    <div class="ability-row ${compact ? "compact" : ""}">
      <div>
        <strong>${escapeHtml(ability.name)}</strong>
        <span>${escapeHtml(ability.kind)}</span>
      </div>
      <small>${escapeHtml(`${ability.school} · ${ability.effect} · ${area} · ${cost}`)}</small>
      ${compact ? "" : `<p>${escapeHtml(ability.description)}</p>`}
    </div>
  `;
}

function renderRecipeRow(recipe: CraftingRecipeDefinition, compact = false): string {
  return `
    <div class="ability-row ${compact ? "compact" : ""}">
      <div>
        <strong>${escapeHtml(recipe.name)}</strong>
        <span>${escapeHtml(`T${recipe.tier}`)}</span>
      </div>
      <small>${escapeHtml(`${recipe.qualityFloor}+ · ${recipe.outputMaterial ?? "local material"} · ${recipe.outputTechVariant ?? "varied"} · difficulty ${recipe.difficulty}`)}</small>
      ${compact ? "" : `<p>${escapeHtml(recipe.description)}</p>`}
    </div>
  `;
}

function renderItemLine(item: Person["inventory"][number]): string {
  const effects = (item.effects ?? [])
    .slice(0, 2)
    .map((effect) => `${effect.target} ${effect.magnitude >= 0 ? "+" : ""}${effect.magnitude}`)
    .join(", ");
  const sentience = item.sentience
    ? ` · ${item.sentience.name}: ${item.sentience.desire}, mood ${Math.round(item.sentience.mood)}, loyalty ${Math.round(item.sentience.loyalty)}`
    : "";
  const recipe = item.provenance?.recipeId ? recipeList.find((candidate) => candidate.id === item.provenance?.recipeId) : undefined;
  const origin = item.provenance ? ` · origin ${item.provenance.originKind}${recipe ? ` via ${recipe.name}` : ""}` : "";
  const story = item.provenance?.story ? `<small>${escapeHtml(item.provenance.story)}</small>` : "";
  return `<span>${escapeHtml(item.name)} <strong>${escapeHtml(`${item.quality ?? "common"} +${item.power}`)}</strong><small>${escapeHtml(
    `${item.kind} · ${item.material ?? "iron"} · ${item.techVariant ?? "forged"} · ${item.techLevel ?? "iron"} tech · ${Math.round(item.durability ?? 0)}/${Math.round(
      item.maxDurability ?? 0
    )} durability · value ${Math.round(item.value ?? 0)}${effects ? ` · ${effects}` : ""}${origin}${sentience}`
  )}</small>${story}</span>`;
}

function renderStatPill(label: string, value: number): string {
  return `<span class="stat-pill"><small>${escapeHtml(label)}</small><strong>${Math.round(value)}</strong></span>`;
}

function meter(label: string, value: number, max = 100): string {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return `
    <div class="meter-row">
      <span>${escapeHtml(label)}</span>
      <strong>${Math.round(value)}</strong>
      <div class="meter"><span style="width:${width}%"></span></div>
    </div>
  `;
}

function identityMeter(key: (typeof identityAxisKeys)[number], value: number): string {
  const info = identityAxisInfo[key];
  const left = identityPoleLabel(key, value);
  const width = Math.max(0, Math.min(100, (value + 100) / 2));
  return `
    <div class="identity-axis">
      <span>${escapeHtml(info.label)}</span>
      <strong>${escapeHtml(left)} ${value >= 0 ? "+" : ""}${Math.round(value)}</strong>
      <div class="axis-track"><span style="width:${width}%"></span></div>
    </div>
  `;
}

function renderSocialIntentPanel(person: Person): string {
  const mind = person.social;
  if (!mind) {
    return "";
  }
  const suspicions = Object.entries(mind.suspicionByPersonId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id, value]) => `${world.persons[id]?.name ?? "unknown"} ${Math.round(value)}`)
    .join(", ");
  const compulsion = mind.compulsion
    ? `${mind.compulsion.sourceKind} ${Math.round(mind.compulsion.strength)} · ${mind.compulsion.remainingTicks} ticks`
    : "none";
  return `
    <h4>Intent</h4>
    <div class="inventory-list">
      <span>Ambition <strong>${escapeHtml(mind.ambition.text)}</strong><small>${escapeHtml(`${mind.ambition.kind} · strength ${Math.round(mind.ambition.strength)}`)}</small></span>
      <span>Declared <strong>${escapeHtml(mind.declaredIntent.text)}</strong><small>${escapeHtml(`${mind.declaredIntent.kind} · what others hear`)}</small></span>
      <span>Hidden <strong>${escapeHtml(mind.hiddenIntent?.text ?? "none obvious")}</strong><small>${escapeHtml(
        mind.hiddenIntent ? `${mind.hiddenIntent.kind} · secrecy ${Math.round(mind.hiddenIntent.secrecy)}` : "no active concealed intent"
      )}</small></span>
      <span>Compulsion <strong>${escapeHtml(compulsion)}</strong><small>${escapeHtml(suspicions ? `Suspicion: ${suspicions}` : "No one is strongly suspicious yet")}</small></span>
    </div>
  `;
}

function renderPersonMini(person: Person): string {
  const watched = world.deity.watchedPersonIds.includes(person.id);
  return `
    <button class="person-row ${person.id === world.selectedPersonId ? "selected" : ""} ${person.alive ? "" : "dead"}" data-person-id="${person.id}" type="button">
      <span>
        <strong>${escapeHtml(formatPersonName(person))}</strong>
        <small>${escapeHtml(person.role)} · age ${person.age} · ${escapeHtml(person.alive ? "alive" : "dead")}</small>
      </span>
      <span class="row-stat">${ratio(person.hp, person.maxHp)} HP ${watched ? "· watched" : ""}</span>
    </button>
  `;
}

function renderLeftRail(): void {
  const band = selectedBand();
  const leader = world.persons[band.leaderId];
  const person = selectedPerson();
  const members = band.memberIds.map((id) => world.persons[id]).filter((member): member is Person => Boolean(member?.alive));
  const location = selectedSettlement();
  const faction = world.factions[person.factionId];
  const culture = world.cultures[person.cultureId] ?? world.cultures[faction?.cultureId ?? ""];
  const archetype = archetypeInfo[person.archetype];
  const openQuests = Object.values(world.quests).filter((quest) => quest.status === "open").length;
  const travel = band.travel;
  const route = travel ? world.planet.routes[travel.routeId] : undefined;
  const localBiome = world.planet.biomes[route?.biomeId ?? location.biomeId];
  const terrainLabel = route ? `${route.terrain} / ${route.topography}` : `${location.terrain} / ${location.topography}`;
  const elevationLabel = route
    ? `${route.elevationBand} · +${Math.round(route.elevationGain)}m · pass ${route.passDifficulty}`
    : `${location.elevationBand} · ${Math.round(location.elevationMeters)}m`;

  leftRail.innerHTML = `
    <section class="panel deity-panel">
      <div class="panel-heading">
        <h2>Divine View</h2>
        <span>Day ${world.day} · Tick ${world.tick}</span>
      </div>
      <div class="pill-grid">
        ${statusPill("Speed", speeds[speedIndex].label)}
        ${statusPill("Running", running ? "yes" : "paused")}
        ${statusPill("Omen", world.deity.omen === "none" ? "none" : questKindLabels[world.deity.omen])}
        ${statusPill("Open quests", openQuests)}
      </div>
      <div class="button-grid">
        <button data-action="bless-selected" type="button">Bless Selected</button>
        <button data-action="watch-selected" type="button">${world.deity.watchedPersonIds.includes(person.id) ? "Unwatch" : "Watch"}</button>
      </div>
      <label class="field">
        <span>Omen</span>
        <select data-field="omen">
          <option value="none" ${world.deity.omen === "none" ? "selected" : ""}>None</option>
          ${Object.entries(questKindLabels)
            .map(([value, label]) => `<option value="${value}" ${world.deity.omen === value ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Favored Band</h2>
        <span>${escapeHtml(travel ? "traveling" : location.name)}</span>
      </div>
      <h3>${escapeHtml(band.name)}</h3>
      <p class="muted">${escapeHtml(band.goal)}</p>
      <div class="pill-grid">
        ${statusPill("Leader", `${leader.name} ${leader.familyName}`)}
        ${statusPill("Purpose", band.purpose)}
        ${statusPill("Cohesion", Math.round(band.cohesion))}
        ${statusPill("Supplies", Math.round(band.supplies))}
        ${statusPill("Place", bandTravelLabel(band))}
        ${statusPill("Biome", localBiome.name)}
        ${statusPill("Terrain", terrainLabel)}
        ${statusPill("Elevation", elevationLabel)}
        ${statusPill("Resource", location.resources[0] ?? localBiome.resources[0])}
        ${statusPill("Flora", location.flora[0] ?? "sparse growth")}
        ${statusPill("Fauna", location.fauna[0] ?? "quiet")}
        ${statusPill("Threat", location.localThreats[0] ?? localBiome.threats[0])}
      </div>
      ${travel ? meter("Travel", travel.progress, travel.total) : ""}
      <div class="person-list">
        ${members.map(renderPersonMini).join("")}
      </div>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Selected Person</h2>
        <span>${escapeHtml(faction.name)} society</span>
      </div>
      <h3>${escapeHtml(formatPersonName(person))}</h3>
      <div class="pill-grid">
        ${statusPill("Role", person.role)}
        ${statusPill("Archetype", archetype?.label ?? person.archetype)}
        ${statusPill("Culture", culture?.name ?? "none")}
        ${statusPill("Birth Culture", cultureName(person.birthCultureId))}
        ${statusPill("Foster", person.fosterCultureId ? `${cultureName(person.fosterCultureId)} ${Math.round(person.cultureBlend)}%` : person.adoptionStatus)}
        ${statusPill("Ancestry", `${person.ancestry}${person.ancestryLineage.length > 1 ? ` · ${person.ancestryLineage.length} lines` : ""}`)}
        ${statusPill("Lineage", `G${person.generation} · ${person.childIds.length} children`)}
        ${statusPill("Renown", person.renown)}
        ${statusPill("Gold", person.gold)}
        ${statusPill("Status", person.status.length ? person.status.join(", ") : "clear")}
      </div>
      <p class="muted archetype-note">${escapeHtml(archetype?.description ?? "A person shaped by experience.")}</p>
      ${meter("HP", person.hp, person.maxHp)}
      ${meter("Mana", person.mana, person.maxMana)}
      ${meter("Fatigue", person.fatigue)}
      ${meter("Morale", person.morale)}
      <h4>Stats</h4>
      <div class="stat-grid">
        ${coreStatKeys.map((key) => renderStatPill(statLabels[key], person.stats.core[key])).join("")}
        ${derivedStatKeys.map((key) => renderStatPill(statLabels[key], person.stats.derived[key])).join("")}
      </div>
      <h4>Identity Drift</h4>
      <div class="identity-grid">
        ${identityAxisKeys.map((key) => identityMeter(key, person.identity[key])).join("")}
      </div>
      ${renderSocialIntentPanel(person)}
      <h4>Family</h4>
      <div class="inventory-list">
        <span>Parents <strong>${escapeHtml(formatPersonNames(person.parentIds))}</strong></span>
        <span>Children <strong>${escapeHtml(formatPersonNames(person.childIds))}</strong></span>
      </div>
      <h4>Abilities</h4>
      <div class="ability-list person-abilities">
        ${knownAbilities(person).map((ability) => renderAbilityRow(ability)).join("")}
      </div>
      ${
        studiedAbilities(person).length
          ? `
            <h4>Observed Studies</h4>
            <div class="study-list">
              ${studiedAbilities(person)
                .slice(0, 5)
                .map(
                  ({ ability, study }) => `
                    <div class="study-row">
                      <span>
                        <strong>${escapeHtml(ability.name)}</strong>
                        <small>${escapeHtml(`${Math.round(study.exposure)} exposure · ${study.attempts} attempts`)}</small>
                      </span>
                      <em>${study.affinity >= 0 ? "+" : ""}${Math.round(study.affinity)}</em>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
      ${
        knownRecipes(person).length
          ? `
            <h4>Known Recipes</h4>
            <div class="ability-list person-abilities">
              ${knownRecipes(person)
                .slice(0, 5)
                .map((recipe) => renderRecipeRow(recipe, true))
                .join("")}
            </div>
          `
          : ""
      }
      ${
        studiedRecipes(person).length
          ? `
            <h4>Recipe Studies</h4>
            <div class="study-list">
              ${studiedRecipes(person)
                .slice(0, 5)
                .map(
                  ({ recipe, study }) => `
                    <div class="study-row">
                      <span>
                        <strong>${escapeHtml(recipe.name)}</strong>
                        <small>${escapeHtml(`${Math.round(study.exposure)} exposure · ${study.attempts} attempts`)}</small>
                      </span>
                      <em>${study.affinity >= 0 ? "+" : ""}${Math.round(study.affinity)}</em>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : ""
      }
      <div class="two-col">
        <div>
          <h4>Traits</h4>
          ${(Object.entries(person.traits) as [string, number][])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([key, value]) => `<span class="line-item">${escapeHtml(key)} <strong>${Math.round(value)}</strong></span>`)
            .join("")}
        </div>
        <div>
          <h4>Skills</h4>
          ${(Object.entries(person.skills) as [keyof typeof skillLabels, number][])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([key, value]) => `<span class="line-item">${escapeHtml(skillLabels[key])} <strong>${Math.round(value)}</strong></span>`)
            .join("")}
        </div>
      </div>
      <h4>Equipment</h4>
      <div class="inventory-list">
        ${[person.equipment.weapon, person.equipment.armor, person.equipment.trinket]
          .filter((item): item is Person["inventory"][number] => Boolean(item))
          .map(renderItemLine)
          .join("") || `<span>None equipped</span>`}
      </div>
      <h4>Inventory</h4>
      <div class="inventory-list">
        ${person.inventory
          .slice(0, 9)
          .map(renderItemLine)
          .join("")}
      </div>
    </section>
  `;
}

function renderDoctrineControls(): string {
  const doctrine = world.doctrine;
  return `
    <section class="panel doctrine-panel">
      <div class="panel-heading">
        <h2>Standing Doctrine</h2>
        <span>How favored bands interpret danger</span>
      </div>
      <div class="control-grid">
        <label class="field">
          <span>Target</span>
          <select data-field="targetPolicy">
            ${["casters", "weakest", "leaders", "spread"]
              .map((value) => `<option value="${value}" ${doctrine.targetPolicy === value ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>Risk</span>
          <select data-field="riskStance">
            ${["cautious", "balanced", "bold"]
              .map((value) => `<option value="${value}" ${doctrine.riskStance === value ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>Consumables</span>
          <select data-field="spendConsumables">
            ${["sparingly", "balanced", "freely"]
              .map((value) => `<option value="${value}" ${doctrine.spendConsumables === value ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>Quest Bias</span>
          <select data-field="preferredQuest">
            <option value="any" ${doctrine.preferredQuest === "any" ? "selected" : ""}>any</option>
            ${Object.entries(questKindLabels)
              .map(([value, label]) => `<option value="${value}" ${doctrine.preferredQuest === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <label class="slider-field">
        <span>Heal below <strong>${doctrine.healBelow}%</strong></span>
        <input data-field="healBelow" type="range" min="10" max="90" value="${doctrine.healBelow}" />
      </label>
      <label class="slider-field">
        <span>AoE at <strong>${doctrine.aoeAt} enemies</strong></span>
        <input data-field="aoeAt" type="range" min="2" max="6" value="${doctrine.aoeAt}" />
      </label>
      <label class="slider-field">
        <span>Retreat below <strong>${doctrine.retreatBelow}% leader HP</strong></span>
        <input data-field="retreatBelow" type="range" min="5" max="70" value="${doctrine.retreatBelow}" />
      </label>
    </section>
  `;
}

function renderChronicleEvent(item: ChronicleEvent): string {
  return `
    <article class="event ${item.kind} ${item.severity}">
      <span class="event-meta">Day ${item.day} · ${escapeHtml(item.kind)}</span>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `;
}

function textHasAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function eventActivityCategory(item: ChronicleEvent): Exclude<ActivityCategory, "general"> {
  if (item.kind === "quest") {
    return "quests";
  }
  if (item.kind === "combat") {
    return "conflict";
  }
  if (item.kind === "inventory") {
    return "economy";
  }
  if (
    item.kind === "relation" ||
    textHasAny(item.text, ["adopts", "ward", "family", "culture", "marriage", "lineage", "birth household", "comes of age"])
  ) {
    return "diplomacy";
  }
  if (textHasAny(item.text, ["dies", "wound", "wounds", "heals", "hp", "plague", "fever", "blessing fades", "rests", "patches"])) {
    return "health";
  }
  if (textHasAny(item.text, ["war", "invasion", "uprising", "raid", "raiding", "duel", "broken", "defeated", "slain", "threat"])) {
    return "conflict";
  }
  if (textHasAny(item.text, ["gold", "loot", "recipe", "crafted", "mine", "resource", "supplies", "holding", "stock", "trader", "relic", "item"])) {
    return "economy";
  }
  if (item.factionIds.length > 1 || textHasAny(item.text, ["relation", "succession", "unrest", "stability", "governs", "governance"])) {
    return "diplomacy";
  }
  return "world";
}

function eventMatchesActivityScope(item: ChronicleEvent, scope: ActivityScope): boolean {
  if (scope === "person") {
    return item.actorIds.includes(selectedPerson().id);
  }
  if (scope === "band") {
    const memberIds = new Set(selectedBand().memberIds);
    return item.actorIds.some((id) => memberIds.has(id));
  }
  if (scope === "village") {
    return item.locationId === selectedSettlement().id;
  }
  return item.factionIds.includes(selectedSociety().id);
}

function focusedActivityEvents(): ChronicleEvent[] {
  return world.events.filter((item) => {
    if (!eventMatchesActivityScope(item, activityScope)) {
      return false;
    }
    return activityCategory === "general" || eventActivityCategory(item) === activityCategory;
  });
}

function activityScopeName(scope: ActivityScope): string {
  if (scope === "person") {
    return formatPersonName(selectedPerson());
  }
  if (scope === "band") {
    return selectedBand().name;
  }
  if (scope === "village") {
    return selectedSettlement().name;
  }
  return selectedSociety().name;
}

function renderActivityEvent(item: ChronicleEvent): string {
  const location = item.locationId ? world.settlements[item.locationId]?.name : undefined;
  const category = eventActivityCategory(item);
  return `
    <article class="event activity-event ${item.kind} ${item.severity}">
      <span class="event-meta">Day ${item.day} · ${escapeHtml(category)}${location ? ` · ${escapeHtml(location)}` : ""}</span>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `;
}

function renderFocusedActivityPanel(): string {
  const scoped = world.events.filter((item) => eventMatchesActivityScope(item, activityScope));
  const events = focusedActivityEvents();
  return `
    <section class="panel activity-panel">
      <div class="panel-heading">
        <h2>Focused Activity</h2>
        <span>${escapeHtml(activityScopeName(activityScope))}</span>
      </div>
      <div class="scope-tab-row">
        ${activityScopes
          .map(
            (scope) =>
              `<button class="${activityScope === scope.id ? "selected" : ""}" data-action="set-activity-scope" data-scope="${scope.id}" type="button">${scope.label}</button>`
          )
          .join("")}
      </div>
      <div class="category-tab-row">
        ${activityCategories
          .map(
            (category) =>
              `<button class="${activityCategory === category.id ? "selected" : ""}" data-action="set-activity-category" data-category="${category.id}" type="button">${category.label}</button>`
          )
          .join("")}
      </div>
      <div class="activity-summary">
        ${statusPill("Scoped events", scoped.length)}
        ${statusPill("Shown", events.length)}
      </div>
      <div class="log-list activity-log-list">
        ${events.slice(0, 10).map(renderActivityEvent).join("") || `<p class="muted">No matching activity yet.</p>`}
      </div>
    </section>
  `;
}

function visibleChronicleEvents(): ChronicleEvent[] {
  if (chronicleView === "all") {
    return world.events;
  }
  return world.events.filter((item) => item.severity !== "low" || item.kind === "divine");
}

type DecisionTrace = World["lastDecisionScores"][number];

function splitDecisionAction(action: string): { verb: string; title: string } {
  const [verb, ...rest] = action.split(":");
  return rest.length ? { verb: verb.trim(), title: rest.join(":").trim() } : { verb: "Consider", title: action };
}

function decisionChipClass(part: string): string {
  const text = part.toLowerCase();
  if (text.includes("danger") || text.includes("threat") || text.includes("route")) return "risk";
  if (text.includes("legend") || text.includes("culture") || text.includes("identity")) return "story";
  if (text.includes("stats") || text.includes("perception") || text.includes("local")) return "capability";
  return "";
}

function renderDecisionReasonChips(reason: string): string {
  const parts = reason
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts
    .slice(0, 8)
    .map((part) => `<span class="${decisionChipClass(part)}">${escapeHtml(part)}</span>`)
    .join("");
}

function renderDecisionScore(score: DecisionTrace, index: number, leaderScore: number, nextScore?: number): string {
  const action = splitDecisionAction(score.action);
  const margin = index === 0 && nextScore !== undefined ? score.score - nextScore : leaderScore - score.score;
  const rankLabel = index === 0 ? "chosen" : `option ${index + 1}`;
  const marginLabel = index === 0 ? `+${Math.round(margin)} over next` : `-${Math.round(margin)} from lead`;
  return `
    <article class="score-row ${index === 0 ? "winner" : ""}">
      <div class="score-rank">
        <strong>${Math.round(score.score)}</strong>
        <span>${escapeHtml(rankLabel)}</span>
      </div>
      <div class="score-main">
        <div class="score-title-line">
          <span class="score-verb">${escapeHtml(action.verb)}</span>
          <strong>${escapeHtml(action.title)}</strong>
          <em>${escapeHtml(marginLabel)}</em>
        </div>
        <div class="score-chip-row">
          ${renderDecisionReasonChips(score.reason)}
        </div>
      </div>
    </article>
  `;
}

function renderChronicle(): void {
  const scores = world.lastDecisionScores;
  const leaderScore = scores[0]?.score ?? 0;
  const events = visibleChronicleEvents();
  chronicle.innerHTML = `
    ${renderAtlasPanel()}
    ${renderDoctrineControls()}
    <section class="panel decision-panel">
      <div class="panel-heading">
        <h2>Current Decision Trace</h2>
        <span>${escapeHtml(world.bands[world.deity.favoredBandId]?.name ?? "No favored band")}</span>
      </div>
      <div class="score-list">
        ${
          scores.length
            ? scores
                .map((score, index) => renderDecisionScore(score, index, leaderScore, scores[index + 1]?.score))
                .join("")
            : `<p class="muted">The next choice will appear after a tick.</p>`
        }
      </div>
    </section>
    ${renderFocusedActivityPanel()}
    <section class="panel log-panel">
      <div class="panel-heading">
        <h2>Chronicle</h2>
        <span>${events.length}/${world.events.length} shown</span>
      </div>
      <div class="tab-row">
        <button class="${chronicleView === "major" ? "selected" : ""}" data-action="set-chronicle-view" data-view="major" type="button">Major</button>
        <button class="${chronicleView === "all" ? "selected" : ""}" data-action="set-chronicle-view" data-view="all" type="button">All</button>
      </div>
      <div class="log-list">
        ${events.slice(0, 80).map(renderChronicleEvent).join("")}
      </div>
    </section>
  `;
}

function renderFaction(faction: Faction): string {
  const wars = faction.activeWars.map((id) => world.factions[id]?.name).filter(Boolean);
  const culture = world.cultures[faction.cultureId];
  const research = culture ? culturePracticeDefinitions[culture.research.practiceId] : undefined;
  const researchText =
    culture && research ? `${culture.name} L${culture.level} · ${research.name} ${Math.round((culture.research.progress / research.cost) * 100)}%` : "no culture";
  return `
    <button class="faction-row ${selectedSociety().id === faction.id ? "selected" : ""}" data-faction-id="${faction.id}" style="--faction-color:${faction.color}" type="button">
      <span class="swatch"></span>
      <div>
        <strong>${escapeHtml(faction.name)}</strong>
        <small>${escapeHtml(`${faction.kind} · ${researchText}`)}${wars.length ? ` · war with ${escapeHtml(wars.join(", "))}` : ""}</small>
      </div>
      <span>${Math.round(faction.stability)} stab</span>
    </button>
  `;
}

function organizationRecords(): Organization[] {
  return (Object.values(world.organizations ?? {}) as Organization[]).sort(
    (a, b) => b.influence - a.influence || b.wealth - a.wealth || a.name.localeCompare(b.name)
  );
}

function assetRecords(): Asset[] {
  return (Object.values(world.assets ?? {}) as Asset[]).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function agreementRecords(): Agreement[] {
  return (Object.values(world.agreements ?? {}) as Agreement[]).sort((a, b) => b.pressure - a.pressure || b.value - a.value || a.name.localeCompare(b.name));
}

function selectedOrganization(): Organization | undefined {
  return selectedOrganizationId ? world.organizations?.[selectedOrganizationId] : undefined;
}

function renderFactionChip(factionId: string | undefined): string {
  const faction = factionId ? world.factions[factionId] : undefined;
  if (!faction) {
    return `<span class="link-chip static">Society unknown</span>`;
  }
  return `<button class="link-chip" data-faction-id="${escapeHtml(faction.id)}" type="button">${escapeHtml(faction.name)}</button>`;
}

function renderSettlementChip(settlementId: string | undefined): string {
  const settlement = settlementId ? world.settlements[settlementId] : undefined;
  return `<span class="link-chip static">${escapeHtml(settlement?.name ?? "Unplaced")}</span>`;
}

function renderCultureChip(cultureId: string | undefined): string {
  const culture = cultureId ? world.cultures[cultureId] : undefined;
  return `<span class="link-chip static">${escapeHtml(culture?.name ?? "No culture")}</span>`;
}

function renderPersonChip(personId: string | undefined): string {
  const person = personId ? world.persons[personId] : undefined;
  return `<span class="link-chip static">${escapeHtml(person ? formatPersonName(person) : "No leader")}</span>`;
}

function renderOrganizationChip(organizationId: string | undefined): string {
  const organization = organizationId ? world.organizations?.[organizationId] : undefined;
  if (!organization) {
    return `<span class="link-chip static">Organization unknown</span>`;
  }
  return `<button class="link-chip" data-organization-id="${escapeHtml(organization.id)}" type="button">${escapeHtml(organization.name)}</button>`;
}

function renderLegalEntityChip(ref: LegalEntityRef): string {
  if (ref.kind === "faction") {
    return renderFactionChip(ref.id);
  }
  if (ref.kind === "organization") {
    return renderOrganizationChip(ref.id);
  }
  if (ref.kind === "settlement") {
    return renderSettlementChip(ref.id);
  }
  if (ref.kind === "person") {
    return renderPersonChip(ref.id);
  }
  const band = world.bands[ref.id];
  return `<span class="link-chip static">${escapeHtml(band?.name ?? ref.id)}</span>`;
}

function renderTokenStrip(values: readonly string[], limit = 4): string {
  const tokens = values.slice(0, limit);
  if (tokens.length === 0) {
    return "";
  }
  return `<div class="token-strip">${tokens.map((value) => `<span>${escapeHtml(titleLabel(value))}</span>`).join("")}</div>`;
}

function renderLinkedAssetChip(assetId: string): string {
  const asset = world.assets?.[assetId];
  return `<span class="link-chip static">${escapeHtml(asset?.name ?? assetId)}</span>`;
}

function renderLinkedAgreementChip(agreementId: string): string {
  const agreement = world.agreements?.[agreementId];
  return `<span class="link-chip static">${escapeHtml(agreement?.name ?? agreementId)}</span>`;
}

function renderGroupOutlook(outlook: GroupOutlook): string {
  const dominant = identityAxisKeys
    .map((key) => ({ key, value: outlook.identity[key] ?? 0 }))
    .filter((entry) => Math.abs(entry.value) >= 8)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.key.localeCompare(b.key))
    .slice(0, 3);
  return `
    <div class="outlook-grid">
      ${statusPill("Reputation", Math.round(outlook.reputation))}
      ${statusPill("Cohesion", Math.round(outlook.cohesion))}
      ${statusPill("Legitimacy", Math.round(outlook.legitimacy))}
      ${statusPill("Secrecy", Math.round(outlook.secrecy))}
    </div>
    <div class="outlook-axis-list">
      ${
        dominant
          .map(
            ({ key, value }) => `
              <span>
                <strong>${escapeHtml(identityAxisInfo[key].label)}</strong>
                ${escapeHtml(`${identityPoleLabel(key, value)} ${value >= 0 ? "+" : ""}${Math.round(value)}`)}
              </span>
            `
          )
          .join("") || `<span><strong>Temperament</strong>Balanced</span>`
      }
    </div>
    ${renderTokenStrip(outlook.priorities, 3)}
  `;
}

function renderOrganizationCard(organization: Organization): string {
  const leader = organization.leaderPersonId ? world.persons[organization.leaderPersonId] : undefined;
  const memberNames = organization.memberIds
    .map((id) => world.persons[id])
    .filter((person): person is Person => Boolean(person))
    .slice(0, 3)
    .map((person) => person.name)
    .join(", ");
  const selected = organization.id === selectedOrganizationId;
  return `
    <article class="organization-card ${selected ? "selected" : ""}">
      <div class="record-heading">
        <button class="record-select" data-organization-id="${escapeHtml(organization.id)}" type="button">
          <strong>${escapeHtml(organization.name)}</strong>
          <small>${escapeHtml(`${titleLabel(organization.kind)} · ${titleLabel(organization.status)}`)}</small>
        </button>
        <span class="status-token">${escapeHtml(titleLabel(organization.status))}</span>
      </div>
      <div class="chip-row">
        ${renderFactionChip(organization.factionId)}
        ${renderSettlementChip(organization.homeSettlementId)}
        ${renderCultureChip(organization.cultureId)}
        ${renderPersonChip(organization.leaderPersonId)}
      </div>
      <div class="record-stat-grid">
        ${statusPill("Wealth", Math.round(organization.wealth))}
        ${statusPill("Influence", Math.round(organization.influence))}
        ${statusPill("Members", organization.memberIds.length)}
        ${statusPill("Assets", organization.assetIds.length)}
      </div>
      ${renderGroupOutlook(organization.outlook)}
      <div class="record-notes">
        <span>Members <strong>${escapeHtml(memberNames || (leader ? leader.name : "none"))}</strong></span>
        <span>Agreements <strong>${escapeHtml(String(organization.agreementIds.length))}</strong></span>
      </div>
      <div class="chip-row compact">
        ${organization.assetIds.slice(0, 4).map(renderLinkedAssetChip).join("")}
        ${organization.agreementIds.slice(0, 2).map(renderLinkedAgreementChip).join("")}
      </div>
      ${renderTokenStrip([...organization.tags, ...organization.outlook.taboos], 5)}
    </article>
  `;
}

function assetTouchesSelectedOrganization(asset: Asset): boolean {
  return Boolean(
    selectedOrganizationId &&
      ((asset.owner.kind === "organization" && asset.owner.id === selectedOrganizationId) ||
        (asset.operator.kind === "organization" && asset.operator.id === selectedOrganizationId))
  );
}

function renderAssetCard(asset: Asset): string {
  const agreement = asset.agreementId ? world.agreements?.[asset.agreementId] : undefined;
  const selected = assetTouchesSelectedOrganization(asset);
  return `
    <article class="organization-card asset-card ${selected ? "selected" : ""}">
      <div class="record-heading">
        <div class="record-title">
          <strong>${escapeHtml(asset.name)}</strong>
          <small>${escapeHtml(`${titleLabel(asset.kind)} · ${titleLabel(asset.status)}`)}</small>
        </div>
        <span class="status-token">${Math.round(asset.integrity)}%</span>
      </div>
      <div class="chip-row">
        ${renderSettlementChip(asset.locationId)}
        ${renderLegalEntityChip(asset.owner)}
        ${renderLegalEntityChip(asset.operator)}
      </div>
      <div class="record-stat-grid">
        ${statusPill("Value", Math.round(asset.value))}
        ${statusPill("Integrity", `${Math.round(asset.integrity)}%`)}
        ${statusPill("Outputs", asset.outputTags.length)}
        ${statusPill("Agreement", agreement ? titleLabel(agreement.kind) : "none")}
      </div>
      <div class="record-notes">
        <span>Charter <strong>${escapeHtml(agreement?.name ?? "unchartered")}</strong></span>
        <span>Founded <strong>Tick ${Math.round(asset.foundedTick)}</strong></span>
      </div>
      ${renderTokenStrip([...asset.outputTags, ...asset.tags], 7)}
    </article>
  `;
}

function agreementTouchesSelectedOrganization(agreement: Agreement): boolean {
  return Boolean(selectedOrganizationId && agreement.parties.some((party) => party.kind === "organization" && party.id === selectedOrganizationId));
}

function renderAgreementCard(agreement: Agreement): string {
  const selected = agreementTouchesSelectedOrganization(agreement);
  return `
    <article class="organization-card agreement-card ${selected ? "selected" : ""}">
      <div class="record-heading">
        <div class="record-title">
          <strong>${escapeHtml(agreement.name)}</strong>
          <small>${escapeHtml(`${titleLabel(agreement.kind)} · ${titleLabel(agreement.status)}`)}</small>
        </div>
        <span class="status-token">${Math.round(agreement.pressure)} pressure</span>
      </div>
      <div class="chip-row">
        ${agreement.parties.map(renderLegalEntityChip).join("")}
        ${renderSettlementChip(agreement.locationId)}
      </div>
      <div class="record-stat-grid">
        ${statusPill("Value", Math.round(agreement.value))}
        ${statusPill("Pressure", Math.round(agreement.pressure))}
        ${statusPill("Assets", agreement.assetIds.length)}
        ${statusPill("Signed", `Tick ${Math.round(agreement.signedTick)}`)}
      </div>
      <div class="record-notes">
        ${agreement.terms.slice(0, 3).map((term) => `<span>Term <strong>${escapeHtml(term)}</strong></span>`).join("") || `<span>Term <strong>customary law</strong></span>`}
      </div>
      <div class="chip-row compact">
        ${agreement.assetIds.slice(0, 5).map(renderLinkedAssetChip).join("")}
      </div>
      ${renderTokenStrip(agreement.tags, 5)}
    </article>
  `;
}

function renderOrganizationEconomyPanel(): string {
  const organizations = organizationRecords();
  const assets = assetRecords();
  const agreements = agreementRecords();
  const focus = selectedOrganization();
  const orderedAssets = [...assets].sort((a, b) => Number(assetTouchesSelectedOrganization(b)) - Number(assetTouchesSelectedOrganization(a)) || b.value - a.value);
  const orderedAgreements = [...agreements].sort(
    (a, b) => Number(agreementTouchesSelectedOrganization(b)) - Number(agreementTouchesSelectedOrganization(a)) || b.pressure - a.pressure
  );
  const body =
    organizationView === "assets"
      ? orderedAssets.slice(0, 10).map(renderAssetCard).join("") || `<p class="muted">No assets recorded.</p>`
      : organizationView === "agreements"
        ? orderedAgreements.slice(0, 10).map(renderAgreementCard).join("") || `<p class="muted">No agreements recorded.</p>`
        : organizations.slice(0, 10).map(renderOrganizationCard).join("") || `<p class="muted">No organizations recorded.</p>`;

  return `
    <section class="panel organization-panel">
      <div class="panel-heading">
        <h2>Organizations</h2>
        <span>${organizations.length} groups · ${assets.length} assets · ${agreements.length} agreements</span>
      </div>
      <div class="organization-tab-row">
        <button class="${organizationView === "groups" ? "selected" : ""}" data-action="set-organization-view" data-view="groups" type="button">Groups</button>
        <button class="${organizationView === "assets" ? "selected" : ""}" data-action="set-organization-view" data-view="assets" type="button">Assets</button>
        <button class="${organizationView === "agreements" ? "selected" : ""}" data-action="set-organization-view" data-view="agreements" type="button">Agreements</button>
      </div>
      ${
        focus
          ? `
            <div class="focus-strip">
              <span>Focus</span>
              <strong>${escapeHtml(focus.name)}</strong>
              <em>${escapeHtml(`${titleLabel(focus.kind)} · ${focus.memberIds.length} members`)}</em>
            </div>
          `
          : ""
      }
      <div class="organization-list">
        ${body}
      </div>
    </section>
  `;
}

function renderCulture(culture: CultureState): string {
  const society = Object.values(world.factions).find((candidate) => candidate.cultureId === culture.id);
  const research = culturePracticeDefinitions[culture.research.practiceId];
  const completed = culture.completedPracticeIds
    .map((id) => culturePracticeDefinitions[id]?.name ?? id)
    .slice(-4)
    .join(", ");
  const recipes = (culture.knownRecipeIds ?? [])
    .map((id) => recipeList.find((recipe) => recipe.id === id)?.name ?? id)
    .slice(-4)
    .join(", ");
  const parents = (culture.parentCultureIds ?? []).map(cultureName).join(" + ");
  const ancestry = Object.entries(culture.ancestryWeights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key, value]) => `${key} ${Math.round(value)}`)
    .join(", ");
  return `
    <div class="ability-row compact">
      <div>
        <strong>${escapeHtml(culture.name)}</strong>
        <span>${escapeHtml(`L${culture.level}`)}</span>
      </div>
      <small>${escapeHtml(`${society?.name ?? "unclaimed"} · cohesion ${Math.round(culture.cohesion)} · tradition ${Math.round(culture.tradition)}`)}</small>
      ${parents ? `<small>${escapeHtml(`Hybrid: ${parents}`)}</small>` : ""}
      ${ancestry ? `<small>${escapeHtml(`Ancestry: ${ancestry}`)}</small>` : ""}
      ${research ? meter(research.name, culture.research.progress, research.cost) : ""}
      <small>${escapeHtml(completed ? `Practices: ${completed}` : "Practices: none")}</small>
      <small>${escapeHtml(recipes ? `Recipes: ${recipes}` : "Recipes: none")}</small>
    </div>
  `;
}

function storyLocationName(locationId: string): string {
  return world.settlements[locationId]?.name ?? "unknown";
}

function topLegendHook(hooks: LegendHook[]): LegendHook | undefined {
  return [...hooks].sort((a, b) => b.pressure - a.pressure || b.createdTick - a.createdTick)[0];
}

function renderLegendHook(hooks: LegendHook[]): string {
  const hook = topLegendHook(hooks);
  if (!hook) {
    return "";
  }
  return `<small>${escapeHtml(`Next ${hook.kind}: ${hook.text} · ${questKindLabels[hook.questKind]} · pressure ${Math.round(hook.pressure)}`)}</small>`;
}

function renderArtifactLegend(artifact: StoryArtifact): string {
  const holder = artifact.holderPersonId ? world.persons[artifact.holderPersonId] : undefined;
  const guardian = artifact.guardedByBossId ? world.story.bosses[artifact.guardedByBossId] : undefined;
  const status = holder ? `held by ${formatPersonName(holder)}` : artifact.status;
  const last = artifact.history[0]?.text;
  const resonant = artifact.resonantPersonId ? world.persons[artifact.resonantPersonId] : undefined;
  const birthright = [
    ...(artifact.birthrightFamilyName ? [`${artifact.birthrightFamilyName} line`] : []),
    ...(artifact.birthrightAncestry ? [`${artifact.birthrightAncestry} ancestry`] : []),
    ...(artifact.birthrightCultureIds ?? []).map(cultureName)
  ].slice(0, 3);
  return `
    <div class="ability-row compact">
      <div>
        <strong>${escapeHtml(artifact.name)}</strong>
        <span>${escapeHtml(artifact.tone)}</span>
      </div>
      <small>${escapeHtml(`${status} · power ${artifact.power} · fame ${Math.round(artifact.fame)} · attune ${Math.round(artifact.attunement)} · corrupt ${Math.round(artifact.corruption)}`)}</small>
      <small>${escapeHtml(`${storyLocationName(artifact.locationId)}${guardian?.status === "active" ? ` · guarded by ${guardian.name}` : ""}`)}</small>
      ${birthright.length ? `<small>${escapeHtml(`Birthright: ${birthright.join(" · ")}${resonant ? ` · answered ${formatPersonName(resonant)}` : ""}`)}</small>` : ""}
      <small>${escapeHtml(artifact.legend)}</small>
      ${renderLegendHook(artifact.hooks)}
      ${last ? `<small>${escapeHtml(last)}</small>` : ""}
    </div>
  `;
}

function renderBossLegend(boss: StoryBoss): string {
  const last = boss.history[0]?.text;
  return `
    <div class="ability-row compact">
      <div>
        <strong>${escapeHtml(boss.name)}</strong>
        <span>${escapeHtml(`${boss.status} · ${boss.legacy}`)}</span>
      </div>
      <small>${escapeHtml(`${storyLocationName(boss.locationId)} · power ${boss.power} · dread ${Math.round(boss.dread)} · following ${Math.round(boss.following)}`)}</small>
      <small>${escapeHtml(`wants to ${boss.desire}`)}</small>
      ${renderLegendHook(boss.hooks)}
      ${boss.status === "active" ? meter("Threat", boss.threat) : ""}
      ${last ? `<small>${escapeHtml(last)}</small>` : ""}
    </div>
  `;
}

function renderCrisisLegend(crisis: StoryCrisis): string {
  const society = world.factions[crisis.factionId];
  const last = crisis.history[0]?.text;
  return `
    <div class="ability-row compact">
      <div>
        <strong>${escapeHtml(crisis.name)}</strong>
        <span>${escapeHtml(`${crisis.status} · ${crisis.myth}`)}</span>
      </div>
      <small>${escapeHtml(`${crisis.kind} · ${storyLocationName(crisis.locationId)} · ${society?.name ?? "unknown society"}`)}</small>
      <small>${escapeHtml(`trust ${Math.round(crisis.publicTrust)} · radical ${Math.round(crisis.radicalization)}`)}</small>
      ${renderLegendHook(crisis.hooks)}
      ${meter("Severity", crisis.severity)}
      ${meter("Progress", crisis.progress, 120)}
      ${last ? `<small>${escapeHtml(last)}</small>` : ""}
    </div>
  `;
}

function renderStoryPanel(): string {
  const artifacts = Object.values(world.story.artifacts).sort((a, b) => b.power - a.power).slice(0, 4);
  const bosses = Object.values(world.story.bosses)
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.power - a.power)
    .slice(0, 4);
  const crises = Object.values(world.story.crises)
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.severity - a.severity)
    .slice(0, 4);
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Legends</h2>
        <span>artifacts, bosses, crises</span>
      </div>
      <div class="ability-list">
        ${bosses.map(renderBossLegend).join("")}
        ${crises.map(renderCrisisLegend).join("")}
        ${artifacts.map(renderArtifactLegend).join("")}
      </div>
    </section>
  `;
}

function featureLocation(feature: WorldFeature): string {
  return world.settlements[feature.nearestSettlementId]?.name ?? world.planet.regions[feature.regionId]?.name ?? "unknown";
}

function renderFeature(feature: WorldFeature): string {
  const holding = feature.holdingId ? world.planet.holdings[feature.holdingId] : undefined;
  const depth =
    feature.layer === "sky"
      ? `${Math.round(feature.altitudeMeters)}m alt`
      : feature.layer === "surface"
        ? `${Math.round(feature.altitudeMeters)}m`
        : `${Math.round(feature.depthMeters)}m deep`;
  return `
    <div class="ability-row compact feature-row ${feature.status}">
      <div>
        <strong>${escapeHtml(feature.name)}</strong>
        <span>${escapeHtml(feature.status)}</span>
      </div>
      <small>${escapeHtml(`${layerLabels[feature.layer]} · ${featureKindLabels[feature.kind]} · ${featureLocation(feature)} · ${depth}`)}</small>
      <small>${escapeHtml(`rich ${Math.round(feature.richness)} · danger ${Math.round(feature.danger)} · stable ${Math.round(feature.stability)} · explored ${Math.round(feature.exploration)}%`)}</small>
      <small>${escapeHtml(`${feature.resources.slice(0, 3).join(", ")}${holding ? ` · ${holding.name}` : ""}`)}</small>
      ${holding ? renderHolding(holding) : feature.depletion > 0 ? meter("Depletion", feature.depletion) : ""}
    </div>
  `;
}

function renderHolding(holding: TerrainHolding): string {
  return `
    <small>${escapeHtml(`${holding.kind.replace("-", " ")} · ${holding.status} · ${holding.outputResource} stock ${Math.round(holding.stockpile)}`)}</small>
    ${meter("Integrity", holding.integrity)}
  `;
}

function renderTerrainWorksPanel(): string {
  const features = Object.values(world.planet.features ?? {});
  const known = features
    .filter((feature) => feature.status !== "hidden")
    .sort((a, b) => Number(b.status === "claimed") - Number(a.status === "claimed") || b.richness - a.richness || b.danger - a.danger);
  const hiddenCount = features.length - known.length;
  const holdings = Object.values(world.planet.holdings ?? {});
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Terrain Works</h2>
        <span>${known.length} known · ${hiddenCount} hidden · ${holdings.length} holdings</span>
      </div>
      <div class="ability-list terrain-work-list">
        ${known.slice(0, 8).map(renderFeature).join("") || `<p class="muted">No known sites yet.</p>`}
      </div>
    </section>
  `;
}

function renderQuest(quest: Quest): string {
  const settlement = world.settlements[quest.locationId];
  const issuer = world.factions[quest.issuerFactionId];
  const storyLabel = quest.storyKind ? ` · ${quest.storyKind}` : "";
  return `
    <div class="quest-row ${quest.status}">
      <div>
        <strong>${escapeHtml(quest.title)}</strong>
        <small>${escapeHtml(`${questKindLabels[quest.kind]}${storyLabel}`)} · ${escapeHtml(settlement.name)} · ${escapeHtml(issuer.name)}</small>
      </div>
      <span>${quest.status} · ${quest.progress}%</span>
    </div>
  `;
}

function renderBandButton(band: Band): string {
  const leader = world.persons[band.leaderId];
  const isFavored = band.id === world.deity.favoredBandId;
  const travel = band.travel;
  return `
    <button class="band-row ${band.id === world.selectedBandId ? "selected" : ""}" data-band-id="${band.id}" type="button">
      <span>
        <strong>${escapeHtml(band.name)}</strong>
        <small>${escapeHtml(travel ? `traveling: ${bandTravelLabel(band)}` : formatPersonName(leader))}</small>
      </span>
      <span>${isFavored ? "favored" : travel ? `${Math.round((travel.progress / travel.total) * 100)}%` : `${band.memberIds.length} people`}</span>
    </button>
  `;
}

function renderRosterPanel(): string {
  const people = Object.values(world.persons);
  const living = people.filter((person) => person.alive);
  const dead = people.filter((person) => !person.alive);
  const shown =
    rosterView === "graveyard"
      ? dead.sort((a, b) => b.renown - a.renown || b.generation - a.generation)
      : living.sort((a, b) => b.renown - a.renown || b.age - a.age);
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>People</h2>
        <span>${living.length} living · ${dead.length} dead</span>
      </div>
      <div class="tab-row">
        <button class="${rosterView === "living" ? "selected" : ""}" data-action="set-roster-view" data-view="living" type="button">Living</button>
        <button class="${rosterView === "graveyard" ? "selected" : ""}" data-action="set-roster-view" data-view="graveyard" type="button">Graveyard</button>
      </div>
      <div class="person-list">
        ${shown.slice(0, 8).map(renderPersonMini).join("") || `<p class="muted">No one here yet.</p>`}
      </div>
    </section>
  `;
}

function renderWorldGeneratorPanel(): string {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>World Generator</h2>
        <span>${escapeHtml(world.generation.size)} · ${world.geography?.continents?.length ?? 0} continents</span>
      </div>
      <div class="control-grid">
        <label class="field">
          <span>Size</span>
          <select data-field="worldSize">
            ${(["small", "medium", "large"] as const)
              .map((value) => `<option value="${value}" ${worldGenDraft.size === value ? "selected" : ""}>${value}</option>`)
              .join("")}
          </select>
        </label>
        <label class="field">
          <span>Continents</span>
          <select data-field="worldContinents">
            ${[1, 2, 3, 4].map((value) => `<option value="${value}" ${worldGenDraft.continents === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="slider-field">
        <span>Landmass <strong>${worldGenDraft.landmass}%</strong></span>
        <input data-field="worldLandmass" type="range" min="20" max="90" value="${worldGenDraft.landmass}" />
      </label>
      <label class="slider-field">
        <span>Ocean <strong>${worldGenDraft.ocean}%</strong></span>
        <input data-field="worldOcean" type="range" min="10" max="80" value="${worldGenDraft.ocean}" />
      </label>
      <label class="slider-field">
        <span>Climate Wetness <strong>${worldGenDraft.climate}%</strong></span>
        <input data-field="worldClimate" type="range" min="0" max="100" value="${worldGenDraft.climate}" />
      </label>
      <button class="full-button" data-action="generate-world" type="button">Generate World</button>
    </section>
  `;
}

function renderMediumSummary(): string {
  const band = selectedBand();
  const route = band.travel ? world.planet.routes[band.travel.routeId] : undefined;
  const routeBiome = route ? world.planet.biomes[route.biomeId] : undefined;
  const knownFeatures = Object.values(world.planet.features ?? {}).filter((feature) => feature.status !== "hidden").length;
  const regions = Object.values(world.planet.regions);
  const elevationMin = Math.min(...regions.map((region) => region.elevationMin));
  const elevationMax = Math.max(...regions.map((region) => region.elevationMax));
  const movingBands = Object.values(world.bands).filter((item) => Boolean(item.travel)).length;
  const activeBosses = Object.values(world.story.bosses ?? {}).filter((boss) => boss.status === "active").length;
  const activeCrises = Object.values(world.story.crises ?? {}).filter((crisis) => crisis.status === "active").length;
  const weatherFronts = Object.values(world.weather?.fronts ?? {});
  const contestedTerritories = Object.values(world.territories ?? {}).filter((territory) => territory.borderPressure > 55).length;
  const sectorCount = Object.keys(world.geography?.sectors ?? {}).length;
  const tileCount = Object.keys(world.geography?.tiles ?? {}).length;
  const oceanCount = world.geography?.oceans?.length ?? 0;
  const organizationCount = Object.keys(world.organizations ?? {}).length;
  const assetCount = Object.keys(world.assets ?? {}).length;
  const settlementBuildings = Object.values(world.settlements).flatMap((settlement) => settlement.buildings ?? []);
  const buildOrders = Object.values(world.settlements).flatMap((settlement) => settlement.buildOrders ?? []);
  const agreements = Object.values(world.agreements ?? {}) as Agreement[];
  const activeAgreementCount = agreements.filter((agreement) => agreement.status === "active" || agreement.status === "strained").length;
  const renderRegionLabel = (regionName: string, biomeName: string): string =>
    regionName === biomeName ? biomeName : `${regionName} · ${biomeName}`;
  const overlayLegend =
    atlasOverlay === "elevation"
      ? { icon: "legend-elevation", label: "elevation fill" }
      : atlasOverlay === "threat"
        ? { icon: "legend-threat", label: "danger fill" }
        : atlasOverlay === "political"
          ? { icon: "legend-political", label: "society fill" }
          : { icon: "legend-biome", label: "biome fill" };
  return `
    <div class="medium-summary">
      ${statusPill("Medium", world.planet.name)}
      ${statusPill("Climate", world.planet.climate)}
      ${statusPill("Routes", Object.keys(world.planet.routes).length)}
      ${statusPill("Elevation", `${Math.round(elevationMin)}-${Math.round(elevationMax)}m`)}
      ${statusPill("Sectors", `${sectorCount} · ${tileCount} tiles`)}
      ${statusPill("Oceans", oceanCount)}
      ${statusPill("Sites", `${knownFeatures}/${Object.keys(world.planet.features ?? {}).length}`)}
      ${statusPill("Holdings", Object.keys(world.planet.holdings ?? {}).length)}
      ${statusPill("Groups", `${organizationCount} · ${assetCount} assets`)}
      ${statusPill("Agreements", `${activeAgreementCount}/${agreements.length} active`)}
      ${statusPill("Buildings", settlementBuildings.length)}
      ${statusPill("Build orders", buildOrders.filter((order) => order.status === "queued" || order.status === "building").length)}
      ${statusPill("Bands moving", movingBands)}
      ${statusPill("Threats", `${activeBosses} bosses · ${activeCrises} crises`)}
      ${statusPill("Territories", `${Object.keys(world.territories ?? {}).length} · ${contestedTerritories} contested`)}
      ${statusPill("Weather", `${world.weather?.season ?? "spring"} · ${weatherFronts.length} fronts`)}
      ${statusPill("Current route", route && routeBiome ? `${routeBiome.name} · ${route.topography} · pass ${route.passDifficulty}` : "settled")}
    </div>
    <div class="map-legend">
      <span><i class="${overlayLegend.icon}"></i>${overlayLegend.label}</span>
      <span><i class="legend-settlement"></i>settlement</span>
      <span><i class="legend-route"></i>priority route</span>
      <span><i class="legend-feature"></i>site/resource</span>
      <span><i class="legend-band"></i>watched band</span>
      <span><i class="legend-threat"></i>threat</span>
      <span><i class="legend-territory"></i>territory claim</span>
      <span><i class="legend-weather"></i>weather front</span>
      <span><i class="legend-border"></i>settlement border</span>
      <span><i class="legend-building"></i>local building</span>
    </div>
    <div class="region-strip">
      ${Object.values(world.planet.regions)
        .map(
          (region) => `
            <span style="--region-color:${region.color}">
              <i></i>
              ${escapeHtml(renderRegionLabel(region.name, world.planet.biomes[region.biomeId]?.name ?? region.terrain))}
            </span>
          `
        )
        .join("")}
    </div>
    <div class="biome-detail-list">
      ${Object.values(world.planet.regions)
        .map(
          (region) => `
            <div>
              <strong>${escapeHtml(world.planet.biomes[region.biomeId]?.name ?? region.name)}</strong>
              <span>${escapeHtml(`${region.topography} · ${region.elevationMin}-${region.elevationMax}m · pass ${region.passDifficulty}`)}</span>
              <small>${escapeHtml(region.resources.slice(0, 2).join(", "))}</small>
              <small>${escapeHtml(`${region.flora.slice(0, 2).join(", ")} · ${region.fauna.slice(0, 2).join(", ")}`)}</small>
              <small>${escapeHtml(region.threats.slice(0, 2).join(", "))}</small>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAtlasPanel(): string {
  const settlement = selectedSettlement();
  const biome = world.planet.biomes[settlement.biomeId];
  const faction = world.factions[settlement.factionId];
  const bandsHere = Object.values(world.bands).filter((band) => !band.travel && band.locationId === settlement.id);
  const buildings = settlement.buildings ?? [];
  const activeOrders = (settlement.buildOrders ?? []).filter((order) => order.status === "queued" || order.status === "building");
  const dayPhase = timeOfDay();
  return `
    <section class="panel map-panel">
      <div class="panel-heading">
        <h2>${escapeHtml(world.planet.name)}</h2>
        <span>${escapeHtml(atlasZoomModes.find((mode) => mode.id === atlasZoom)?.label ?? "Region")} atlas</span>
      </div>
      <div class="map-toolbar">
        <div class="map-control-group" aria-label="Map zoom">
          ${atlasZoomModes
            .map(
              (mode) =>
                `<button class="map-layer-button ${atlasZoom === mode.id ? "selected" : ""}" data-action="set-atlas-zoom" data-zoom="${mode.id}" type="button">${mode.label}</button>`
            )
            .join("")}
        </div>
        <div class="map-control-group" aria-label="Map overlay">
          ${atlasOverlayModes
            .map(
              (mode) =>
                `<button class="map-layer-button ${atlasOverlay === mode.id ? "selected" : ""}" data-action="set-atlas-overlay" data-overlay="${mode.id}" type="button">${mode.label}</button>`
            )
            .join("")}
        </div>
      </div>
      <canvas id="world-map" width="1080" height="650"></canvas>
      <div class="map-inspector">
        <div>
          <strong>${escapeHtml(settlement.name)}</strong>
          <small>${escapeHtml(`${faction?.name ?? "unclaimed"} · ${biome?.name ?? settlement.terrain} · ${settlement.topography}`)}</small>
        </div>
        <div class="map-inspector-grid">
          ${statusPill("Pop", settlement.population)}
          ${statusPill("Threat", Math.round(settlement.threat))}
          ${statusPill("Elevation", `${Math.round(settlement.elevationMeters)}m`)}
          ${statusPill("Time", dayPhase.label)}
          ${statusPill("Buildings", buildings.length)}
          ${statusPill("Bands", bandsHere.length)}
          ${statusPill("Orders", activeOrders.length)}
        </div>
        <div class="map-hover-card empty">Open terrain</div>
      </div>
      ${renderMediumSummary()}
    </section>
  `;
}

function buildingCategoryColor(category: string): string {
  if (category === "defense") return "#c64737";
  if (category === "trade") return "#c6a64d";
  if (category === "craft") return "#a87048";
  if (category === "medicine") return "#7d8f5b";
  if (category === "faith") return "#d8c99e";
  if (category === "knowledge") return "#8f9aa3";
  if (category === "governance") return "#7f6a99";
  if (category === "infrastructure") return "#5d8b91";
  if (category === "food" || category === "water") return "#8fb28b";
  return "#d7d9cd";
}

function settlementAssets(settlement: Settlement): Asset[] {
  return Object.values(world.assets ?? {})
    .filter((asset) => asset.locationId === settlement.id)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function renderBuildingRow(building: SettlementBuilding): string {
  return `
    <div class="building-row" style="--building-color:${buildingCategoryColor(building.category)}">
      <i></i>
      <div>
        <strong>${escapeHtml(titleLabel(building.catalogId))}</strong>
        <small>${escapeHtml(`${titleLabel(building.category)} · L${building.level} · ${titleLabel(building.status)}`)}</small>
      </div>
      <span>${Math.round(building.integrity)}%</span>
    </div>
  `;
}

function renderSettlementDevelopmentPanel(): string {
  const settlement = selectedSettlement();
  const buildings = [...(settlement.buildings ?? [])].sort(
    (a, b) => b.level - a.level || b.integrity - a.integrity || a.catalogId.localeCompare(b.catalogId)
  );
  const borders = settlement.borders ?? [];
  const orders = [...(settlement.buildOrders ?? [])]
    .filter((order) => order.status === "queued" || order.status === "building")
    .sort((a, b) => b.priority - a.priority || b.pressure - a.pressure || a.name.localeCompare(b.name));
  const assets = settlementAssets(settlement);
  const largestBorder = [...borders].sort((a, b) => b.radius - a.radius)[0];
  return `
    <section class="panel settlement-panel">
      <div class="panel-heading">
        <h2>${escapeHtml(settlement.name)}</h2>
        <span>built environment</span>
      </div>
      <div class="pill-grid">
        ${statusPill("Population", settlement.population)}
        ${statusPill("Prosperity", Math.round(settlement.prosperity))}
        ${statusPill("Defense", Math.round(settlement.defense))}
        ${statusPill("Threat", Math.round(settlement.threat))}
        ${statusPill("Buildings", buildings.length)}
        ${statusPill("Assets", assets.length)}
        ${statusPill("Borders", borders.length)}
        ${statusPill("Orders", orders.length)}
      </div>
      <div class="settlement-border-summary">
        <span>
          <strong>${escapeHtml(titleLabel(largestBorder?.kind))}</strong>
          ${escapeHtml(largestBorder ? `${titleLabel(largestBorder.status)} · coverage ${Math.round(largestBorder.coverage)}% · gates ${largestBorder.gateCount}` : "No border survey")}
        </span>
      </div>
      <div class="building-list">
        ${buildings.slice(0, 8).map(renderBuildingRow).join("") || `<p class="muted">No buildings recorded.</p>`}
      </div>
      ${
        orders.length
          ? `<h4>Build Orders</h4>
             <div class="build-order-list">
               ${orders
                 .slice(0, 3)
                 .map(
                   (order) => `
                     <div class="build-order-row">
                       <div>
                         <strong>${escapeHtml(order.name)}</strong>
                         <small>${escapeHtml(`${titleLabel(order.status)} · priority ${Math.round(order.priority)} · ${order.reason}`)}</small>
                       </div>
                       ${meter("Progress", order.progress, 100)}
                     </div>
                   `
                 )
                 .join("")}
             </div>`
          : ""
      }
      ${assets.length ? `<h4>Local Assets</h4>${renderTokenStrip(assets.flatMap((asset) => [asset.name, ...asset.outputTags]).slice(0, 8), 8)}` : ""}
    </section>
  `;
}

function renderRightRail(): void {
  const quests = Object.values(world.quests)
    .filter((quest) => quest.status === "open" || quest.status === "active")
    .sort((a, b) => {
      const statusOrder = a.status === "active" ? -1 : b.status === "active" ? 1 : 0;
      return statusOrder || b.danger - a.danger;
    });

  rightRail.innerHTML = `
    ${renderSettlementDevelopmentPanel()}
    ${renderWorldGeneratorPanel()}
    ${renderRosterPanel()}
    <section class="panel">
      <div class="panel-heading">
        <h2>Bands</h2>
        <span>Pick a focus</span>
      </div>
      <div class="band-list">
        ${Object.values(world.bands).map(renderBandButton).join("")}
      </div>
      <button class="full-button" data-action="favor-selected-band" type="button">Favor Selected Band</button>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h2>Societies</h2>
        <span>empire pressure</span>
      </div>
      <div class="faction-list">
        ${Object.values(world.factions).map(renderFaction).join("")}
      </div>
    </section>
    ${renderOrganizationEconomyPanel()}
    <section class="panel">
      <div class="panel-heading">
        <h2>Cultures</h2>
        <span>research traditions</span>
      </div>
      <div class="ability-list">
        ${Object.values(world.cultures).map(renderCulture).join("")}
      </div>
    </section>
    ${renderTerrainWorksPanel()}
    ${renderStoryPanel()}
    <section class="panel">
      <div class="panel-heading">
        <h2>Compendium</h2>
        <span>${abilityList.length} arts · ${recipeList.length} recipes</span>
      </div>
      <div class="ability-list compendium-list">
        ${abilityList.map((ability) => renderAbilityRow(ability, true)).join("")}
        ${recipeList.map((recipe) => renderRecipeRow(recipe, true)).join("")}
      </div>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h2>Contracts</h2>
        <span>active world needs</span>
      </div>
      <div class="quest-list">
        ${quests.slice(0, 9).map(renderQuest).join("")}
      </div>
    </section>
  `;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface MapPoint {
  x: number;
  y: number;
  groundY: number;
  lift: number;
}

interface MapLabel {
  text: string;
  x: number;
  y: number;
  priority: number;
  color?: string;
  alpha?: number;
  align?: CanvasTextAlign;
  size?: number;
  weight?: number;
}

interface CanvasPoint {
  x: number;
  y: number;
}

interface PlanetProjection {
  x: number;
  y: number;
  z: number;
  scale: number;
  visible: boolean;
}

interface WorldGridMetrics {
  columns: number;
  rows: number;
  tileRadius: number;
}

interface RegionSectorProjection {
  sector: World["geography"]["sectors"][string];
  x: number;
  y: number;
  radius: number;
}

interface TileProjection {
  tile: World["geography"]["tiles"][string];
  x: number;
  y: number;
  radius: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(value: string): RgbColor {
  const normalized = value.replace("#", "").trim();
  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized.slice(0, 6).padEnd(6, "0");
  const parsed = Number.parseInt(hex, 16);
  if (!Number.isFinite(parsed)) {
    return { r: 125, g: 143, b: 91 };
  }
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function mixRgb(a: RgbColor, b: RgbColor, amount: number): RgbColor {
  const t = clampNumber(amount, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

function rgbCss(color: RgbColor, alpha = 1): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function terrainNoise(x: number, y: number, salt: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7 + world.rngState * 0.00001) * 43758.5453123;
  return value - Math.floor(value);
}

function drawMapLabels(context: CanvasRenderingContext2D, labels: MapLabel[], width: number, height: number): void {
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const ordered = [...labels].sort((a, b) => b.priority - a.priority || a.y - b.y || a.text.localeCompare(b.text));
  context.save();
  for (const label of ordered) {
    const size = label.size ?? (label.priority >= 100 ? 17 : label.priority >= 52 ? 15 : 13);
    const weight = label.weight ?? (label.priority >= 52 ? 800 : 700);
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    const metrics = context.measureText(label.text);
    const labelWidth = metrics.width + 12;
    const labelHeight = size + 8;
    const align = label.align ?? "left";
    const x = clampNumber(label.x, align === "right" ? labelWidth : 4, width - (align === "left" ? labelWidth : 4));
    const y = clampNumber(label.y, 10, height - 10);
    const left = align === "right" ? x - labelWidth : align === "center" ? x - labelWidth / 2 : x;
    const rect = { x: left, y: y - labelHeight / 2, width: labelWidth, height: labelHeight };
    const overlaps = placed.some(
      (item) => rect.x < item.x + item.width && rect.x + rect.width > item.x && rect.y < item.y + item.height && rect.y + rect.height > item.y
    );
    if (overlaps && label.priority < 128) {
      continue;
    }
    placed.push(rect);
    context.globalAlpha = label.alpha ?? 1;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.lineWidth = Math.max(3, size * 0.28);
    context.strokeStyle = "rgba(7, 10, 8, 0.94)";
    context.strokeText(label.text, x, y);
    context.lineWidth = Math.max(1.5, size * 0.13);
    context.strokeStyle = "rgba(244, 234, 216, 0.2)";
    context.strokeText(label.text, x, y);
    context.fillStyle = label.color ?? "#f4ead8";
    context.fillText(label.text, x, y);
  }
  context.restore();
}

function nearestSettlementAt(settlements: Settlement[], x: number, y: number): Settlement | undefined {
  let nearest: Settlement | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const settlement of settlements) {
    const dx = settlement.x - x;
    const dy = settlement.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = settlement;
    }
  }
  return nearest;
}

function nearestSectorAt(x: number, y: number): World["geography"]["sectors"][string] | undefined {
  return Object.values(world.geography?.sectors ?? {}).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
}

function sectorForSettlement(settlement: Settlement): World["geography"]["sectors"][string] | undefined {
  return world.geography?.sectors?.[settlement.sectorId] ?? nearestSectorAt(settlement.x, settlement.y);
}

function planetRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.44;
}

function worldGridMetrics(sectors: World["geography"]["sectors"][string][]): WorldGridMetrics {
  const columns = new Set(sectors.map((sector) => sector.q)).size;
  const rows = new Set(sectors.map((sector) => sector.r)).size;
  let tileRadius = 1;
  for (const sector of sectors) {
    for (const tileId of sector.tileIds) {
      const tile = world.geography?.tiles?.[tileId];
      if (!tile) {
        continue;
      }
      tileRadius = Math.max(tileRadius, Math.abs(tile.q), Math.abs(tile.r), Math.abs(tile.q + tile.r));
    }
  }
  return { columns: Math.max(1, columns), rows: Math.max(1, rows), tileRadius };
}

function projectPlanetPoint(x: number, y: number, width: number, height: number): PlanetProjection {
  const radius = planetRadius(width, height);
  const centerX = width * 0.5;
  const centerY = height * 0.51;
  const longitude = (x - 0.5) * Math.PI * 0.86 + planetSurfaceYaw;
  const latitude = (0.5 - y) * Math.PI * 0.86;
  const cosLatitude = Math.cos(latitude);
  const rawX = Math.sin(longitude) * cosLatitude;
  const rawY = Math.sin(latitude);
  const z = cosLatitude * Math.cos(longitude);
  return {
    x: centerX + rawX * radius,
    y: centerY - rawY * radius,
    z,
    scale: clampNumber(0.54 + z * 0.5, 0.2, 1.05),
    visible: z > 0.02
  };
}

function planetDepthAlpha(projected: PlanetProjection, floor = 0.08): number {
  return clampNumber(floor + ((projected.z + 0.08) / 0.58) * (1 - floor), floor, 1);
}

function nearestPlanetSectorAt(point: CanvasPoint, width: number, height: number): World["geography"]["sectors"][string] | undefined {
  let nearest: World["geography"]["sectors"][string] | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sector of Object.values(world.geography?.sectors ?? {})) {
    const projected = projectPlanetPoint(sector.x, sector.y, width, height);
    if (!projected.visible) {
      continue;
    }
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y) / Math.max(0.24, projected.scale);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = sector;
    }
  }
  return nearest;
}

function projectedRegionSectors(width: number, height: number, settlement: Settlement): RegionSectorProjection[] {
  const center = sectorForSettlement(settlement);
  if (!center) {
    return [];
  }
  const radius = clampNumber(Math.min(width, height) / 8.1, 56, 82);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  return Object.values(world.geography?.sectors ?? {})
    .filter((sector) => {
      const dq = sector.q - center.q;
      const dr = sector.r - center.r;
      return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= 2;
    })
    .sort((a, b) => a.r - b.r || a.q - b.q)
    .map((sector) => {
      const dq = sector.q - center.q;
      const dr = sector.r - center.r;
      return {
        sector,
        x: centerX + (dq + dr * 0.5) * radius * 1.58,
        y: centerY + dr * radius * 1.36,
        radius
      };
    });
}

function projectedLocalTiles(width: number, height: number, settlement: Settlement): TileProjection[] {
  const sector = sectorForSettlement(settlement);
  const tiles = (sector?.tileIds ?? [])
    .map((id) => world.geography?.tiles?.[id])
    .filter((tile): tile is World["geography"]["tiles"][string] => Boolean(tile))
    .sort((a, b) => a.r - b.r || a.q - b.q);
  if (tiles.length === 0) {
    return [];
  }

  const qValues = tiles.map((tile) => tile.q);
  const rValues = tiles.map((tile) => tile.r);
  const qMin = Math.min(...qValues);
  const qMax = Math.max(...qValues);
  const rMin = Math.min(...rValues);
  const rMax = Math.max(...rValues);
  const qSpan = Math.max(1, qMax - qMin + 1);
  const rSpan = Math.max(1, rMax - rMin + 1);
  const radius = clampNumber(Math.min(width / ((qSpan + rSpan * 0.5 + 3.2) * 1.6), height / ((rSpan + 2.4) * 1.35)), 44, 86);
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  return tiles.map((tile) => {
    const localQ = tile.q - (qMin + qMax) / 2;
    const localR = tile.r - (rMin + rMax) / 2;
    const point = localHexPoint(centerX, centerY, localQ, localR, radius);
    return { tile, x: point.x, y: point.y, radius };
  });
}

function dominantFactionForSector(sector: World["geography"]["sectors"][string]): Faction | undefined {
  const directSettlement = sector.settlementIds.map((id) => world.settlements[id]).find((settlement): settlement is Settlement => Boolean(settlement));
  if (directSettlement) {
    return world.factions[directSettlement.factionId];
  }
  const nearest = nearestSettlementAt(Object.values(world.settlements), sector.x, sector.y);
  return nearest ? world.factions[nearest.factionId] : undefined;
}

function elevationBandBaseColor(band: string | undefined): string {
  if (band === "alpine") return "#d8e8df";
  if (band === "high") return "#9a7c55";
  if (band === "middle") return "#8f9a68";
  return "#5d8b91";
}

function threatScaleColor(value: number, alpha = 0.92): string {
  const danger = clampNumber(value, 0, 100);
  const safe = parseHexColor("#4f7a53");
  const tense = parseHexColor("#c6a64d");
  const hostile = parseHexColor("#c64737");
  const color = danger < 48 ? mixRgb(safe, tense, danger / 48) : mixRgb(tense, hostile, (danger - 48) / 52);
  return rgbCss(color, alpha);
}

function sectorThreatScore(sector: World["geography"]["sectors"][string]): number {
  const biome = world.planet.biomes[sector.biomeId];
  const settlementThreat = sector.settlementIds
    .map((id) => world.settlements[id]?.threat ?? 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const climateStress = Math.abs(sector.temperature - 50) * 0.2 + Math.abs(sector.humidity - 50) * 0.12;
  return clampNumber((biome?.hazardBonus ?? 10) * 2 + climateStress + (sector.kind === "ocean" ? 30 : 0) + settlementThreat * 0.45, 0, 100);
}

function timeOfDay(): { id: "dawn" | "day" | "dusk" | "night"; label: string; shade: string } {
  const tickInDay = ((world.tick % 6) + 6) % 6;
  if (tickInDay === 0) return { id: "dawn", label: "Dawn", shade: "rgba(230, 187, 91, 0.07)" };
  if (tickInDay <= 3) return { id: "day", label: "Day", shade: "rgba(244, 234, 216, 0.025)" };
  if (tickInDay === 4) return { id: "dusk", label: "Dusk", shade: "rgba(168, 112, 72, 0.1)" };
  return { id: "night", label: "Night", shade: "rgba(7, 10, 18, 0.28)" };
}

function drawTileBadge(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fill = "rgba(13, 16, 14, 0.78)",
  color = "#f4ead8"
): void {
  context.save();
  context.font = "700 9px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = Math.max(12, context.measureText(label).width + 6);
  context.fillStyle = fill;
  context.strokeStyle = "rgba(244, 234, 216, 0.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x - width / 2, y - 7, width, 14, 4);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.fillText(label, x, y + 0.3);
  context.restore();
}

function drawSectorTileAdornments(
  context: CanvasRenderingContext2D,
  sector: World["geography"]["sectors"][string],
  centerX: number,
  centerY: number,
  cellWidth: number,
  cellHeight: number,
  lift: number,
  zoom: AtlasZoom
): void {
  const threat = sectorThreatScore(sector);
  const topY = centerY - cellHeight * 0.52 - lift;
  const bottomY = centerY + cellHeight * 0.5;
  const leftX = centerX - cellWidth * 0.36;
  const rightX = centerX + cellWidth * 0.36;
  const showDenseBadges = zoom === "region";

  if (sector.kind === "coast") {
    context.beginPath();
    context.strokeStyle = zoom === "world" ? "rgba(216, 232, 223, 0.22)" : "rgba(93, 139, 145, 0.5)";
    context.lineWidth = zoom === "world" ? 1.4 : 2;
    context.moveTo(centerX - cellWidth * 0.28, bottomY - cellHeight * 0.28);
    context.quadraticCurveTo(centerX, bottomY - cellHeight * 0.42, centerX + cellWidth * 0.28, bottomY - cellHeight * 0.28);
    context.stroke();
  }
  if (sector.kind === "ocean") {
    context.beginPath();
    context.strokeStyle = "rgba(216, 232, 223, 0.18)";
    context.lineWidth = 1;
    context.moveTo(centerX - cellWidth * 0.18, centerY);
    context.quadraticCurveTo(centerX - cellWidth * 0.07, centerY - cellHeight * 0.11, centerX + cellWidth * 0.04, centerY);
    context.quadraticCurveTo(centerX + cellWidth * 0.14, centerY + cellHeight * 0.1, centerX + cellWidth * 0.25, centerY);
    context.stroke();
  }
  if (showDenseBadges && (sector.elevationBand === "high" || sector.elevationBand === "alpine")) {
    drawTileBadge(context, leftX, topY + 8, sector.elevationBand === "alpine" ? "A" : "H", "rgba(244, 234, 216, 0.14)", "#f4ead8");
  }
  if (showDenseBadges && sector.settlementIds.length > 0) {
    drawTileBadge(context, leftX, bottomY - 5, "S", "rgba(198, 166, 77, 0.32)", "#f3e1a1");
  }
  if (showDenseBadges && threat >= 55) {
    drawTileBadge(context, rightX, bottomY - 5, threat >= 76 ? "!!" : "!", "rgba(154, 75, 70, 0.48)", "#f1d0c8");
  }
  if (showDenseBadges && (sector.humidity >= 72 || sector.temperature <= 28 || sector.temperature >= 76)) {
    const climate = sector.temperature <= 28 ? "C" : sector.temperature >= 76 ? "H" : "W";
    drawTileBadge(context, rightX, topY + 8, climate, "rgba(93, 139, 145, 0.32)", "#d8e8df");
  }
}

function projectSettlement(settlement: Settlement, width: number, height: number): MapPoint {
  if (atlasZoom === "world") {
    const projected = projectPlanetPoint(settlement.x, settlement.y, width, height);
    const lift = clampNumber(settlement.elevationMeters / 180, 1, 24) * projected.scale;
    return {
      x: projected.x,
      y: projected.y - lift * 0.24,
      groundY: projected.y + lift * 0.18,
      lift
    };
  }
  const elevation = Number.isFinite(settlement.elevationMeters) ? settlement.elevationMeters : 0;
  const lift = clampNumber(elevation / 95, 1, 36);
  const groundY = settlement.y * height;
  return {
    x: settlement.x * width,
    y: groundY - lift * 0.42,
    groundY,
    lift
  };
}

function sectorCellColor(sector: World["geography"]["sectors"][string], x: number, y: number, overlay: AtlasOverlay): string {
  if (overlay === "elevation") {
    const base = parseHexColor(elevationBandBaseColor(sector.elevationBand));
    const noise = terrainNoise(x, y, sector.humidity + sector.temperature);
    return rgbCss(mixRgb(base, parseHexColor("#f4ead8"), (noise - 0.3) * 0.08), sector.kind === "ocean" ? 0.72 : 0.94);
  }
  if (overlay === "threat") {
    return threatScaleColor(sectorThreatScore(sector), sector.kind === "ocean" ? 0.72 : 0.92);
  }
  if (overlay === "political") {
    if (sector.kind === "ocean") {
      return "rgba(32, 61, 69, 0.72)";
    }
    const faction = dominantFactionForSector(sector);
    const base = parseHexColor(faction?.color ?? "#7d8f5b");
    return rgbCss(mixRgb(base, parseHexColor("#0d100e"), sector.settlementIds.length ? 0.05 : 0.32), sector.settlementIds.length ? 0.84 : 0.52);
  }
  const biome = world.planet.biomes[sector.biomeId];
  const noise = terrainNoise(x, y, sector.humidity + sector.temperature);
  const elevationShade = (sector.elevationBand === "alpine" ? 0.2 : sector.elevationBand === "high" ? 0.13 : sector.elevationBand === "middle" ? 0.04 : -0.06) + (noise - 0.5) * 0.06;
  let color = parseHexColor(biome?.color ?? (sector.kind === "ocean" ? "#203d45" : "#7d8f5b"));
  if (sector.kind === "ocean") {
    color = mixRgb(color, parseHexColor("#203d45"), 0.55);
  }
  if (sector.kind === "coast") {
    color = mixRgb(color, parseHexColor("#5d8b91"), 0.22);
  }
  const target = elevationShade >= 0 ? parseHexColor("#f4ead8") : parseHexColor("#0d100e");
  return rgbCss(mixRgb(color, target, Math.abs(elevationShade)), sector.kind === "ocean" ? 0.78 : 0.92);
}

function drawTerrainHexCell(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, stroke: string, lift: number, lineWidth: number): void {
  context.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 6 + (Math.PI * 2 * index) / 6;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius - lift;
    if (index === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }
  context.closePath();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.fill();
  context.stroke();
}

function drawPlanetLightOverlay(context: CanvasRenderingContext2D, width: number, height: number): void {
  const day = timeOfDay();
  const globeRadius = planetRadius(width, height);
  const centerX = width * 0.5;
  const centerY = height * 0.51;
  const nightAlpha = day.id === "night" ? 0.34 : day.id === "dusk" || day.id === "dawn" ? 0.18 : 0.08;
  const gradient = context.createRadialGradient(centerX - globeRadius * 0.24, centerY - globeRadius * 0.3, globeRadius * 0.1, centerX, centerY, globeRadius * 1.08);
  gradient.addColorStop(0, "rgba(244, 234, 216, 0.1)");
  gradient.addColorStop(0.46, "rgba(244, 234, 216, 0.02)");
  gradient.addColorStop(1, `rgba(4, 7, 14, ${nightAlpha + 0.16})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawWorldBackdrop(context: CanvasRenderingContext2D, width: number, height: number): void {
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#111917");
  background.addColorStop(0.56, "#17201d");
  background.addColorStop(1, "#0f1412");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
}

function clipToPlanet(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.beginPath();
  context.arc(width * 0.5, height * 0.51, planetRadius(width, height), 0, Math.PI * 2);
  context.clip();
}

function drawWorldTerrainField(context: CanvasRenderingContext2D, width: number, height: number, overlay: AtlasOverlay): void {
  drawWorldBackdrop(context, width, height);
  const sectors = Object.values(world.geography?.sectors ?? {}).sort((a, b) => a.r - b.r || a.q - b.q);
  const grid = worldGridMetrics(sectors);
  const globeRadius = planetRadius(width, height);
  const sectorRadius = clampNumber(globeRadius / Math.max(4.3, grid.columns / 1.75), 38, 72);
  const centerX = width * 0.5;
  const centerY = height * 0.51;

  context.save();
  clipToPlanet(context, width, height);
  const ocean = context.createRadialGradient(centerX - globeRadius * 0.25, centerY - globeRadius * 0.35, globeRadius * 0.12, centerX, centerY, globeRadius);
  ocean.addColorStop(0, "rgba(90, 118, 119, 0.92)");
  ocean.addColorStop(0.58, "rgba(49, 75, 78, 0.96)");
  ocean.addColorStop(1, "rgba(22, 38, 44, 0.98)");
  context.fillStyle = ocean;
  context.fillRect(centerX - globeRadius, centerY - globeRadius, globeRadius * 2, globeRadius * 2);

  const projectedSectors = sectors
    .map((sector) => ({ sector, projected: projectPlanetPoint(sector.x, sector.y, width, height) }))
    .filter((item) => item.projected.visible)
    .sort((a, b) => a.projected.z - b.projected.z || a.sector.r - b.sector.r || a.sector.q - b.sector.q);
  for (const { sector, projected } of projectedSectors) {
    const radius = sectorRadius * (0.9 + projected.scale * 0.12);
    const lift =
      sector.kind !== "ocean"
        ? clampNumber((sector.elevationBand === "alpine" ? 2400 : sector.elevationBand === "high" ? 1400 : sector.elevationBand === "middle" ? 620 : 80) / 1500, 0, 2.4) * projected.scale
        : 0;
    drawTerrainHexCell(
      context,
      projected.x,
      projected.y,
      radius,
      sectorCellColor(sector, sector.x, sector.y, overlay),
      sector.kind === "ocean" ? "rgba(216, 232, 223, 0.12)" : "rgba(13, 16, 14, 0.28)",
      lift,
      0.8 + projected.scale * 0.55
    );
    drawSectorTileAdornments(context, sector, projected.x, projected.y, Math.sqrt(3) * radius, radius * 2, lift, "world");
  }

  context.save();
  clipToPlanet(context, width, height);
  drawPlanetLightOverlay(context, width, height);
  context.restore();

  const limb = context.createRadialGradient(centerX - globeRadius * 0.24, centerY - globeRadius * 0.34, globeRadius * 0.24, centerX, centerY, globeRadius);
  limb.addColorStop(0, "rgba(244, 234, 216, 0.05)");
  limb.addColorStop(0.7, "rgba(0, 0, 0, 0.035)");
  limb.addColorStop(1, "rgba(0, 0, 0, 0.42)");
  context.fillStyle = limb;
  context.fillRect(centerX - globeRadius, centerY - globeRadius, globeRadius * 2, globeRadius * 2);
  context.restore();

  context.beginPath();
  context.arc(centerX, centerY, globeRadius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(216, 232, 223, 0.26)";
  context.lineWidth = 2.2;
  context.stroke();
}

function drawRegionAtlas(context: CanvasRenderingContext2D, width: number, height: number, settlement: Settlement, labels: MapLabel[]): void {
  const sector = sectorForSettlement(settlement);
  const projectedSectors = projectedRegionSectors(width, height, settlement);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#151e1b");
  background.addColorStop(1, "#0f1412");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (!sector || projectedSectors.length === 0) {
    drawWorldTerrainField(context, width, height, atlasOverlay);
    return;
  }

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const sectorRadius = projectedSectors[0]?.radius ?? 64;

  context.save();
  context.globalAlpha = 0.18;
  drawTerrainHexCell(context, centerX, centerY, sectorRadius * 2.85, "rgba(216, 201, 158, 0.05)", "rgba(216, 201, 158, 0.28)", 0, 1.6);
  context.restore();

  const projectionBySectorId = new Map<string, RegionSectorProjection>();
  for (const projected of projectedSectors) {
    projectionBySectorId.set(projected.sector.id, projected);
    const { sector: projectedSector, x, y, radius } = projected;
    const elevationLift = projectedSector.elevationBand === "alpine" ? 9 : projectedSector.elevationBand === "high" ? 6 : projectedSector.elevationBand === "middle" ? 3 : 0;
    const stroke =
      projectedSector.id === sector.id
        ? "rgba(230, 187, 91, 0.78)"
        : projectedSector.kind === "ocean"
          ? "rgba(216, 232, 223, 0.12)"
          : "rgba(244, 234, 216, 0.18)";
    drawTerrainHexCell(context, x, y, radius, sectorCellColor(projectedSector, projectedSector.x, projectedSector.y, atlasOverlay), stroke, elevationLift, projectedSector.id === sector.id ? 2.2 : 1.2);
    drawSectorTileAdornments(context, projectedSector, x, y, Math.sqrt(3) * radius, radius * 2, elevationLift, "region");
  }

  drawPlanetLightOverlay(context, width, height);
  const settlementCounts = new Map<string, number>();
  for (const localSettlement of Object.values(world.settlements)) {
    const projection = projectionBySectorId.get(localSettlement.sectorId);
    if (!projection) {
      continue;
    }
    const count = settlementCounts.get(localSettlement.sectorId) ?? 0;
    settlementCounts.set(localSettlement.sectorId, count + 1);
    const angle = -Math.PI / 2 + count * 1.72;
    const spread = projection.radius * (count === 0 ? 0 : 0.34);
    drawSettlement(context, localSettlement, width, height, settlement.id, labels, {
      x: projection.x + Math.cos(angle) * spread,
      y: projection.y + Math.sin(angle) * spread * 0.72 - 5,
      groundY: projection.y + Math.sin(angle) * spread * 0.72 + 5,
      lift: 10
    }, "all");
  }
  labels.push({
    text: `${settlement.name} region`,
    x: width * 0.5,
    y: 30,
    priority: 160,
    color: "#f3e1a1",
    align: "center",
    size: 18,
    weight: 850
  });
  labels.push({
    text: `${projectedSectors.length} overtiles around ${world.planet.biomes[sector.biomeId]?.name ?? sector.biomeId}`,
    x: width * 0.5,
    y: 54,
    priority: 150,
    color: "rgba(216, 232, 223, 0.82)",
    align: "center",
    size: 12,
    weight: 700
  });
}

function drawWorldBodies(context: CanvasRenderingContext2D, labels: MapLabel[], width: number, height: number): void {
  context.save();
  for (const ocean of world.geography?.oceans ?? []) {
    const projected = projectPlanetPoint(ocean.x, ocean.y, width, height);
    if (!projected.visible) {
      continue;
    }
    const alpha = planetDepthAlpha(projected, 0.02) * 0.72;
    if (alpha < 0.26) {
      continue;
    }
    labels.push({
      text: ocean.name,
      x: projected.x,
      y: projected.y + planetRadius(width, height) * 0.08 * projected.scale,
      priority: 36 + projected.z * 18,
      color: "rgba(216, 232, 223, 0.82)",
      alpha,
      align: "center",
      size: projected.z > 0.36 ? 15 : 13,
      weight: 750
    });
  }
  for (const continent of world.geography?.continents ?? []) {
    const projected = projectPlanetPoint(continent.x, continent.y, width, height);
    if (!projected.visible) {
      continue;
    }
    const alpha = planetDepthAlpha(projected, 0.04) * 0.82;
    if (alpha < 0.32) {
      continue;
    }
    labels.push({
      text: continent.name,
      x: projected.x,
      y: projected.y - planetRadius(width, height) * 0.14 * projected.scale,
      priority: 62 + projected.z * 28,
      color: "rgba(244, 234, 216, 0.9)",
      alpha,
      align: "center",
      size: projected.z > 0.34 ? 18 : 15,
      weight: 850
    });
  }
  context.restore();
}

function drawHexCell(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, stroke: string, lift = 0): void {
  context.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 6 + (Math.PI * 2 * index) / 6;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius * 0.86 - lift;
    if (index === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }
  context.closePath();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 1.4;
  context.fill();
  context.stroke();
}

function localHexPoint(centerX: number, centerY: number, q: number, r: number, tileRadius: number): CanvasPoint {
  return {
    x: centerX + (q + r * 0.5) * tileRadius * 1.52,
    y: centerY + r * tileRadius * 1.16
  };
}

function drawLocalTileBadges(
  context: CanvasRenderingContext2D,
  tile: World["geography"]["tiles"][string],
  x: number,
  y: number,
  radius: number,
  lift: number
): void {
  const topY = y - radius * 0.78 - lift;
  const bottomY = y + radius * 0.72;
  if (tile.elevationBand === "high" || tile.elevationBand === "alpine") {
    drawTileBadge(context, x - radius * 0.42, topY + 10, tile.elevationBand === "alpine" ? "A" : "H", "rgba(244, 234, 216, 0.14)", "#f4ead8");
  }
  if (tile.layer !== "surface") {
    drawTileBadge(context, x + radius * 0.42, topY + 10, tile.layer.slice(0, 1).toUpperCase(), "rgba(127, 106, 153, 0.38)", "#e8ddff");
  } else {
    drawTileBadge(context, x + radius * 0.42, topY + 10, timeOfDay().id.slice(0, 1).toUpperCase(), "rgba(216, 201, 158, 0.18)", "#d8c99e");
  }
  if (tile.resourceHints.length > 0) {
    drawTileBadge(context, x - radius * 0.42, bottomY - 7, "R", "rgba(125, 143, 91, 0.36)", "#d7d9cd");
  }
  if (tile.danger >= 45) {
    drawTileBadge(context, x + radius * 0.42, bottomY - 7, tile.danger >= 70 ? "!!" : "!", "rgba(154, 75, 70, 0.5)", "#f1d0c8");
  }
}

function drawLocalBuildingFootprints(
  context: CanvasRenderingContext2D,
  settlement: Settlement,
  centerX: number,
  centerY: number,
  tileRadius: number
): void {
  const localScale = tileRadius * 0.2;
  const buildings = [...(settlement.buildings ?? [])]
    .filter((building) => building.status === "active" || building.status === "damaged")
    .sort((a, b) => a.builtTick - b.builtTick || a.catalogId.localeCompare(b.catalogId));
  for (const building of buildings) {
    const footprint = building.footprint;
    if (!footprint) {
      continue;
    }
    const x = centerX + footprint.anchorQ * localScale * 0.78 + footprint.anchorR * localScale * 0.34;
    const y = centerY + footprint.anchorR * localScale * 0.58;
    const width = Math.max(8, footprint.width * localScale);
    const height = Math.max(8, footprint.height * localScale * 0.82);
    context.save();
    context.fillStyle = buildingCategoryColor(building.category);
    context.strokeStyle = building.status === "damaged" ? "rgba(198, 71, 55, 0.95)" : "rgba(13, 16, 14, 0.9)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.roundRect(x - width / 2, y - height / 2, width, height, 3);
    context.fill();
    context.stroke();
    if ((building.occupantIds ?? []).length > 0) {
      context.fillStyle = "#f3e1a1";
      context.beginPath();
      context.arc(x + width / 2 - 2, y - height / 2 + 2, 2.5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawLocalAtlas(context: CanvasRenderingContext2D, width: number, height: number, settlement: Settlement, labels: MapLabel[]): void {
  const projectedTiles = projectedLocalTiles(width, height, settlement);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#17201d");
  background.addColorStop(1, "#101411");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const tileRadius = projectedTiles[0]?.radius ?? clampNumber(Math.min(width, height) / 6.2, 34, 76);
  for (const { tile, x, y, radius } of projectedTiles) {
    const elevationLift = tile.elevationBand === "alpine" ? 9 : tile.elevationBand === "high" ? 6 : tile.elevationBand === "middle" ? 3 : 0;
    const biome = world.planet.biomes[tile.biomeId];
    const fill =
      atlasOverlay === "elevation"
        ? rgbCss(parseHexColor(elevationBandBaseColor(tile.elevationBand)), 0.96)
        : atlasOverlay === "threat"
          ? threatScaleColor(tile.danger, 0.94)
          : atlasOverlay === "political"
            ? rgbCss(parseHexColor(world.factions[settlement.factionId]?.color ?? "#c6a64d"), tile.layer === "surface" ? 0.78 : 0.44)
            : rgbCss(parseHexColor(biome?.color ?? "#7d8f5b"), tile.layer === "surface" ? 0.96 : 0.62);
    const stroke =
      tile.passability < 25
        ? "rgba(198, 71, 55, 0.58)"
        : tile.layer === "surface"
          ? "rgba(244, 234, 216, 0.2)"
          : "rgba(127, 106, 153, 0.58)";
    drawHexCell(context, x, y, radius, fill, stroke, elevationLift);
    drawLocalTileBadges(context, tile, x, y, radius, elevationLift);
    if (tile.layer !== "surface") {
      context.save();
      context.font = "700 10px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(244, 234, 216, 0.78)";
      context.fillText(layerLabels[tile.layer] ?? tile.layer, x, y - elevationLift);
      context.restore();
    }
  }

  drawLocalBuildingFootprints(context, settlement, centerX, centerY, tileRadius);
  const point = { x: centerX, y: centerY - 3, groundY: centerY + 6, lift: 8 };
  drawSettlement(context, settlement, width, height, settlement.id, labels, point, "all");
  labels.push({
    text: `${settlement.name} local`,
    x: width * 0.5,
    y: 28,
    priority: 160,
    color: "#f3e1a1",
    align: "center"
  });
}

function drawTerritoryClaims(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  for (const territory of Object.values(world.territories ?? {})) {
    const faction = world.factions[territory.factionId];
    const projectedSettlements = territory.settlementIds
      .map((id) => world.settlements[id])
      .filter((settlement): settlement is Settlement => Boolean(settlement))
      .map((settlement) => ({
        point: projectSettlement(settlement, width, height),
        projection: atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined
      }))
      .filter((item) => !item.projection || item.projection.visible);
    const points = projectedSettlements.map((item) => item.point);
    if (!faction || !points.length) {
      continue;
    }
    const alpha =
      atlasZoom === "world"
        ? clampNumber(
            projectedSettlements.reduce((sum, item) => sum + (item.projection ? planetDepthAlpha(item.projection, 0.04) : 1), 0) / projectedSettlements.length,
            0.08,
            0.74
          )
        : 1;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radiusX = Math.max(54, (maxX - minX) / 2 + 48);
    const radiusY = Math.max(42, (maxY - minY) / 2 + 38);
    const color = parseHexColor(faction.color);
    context.globalAlpha = atlasZoom === "world" ? alpha * 0.72 : alpha;
    context.beginPath();
    context.fillStyle = rgbCss(color, 0.08);
    context.strokeStyle = rgbCss(color, territory.borderPressure > 55 ? 0.58 : 0.28);
    context.lineWidth = territory.borderPressure > 55 ? 2.2 : 1.2;
    context.setLineDash(territory.borderPressure > 55 ? [8, 5] : []);
    context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function weatherColor(front: WeatherFront): string {
  if (front.kind === "storm") return "rgba(93, 139, 145, 0.32)";
  if (front.kind === "fog") return "rgba(216, 232, 223, 0.24)";
  if (front.kind === "snow") return "rgba(216, 232, 223, 0.34)";
  if (front.kind === "heatwave") return "rgba(198, 166, 77, 0.28)";
  if (front.kind === "ashfall") return "rgba(143, 127, 143, 0.3)";
  if (front.kind === "aether-wind") return "rgba(127, 106, 153, 0.3)";
  return "rgba(93, 139, 145, 0.24)";
}

function drawWeatherFronts(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  for (const front of Object.values(world.weather?.fronts ?? {})) {
    const region = world.planet.regions[front.regionId];
    if (!region) {
      continue;
    }
    const projectedSettlements = region.settlementIds
      .map((id) => world.settlements[id])
      .filter((settlement): settlement is Settlement => Boolean(settlement))
      .map((settlement) => ({
        point: projectSettlement(settlement, width, height),
        projection: atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined
      }))
      .filter((item) => !item.projection || item.projection.visible);
    const points = projectedSettlements.map((item) => item.point);
    if (!points.length) {
      continue;
    }
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const alpha =
      atlasZoom === "world"
        ? clampNumber(projectedSettlements.reduce((sum, item) => sum + (item.projection ? planetDepthAlpha(item.projection, 0.06) : 1), 0) / projectedSettlements.length, 0.08, 0.72)
        : 1;
    const radius = atlasZoom === "world" ? 28 + front.intensity * 0.42 : 42 + front.intensity * 0.72;
    context.globalAlpha = atlasZoom === "world" ? alpha * 0.78 : alpha;
    context.beginPath();
    context.fillStyle = weatherColor(front);
    context.strokeStyle = front.intensity > 70 ? "rgba(244, 234, 216, 0.38)" : "rgba(244, 234, 216, 0.16)";
    context.lineWidth = front.intensity > 70 ? 2 : 1;
    context.ellipse(centerX, centerY, radius, radius * 0.55, -0.18, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (atlasZoom !== "world" && front.intensity > 68) {
      context.font = "10px system-ui, sans-serif";
      context.lineWidth = 3;
      context.strokeStyle = "rgba(13, 16, 14, 0.82)";
      context.strokeText(front.kind, centerX - radius * 0.35, centerY - radius * 0.18);
      context.fillStyle = "#f4ead8";
      context.fillText(front.kind, centerX - radius * 0.35, centerY - radius * 0.18);
    }
  }
  context.restore();
}

function drawLingeringEffect(context: CanvasRenderingContext2D, effect: LingeringEffect, width: number, height: number): void {
  const x = effect.x * width;
  const y = effect.y * height;
  const life = clampNumber(effect.remainingTicks / effect.durationTicks, 0, 1);
  const radius = effect.radius * (effect.kind === "impact" || effect.kind === "area" ? 0.72 + effect.progress * 0.28 : 1);
  context.save();
  context.globalAlpha = effect.kind === "area" || effect.kind === "impact" ? clampNumber(0.12 + life * 0.18, 0, 0.34) : clampNumber(0.18 + life * 0.62, 0, 0.82);
  if (effect.kind === "projectile" || effect.kind === "charge") {
    const targetX = (effect.targetX ?? effect.x) * width;
    const targetY = (effect.targetY ?? effect.y) * height;
    context.beginPath();
    context.strokeStyle = effect.color;
    context.lineWidth = effect.kind === "charge" ? 5 : 3;
    context.lineCap = "round";
    context.moveTo(x, y);
    context.lineTo(x + (targetX - x) * 0.22, y + (targetY - y) * 0.22);
    context.stroke();
    context.beginPath();
    context.fillStyle = effect.color;
    context.arc(x, y, effect.kind === "charge" ? 5 : 3.5, 0, Math.PI * 2);
    context.fill();
  } else if (effect.kind === "trail") {
    context.beginPath();
    context.fillStyle = effect.color;
    context.ellipse(x, y, radius * 1.4, radius * 0.55, -0.2, 0, Math.PI * 2);
    context.fill();
  } else if (effect.kind === "area" || effect.kind === "impact") {
    context.fillStyle = effect.color;
    context.strokeStyle = effect.color;
    context.lineWidth = effect.kind === "impact" ? 2.2 : 1.6;
    context.setLineDash(effect.kind === "area" ? [5, 5] : []);
    context.beginPath();
    context.arc(x, y, radius * 0.86, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = clampNumber(0.05 + life * 0.08, 0.05, 0.14);
    context.beginPath();
    context.arc(x, y, radius * 0.72, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = clampNumber(0.18 + life * 0.24, 0.18, 0.42);
    context.setLineDash([]);
    context.beginPath();
    context.arc(x, y, 4 + radius * 0.08, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.beginPath();
    context.fillStyle = effect.color;
    context.strokeStyle = effect.color;
    context.lineWidth = 2;
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = clampNumber(life, 0.18, 0.8);
    context.stroke();
  }
  context.restore();
}

function drawLingeringEffects(context: CanvasRenderingContext2D, width: number, height: number, effects: readonly LingeringEffect[]): void {
  [...effects]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .forEach((effect) => drawLingeringEffect(context, effect, width, height));
}

function routeStroke(route: TravelRoute): string {
  if (route.passDifficulty > 70) {
    return "rgba(230, 187, 91, 0.72)";
  }
  if (route.danger > 58) {
    return "rgba(198, 71, 55, 0.62)";
  }
  return "rgba(238, 226, 196, 0.36)";
}

function drawRoute(context: CanvasRenderingContext2D, route: TravelRoute, width: number, height: number): void {
  const from = world.settlements[route.fromId];
  const to = world.settlements[route.toId];
  if (!from || !to) {
    return;
  }
  const fromProjection = atlasZoom === "world" ? projectPlanetPoint(from.x, from.y, width, height) : undefined;
  const toProjection = atlasZoom === "world" ? projectPlanetPoint(to.x, to.y, width, height) : undefined;
  if (atlasZoom === "world") {
    if (!fromProjection?.visible || !toProjection?.visible) {
      return;
    }
  }
  const a = projectSettlement(from, width, height);
  const b = projectSettlement(to, width, height);
  const selectedRoute = selectedBand().travel?.routeId === route.id;
  const selectedEndpoint = from.id === selectedSettlement().id || to.id === selectedSettlement().id;
  const depthAlpha = fromProjection && toProjection ? Math.min(planetDepthAlpha(fromProjection, 0.04), planetDepthAlpha(toProjection, 0.04)) : 1;
  const worldRouteAlpha = selectedRoute ? 1 : selectedEndpoint ? 0.72 : 0.46;
  context.save();
  context.globalAlpha = atlasZoom === "world" ? depthAlpha * worldRouteAlpha : 1;
  context.lineCap = "round";
  context.setLineDash(route.passDifficulty > 72 ? [7, 6] : []);
  context.beginPath();
  context.strokeStyle = "rgba(0, 0, 0, 0.36)";
  context.lineWidth = atlasZoom === "world" ? (selectedRoute ? 4.8 : 3.2) : route.passDifficulty > 66 ? 6 : 4;
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();

  context.beginPath();
  context.strokeStyle = routeStroke(route);
  context.lineWidth = atlasZoom === "world" ? (selectedRoute ? 2.2 : 1.2) : route.passDifficulty > 66 ? 2.6 : route.danger > 58 ? 2.2 : 1.4;
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
  context.setLineDash([]);

  const notchCount = Math.min(5, Math.floor(route.elevationGain / 520));
  if (notchCount > 0) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    context.strokeStyle = "rgba(244, 234, 216, 0.38)";
    context.lineWidth = 1;
    for (let index = 1; index <= notchCount; index += 1) {
      const t = index / (notchCount + 1);
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      context.beginPath();
      context.moveTo(x - normalX * 4, y - normalY * 4);
      context.lineTo(x + normalX * 4, y + normalY * 4);
      context.stroke();
    }
  }
  context.restore();
}

function drawFeatureGlyph(context: CanvasRenderingContext2D, feature: WorldFeature, x: number, y: number): void {
  const size = feature.status === "claimed" ? 7 : 5 + clampNumber(feature.danger / 80, 0, 2);
  const fill =
    feature.status === "claimed"
      ? "#c6a64d"
      : feature.layer === "sky"
        ? "#d8e8df"
        : feature.layer === "deep"
          ? "#7f6a99"
          : feature.layer === "underground"
            ? "#a87048"
            : "#d7d9cd";
  context.save();
  context.translate(x, y);
  context.beginPath();
  context.fillStyle = fill;
  context.strokeStyle = feature.danger > 66 ? "rgba(198, 71, 55, 0.9)" : "rgba(13, 16, 14, 0.78)";
  context.lineWidth = 2;
  if (feature.layer === "sky") {
    context.moveTo(0, -size);
    context.lineTo(size * 0.9, size * 0.7);
    context.lineTo(-size * 0.9, size * 0.7);
  } else if (feature.layer === "underground") {
    context.moveTo(0, size);
    context.lineTo(size, -size * 0.55);
    context.lineTo(-size, -size * 0.55);
  } else if (feature.layer === "deep") {
    context.rect(-size * 0.75, -size * 0.75, size * 1.5, size * 1.5);
  } else {
    context.moveTo(0, -size);
    context.lineTo(size, 0);
    context.lineTo(0, size);
    context.lineTo(-size, 0);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawStar(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  context.save();
  context.strokeStyle = "rgba(13, 16, 14, 0.82)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x, y + radius);
  context.moveTo(x - radius, y);
  context.lineTo(x + radius, y);
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.restore();
}

function drawStoryMarkers(context: CanvasRenderingContext2D, width: number, height: number): void {
  for (const crisis of Object.values(world.story.crises ?? {}).filter((item) => item.status === "active")) {
    const settlement = world.settlements[crisis.locationId];
    if (!settlement) {
      continue;
    }
    const projection = atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined;
    if (projection && !projection.visible) {
      continue;
    }
    const alpha = projection ? planetDepthAlpha(projection, 0.06) : 1;
    const point = projectSettlement(settlement, width, height);
    const radius = atlasZoom === "world" ? 14 + clampNumber(crisis.severity / 10, 0, 7) : 22 + clampNumber(crisis.severity / 6, 0, 10);
    context.save();
    context.globalAlpha = atlasZoom === "world" ? alpha * 0.78 : alpha;
    context.beginPath();
    context.strokeStyle = "rgba(198, 71, 55, 0.24)";
    context.lineWidth = 4;
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.strokeStyle = "rgba(230, 187, 91, 0.88)";
    context.lineWidth = 2.5;
    context.arc(point.x, point.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clampNumber(crisis.progress / 100, 0, 1));
    context.stroke();
    context.restore();
  }

  for (const boss of Object.values(world.story.bosses ?? {}).filter((item) => item.status === "active")) {
    const settlement = world.settlements[boss.locationId];
    if (!settlement) {
      continue;
    }
    const projection = atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined;
    if (projection && !projection.visible) {
      continue;
    }
    const alpha = projection ? planetDepthAlpha(projection, 0.1) : 1;
    const point = projectSettlement(settlement, width, height);
    const size = atlasZoom === "world" ? 15 : 24;
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.fillStyle = "rgba(198, 71, 55, 0.88)";
    context.strokeStyle = "rgba(13, 16, 14, 0.88)";
    context.lineWidth = 2;
    context.moveTo(point.x, point.y - size);
    context.lineTo(point.x + size * 0.38, point.y - size * 0.34);
    context.lineTo(point.x - size * 0.38, point.y - size * 0.34);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  for (const artifact of Object.values(world.story.artifacts ?? {}).filter((item) => item.status !== "hidden")) {
    const settlement = world.settlements[artifact.locationId];
    if (!settlement) {
      continue;
    }
    const projection = atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined;
    if (projection && !projection.visible) {
      continue;
    }
    context.save();
    context.globalAlpha = projection ? planetDepthAlpha(projection, 0.08) : 1;
    const point = projectSettlement(settlement, width, height);
    drawStar(context, point.x + 16, point.y - 14, atlasZoom === "world" ? 4 : artifact.status === "claimed" ? 7 : 5, artifact.status === "claimed" ? "#f3e1a1" : "#d8c99e");
    context.restore();
  }
}

function borderStrokeColor(kind: string, status: string): string {
  if (status === "breached" || status === "ruined") return "rgba(198, 71, 55, 0.5)";
  if (kind === "wall") return "rgba(216, 201, 158, 0.58)";
  if (kind === "palisade") return "rgba(168, 112, 72, 0.5)";
  if (kind === "city-edge" || kind === "town-edge") return "rgba(230, 187, 91, 0.34)";
  return "rgba(244, 234, 216, 0.18)";
}

function drawSettlementBuiltEnvironment(
  context: CanvasRenderingContext2D,
  settlement: Settlement,
  point: MapPoint,
  width: number,
  selected: boolean
): void {
  const borders = settlement.borders ?? [];
  for (const border of borders.sort((a, b) => b.radius - a.radius)) {
    const radiusX = clampNumber(border.radius * width, 13, selected ? 72 : 48);
    const radiusY = radiusX * 0.58;
    context.beginPath();
    context.strokeStyle = borderStrokeColor(border.kind, border.status);
    context.lineWidth = selected || border.kind === "wall" ? 2 : 1.15;
    context.setLineDash(border.status === "breached" ? [5, 4] : border.kind.includes("edge") ? [3, 5] : []);
    context.ellipse(point.x, point.y + 3, radiusX, radiusY, -0.1, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }

  if (atlasZoom === "world" && !selected) {
    return;
  }

  const activeOrders = (settlement.buildOrders ?? []).filter((order) => order.status === "building" || order.status === "queued");
  const buildings = [...(settlement.buildings ?? [])]
    .filter((building) => building.status !== "ruined")
    .sort((a, b) => b.level - a.level || b.integrity - a.integrity || a.catalogId.localeCompare(b.catalogId));
  const shouldShowBuildings = selected || activeOrders.length > 0 || settlement.population >= 620 || settlement.defense >= 68;
  if (!shouldShowBuildings) {
    return;
  }

  const visible = buildings.slice(0, selected ? 8 : 5);
  visible.forEach((building, index) => {
    const angle = -Math.PI * 0.72 + (index / Math.max(1, visible.length - 1)) * Math.PI * 1.44;
    const distance = selected ? 22 : 16;
    const size = selected ? 5 : 4;
    const x = point.x + Math.cos(angle) * distance;
    const y = point.y + Math.sin(angle) * distance * 0.62 + 3;
    context.beginPath();
    context.fillStyle = buildingCategoryColor(building.category);
    context.strokeStyle = building.status === "damaged" ? "rgba(198, 71, 55, 0.9)" : "rgba(13, 16, 14, 0.86)";
    context.lineWidth = 1.2;
    context.rect(x - size, y - size, size * 2, size * 2);
    context.fill();
    context.stroke();
  });

  const active = activeOrders.find((order) => order.status === "building") ?? activeOrders[0];
  if (active) {
    const progress = clampNumber(active.progress / 100, 0, 1);
    const orderRadius = selected ? 31 : 23;
    context.beginPath();
    context.strokeStyle = "rgba(13, 16, 14, 0.72)";
    context.lineWidth = selected ? 5 : 4;
    context.arc(point.x, point.y, orderRadius, -Math.PI / 2, Math.PI * 1.5);
    context.stroke();
    context.beginPath();
    context.strokeStyle = active.status === "building" ? "rgba(230, 187, 91, 0.9)" : "rgba(143, 154, 163, 0.72)";
    context.lineWidth = selected ? 2.4 : 2;
    context.arc(point.x, point.y, orderRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    context.stroke();
  }
}

function prominentBandPoints(width: number, height: number): CanvasPoint[] {
  return Object.values(world.bands)
    .filter((band) => band.id === world.selectedBandId || band.id === world.deity.favoredBandId)
    .map((band) => projectedBandPoint(band, width, height))
    .filter((point): point is CanvasPoint => Boolean(point));
}

function drawSettlement(
  context: CanvasRenderingContext2D,
  settlement: Settlement,
  width: number,
  height: number,
  selectedId: string,
  labels: MapLabel[],
  pointOverride?: MapPoint,
  labelMode: "all" | "major" = "all"
): void {
  const isSelected = settlement.id === selectedId;
  const projection = atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined;
  if (projection && !projection.visible) {
    return;
  }
  const depthAlpha = projection ? planetDepthAlpha(projection, 0.1) : 1;
  if (projection && depthAlpha < 0.22 && !isSelected) {
    return;
  }
  const faction = world.factions[settlement.factionId];
  const point = pointOverride ?? projectSettlement(settlement, width, height);
  const radius = 7 + clampNumber(settlement.population / 170, 0, 9);
  context.save();
  context.globalAlpha = projection ? (isSelected ? Math.max(0.72, depthAlpha) : depthAlpha) : 1;
  drawSettlementBuiltEnvironment(context, settlement, point, width, isSelected);

  context.beginPath();
  context.fillStyle = "rgba(0, 0, 0, 0.35)";
  context.ellipse(point.x, point.groundY + 5, radius + 10, 4 + point.lift / 9, 0, 0, Math.PI * 2);
  context.fill();

  if (point.lift > 4) {
    context.beginPath();
    context.strokeStyle = "rgba(244, 234, 216, 0.16)";
    context.lineWidth = 2;
    context.moveTo(point.x, point.groundY);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  context.beginPath();
  context.fillStyle = elevationBandColor(settlement.elevationBand);
  context.arc(point.x, point.y, radius + 9, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.fillStyle = faction?.color ?? "#c6a64d";
  context.strokeStyle = isSelected ? "#f3e1a1" : "rgba(255, 255, 255, 0.52)";
  context.lineWidth = isSelected ? 4 : 2;
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  if (settlement.threat > 60) {
    context.beginPath();
    context.strokeStyle = "rgba(198, 71, 55, 0.86)";
    context.lineWidth = 2;
    context.arc(point.x, point.y, radius + 13, -Math.PI * 0.15, Math.PI * 1.35);
    context.stroke();
  }

  const isCapital = faction?.capitalId === settlement.id;
  const crowdedByProminentBand =
    atlasZoom === "world" && prominentBandPoints(width, height).some((bandPoint) => Math.hypot(bandPoint.x - point.x, bandPoint.y - point.y) < 48);
  const shouldLabel = labelMode === "all" || settlement.id === selectedId || isCapital || settlement.population >= 520 || settlement.threat >= 74;
  if (shouldLabel && !crowdedByProminentBand && (!projection || isSelected || depthAlpha >= 0.42)) {
    labels.push({
      text: settlement.name,
      x: point.x + radius + 8,
      y: point.y + (isSelected ? -10 : 1),
      priority: (isSelected ? 120 : isCapital ? 84 : 40) + settlement.population / 40 + settlement.threat / 4 + (projection ? projection.z * 18 : 0),
      color: isSelected ? "#f3e1a1" : "#f4ead4",
      alpha: projection ? (isSelected ? 1 : depthAlpha * 0.9) : 1,
      size: isSelected ? 17 : labelMode === "major" ? 14 : 13,
      weight: isSelected || isCapital ? 800 : 700
    });
  }
  context.restore();
}

function drawFeatures(context: CanvasRenderingContext2D, width: number, height: number): void {
  const grouped = new Map<string, WorldFeature[]>();
  for (const feature of Object.values(world.planet.features ?? {}).filter((item) => item.status !== "hidden")) {
    const list = grouped.get(feature.nearestSettlementId) ?? [];
    list.push(feature);
    grouped.set(feature.nearestSettlementId, list);
  }

  for (const [settlementId, features] of grouped) {
    const settlement = world.settlements[settlementId];
    if (!settlement) {
      continue;
    }
    const projection = atlasZoom === "world" ? projectPlanetPoint(settlement.x, settlement.y, width, height) : undefined;
    if (projection && (!projection.visible || planetDepthAlpha(projection, 0.02) < 0.32)) {
      continue;
    }
    const point = projectSettlement(settlement, width, height);
    const sorted = [...features].sort((a, b) => b.danger - a.danger || b.richness - a.richness);
    const visibleFeatures = atlasZoom === "world" ? sorted.slice(0, settlement.id === selectedSettlement().id ? 2 : 1) : sorted;
    context.save();
    context.globalAlpha = projection ? planetDepthAlpha(projection, 0.08) * 0.82 : 1;
    visibleFeatures.forEach((feature, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, sorted.length)) * Math.PI * 2 + terrainNoise(point.x, point.y, index) * 0.35;
      const offset = atlasZoom === "world" ? (feature.layer === "sky" ? 27 : 19) : feature.layer === "sky" ? 36 : feature.layer === "deep" ? 27 : feature.layer === "underground" ? 24 : 20;
      drawFeatureGlyph(context, feature, point.x + Math.cos(angle) * offset, point.y + Math.sin(angle) * offset);
    });
    context.restore();
  }
}

function drawBands(context: CanvasRenderingContext2D, width: number, height: number, labels: MapLabel[], focusOnly = false): void {
  for (const band of Object.values(world.bands)) {
    const isFavored = band.id === world.deity.favoredBandId;
    const isSelected = band.id === world.selectedBandId;
    if (focusOnly && !isFavored && !isSelected) {
      continue;
    }
    let x = 0;
    let y = 0;
    let depthAlpha = 1;
    if (band.travel) {
      const origin = world.settlements[band.travel.originId];
      const destination = world.settlements[band.travel.destinationId];
      if (!origin || !destination) {
        continue;
      }
      if (atlasZoom === "world") {
        const originProjection = projectPlanetPoint(origin.x, origin.y, width, height);
        const destinationProjection = projectPlanetPoint(destination.x, destination.y, width, height);
        if (!originProjection.visible && !destinationProjection.visible) {
          continue;
        }
        depthAlpha = Math.max(0.2, Math.min(planetDepthAlpha(originProjection, 0.08), planetDepthAlpha(destinationProjection, 0.08)));
      }
      const a = projectSettlement(origin, width, height);
      const b = projectSettlement(destination, width, height);
      const t = clampNumber(band.travel.progress / band.travel.total, 0, 1);
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
    } else {
      const settlement = world.settlements[band.locationId];
      if (!settlement) {
        continue;
      }
      if (atlasZoom === "world") {
        const projection = projectPlanetPoint(settlement.x, settlement.y, width, height);
        if (!projection.visible) {
          continue;
        }
        depthAlpha = planetDepthAlpha(projection, 0.1);
      }
      const point = projectSettlement(settlement, width, height);
      x = point.x;
      y = point.y;
    }

    const size = isSelected ? 11 : isFavored ? 10 : 8;
    context.save();
    context.globalAlpha = atlasZoom === "world" ? (isSelected || isFavored ? Math.max(0.78, depthAlpha) : depthAlpha * 0.76) : 1;
    context.beginPath();
    context.fillStyle = isFavored ? "#f3e1a1" : "rgba(13, 16, 14, 0.92)";
    context.strokeStyle = isSelected ? "#e6bb5b" : isFavored ? "#1b1f1b" : "rgba(244, 234, 216, 0.86)";
    context.lineWidth = isSelected || isFavored ? 3 : 2;
    context.moveTo(x, y - size);
    context.lineTo(x + size, y);
    context.lineTo(x, y + size);
    context.lineTo(x - size, y);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();

    if (isSelected || isFavored) {
      labels.push({
        text: band.name,
        x: x + size + 7,
        y: atlasZoom === "world" ? y - size - 18 : y - size - 2,
        priority: atlasZoom === "world" ? (isSelected ? 150 : 138) : isSelected ? 130 : 115,
        color: isFavored ? "#f3e1a1" : "#f4ead8",
        alpha: atlasZoom === "world" ? Math.max(0.82, depthAlpha) : 1
      });
    }
  }
}

function canvasPointFromEvent(canvas: HTMLCanvasElement, event: MouseEvent): CanvasPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
  };
}

function projectedBandPoint(band: Band, width: number, height: number): CanvasPoint | undefined {
  if (band.travel) {
    const origin = world.settlements[band.travel.originId];
    const destination = world.settlements[band.travel.destinationId];
    if (!origin || !destination) {
      return undefined;
    }
    if (atlasZoom === "world") {
      const originProjection = projectPlanetPoint(origin.x, origin.y, width, height);
      const destinationProjection = projectPlanetPoint(destination.x, destination.y, width, height);
      if (!originProjection.visible && !destinationProjection.visible) {
        return undefined;
      }
    }
    const a = projectSettlement(origin, width, height);
    const b = projectSettlement(destination, width, height);
    const t = clampNumber(band.travel.progress / band.travel.total, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const settlement = world.settlements[band.locationId];
  if (!settlement) {
    return undefined;
  }
  if (atlasZoom === "world" && !projectPlanetPoint(settlement.x, settlement.y, width, height).visible) {
    return undefined;
  }
  const point = projectSettlement(settlement, width, height);
  return { x: point.x, y: point.y };
}

function nearestProjectedSettlement(point: CanvasPoint, width: number, height: number, maxDistance: number): Settlement | undefined {
  let nearest: Settlement | undefined;
  let nearestDistance = maxDistance;
  for (const settlement of Object.values(world.settlements)) {
    if (atlasZoom === "world" && !projectPlanetPoint(settlement.x, settlement.y, width, height).visible) {
      continue;
    }
    const projected = projectSettlement(settlement, width, height);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = settlement;
    }
  }
  return nearest;
}

function nearestProjectedBand(point: CanvasPoint, width: number, height: number, maxDistance: number): Band | undefined {
  let nearest: Band | undefined;
  let nearestDistance = maxDistance;
  for (const band of Object.values(world.bands)) {
    const projected = projectedBandPoint(band, width, height);
    if (!projected) {
      continue;
    }
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = band;
    }
  }
  return nearest;
}

function nearestRegionSectorAt(point: CanvasPoint, width: number, height: number, settlement: Settlement): World["geography"]["sectors"][string] | undefined {
  let nearest: RegionSectorProjection | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const projected of projectedRegionSectors(width, height, settlement)) {
    const lift = projected.sector.elevationBand === "alpine" ? 9 : projected.sector.elevationBand === "high" ? 6 : projected.sector.elevationBand === "middle" ? 3 : 0;
    const distance = Math.hypot(projected.x - point.x, projected.y - lift - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = projected;
    }
  }
  return nearest && nearestDistance <= nearest.radius * 1.08 ? nearest.sector : undefined;
}

function nearestLocalTileAt(point: CanvasPoint, width: number, height: number, settlement: Settlement): World["geography"]["tiles"][string] | undefined {
  let nearest: TileProjection | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const projected of projectedLocalTiles(width, height, settlement)) {
    const elevationLift = projected.tile.elevationBand === "alpine" ? 8 : projected.tile.elevationBand === "high" ? 5 : projected.tile.elevationBand === "middle" ? 2 : 0;
    const distance = Math.hypot(projected.x - point.x, projected.y - elevationLift - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = projected;
    }
  }
  return nearest && nearestDistance <= nearest.radius * 1.05 ? nearest.tile : undefined;
}

function focusSettlementOnMap(settlement: Settlement): void {
  selectedMapSettlementId = settlement.id;
  selectedFactionId = settlement.factionId;
  const localBand = Object.values(world.bands).find((band) => !band.travel && band.locationId === settlement.id);
  if (localBand) {
    world.selectedBandId = localBand.id;
    world.selectedPersonId = localBand.leaderId;
  }
}

function focusMapFromCanvasEvent(canvas: HTMLCanvasElement, event: MouseEvent): void {
  if (atlasZoom === "region") {
    const point = canvasPointFromEvent(canvas, event);
    const sector = nearestRegionSectorAt(point, canvas.width, canvas.height, selectedSettlement());
    const sectorSettlement = sector?.settlementIds.map((id) => world.settlements[id]).find((candidate): candidate is Settlement => Boolean(candidate));
    if (sectorSettlement) {
      focusSettlementOnMap(sectorSettlement);
    } else {
      selectedMapSettlementId = selectedSettlement().id;
    }
    return;
  }
  if (atlasZoom === "local") {
    selectedMapSettlementId = selectedSettlement().id;
    return;
  }
  const point = canvasPointFromEvent(canvas, event);
  const band = nearestProjectedBand(point, canvas.width, canvas.height, atlasZoom === "world" ? 22 : 28);
  if (band) {
    world.selectedBandId = band.id;
    world.selectedPersonId = band.leaderId;
    selectedMapSettlementId = band.travel?.destinationId ?? band.locationId;
    selectedFactionId = world.persons[band.leaderId]?.factionId ?? selectedFactionId;
    return;
  }
  const settlement = nearestProjectedSettlement(point, canvas.width, canvas.height, atlasZoom === "world" ? 34 : 42);
  if (settlement) {
    focusSettlementOnMap(settlement);
  }
}

function renderSettlementHover(settlement: Settlement): string {
  const faction = world.factions[settlement.factionId];
  const biome = world.planet.biomes[settlement.biomeId];
  const activeQuestCount = Object.values(world.quests).filter((quest) => quest.locationId === settlement.id && (quest.status === "open" || quest.status === "active")).length;
  return `
    <strong>${escapeHtml(settlement.name)}</strong>
    <small>${escapeHtml(`${faction?.name ?? "unclaimed"} · ${biome?.name ?? settlement.terrain}`)}</small>
    <small>${escapeHtml(`${settlement.topography} · ${Math.round(settlement.elevationMeters)}m · pop ${settlement.population}`)}</small>
    <small>${escapeHtml(`threat ${Math.round(settlement.threat)} · buildings ${(settlement.buildings ?? []).length} · quests ${activeQuestCount}`)}</small>
  `;
}

function renderBandHover(band: Band): string {
  const leader = world.persons[band.leaderId];
  const quest = band.currentQuestId ? world.quests[band.currentQuestId] : undefined;
  return `
    <strong>${escapeHtml(band.name)}</strong>
    <small>${escapeHtml(`${band.purpose} · led by ${leader ? formatPersonName(leader) : "unknown"}`)}</small>
    <small>${escapeHtml(band.goal)}</small>
    <small>${escapeHtml(`cohesion ${Math.round(band.cohesion)} · supplies ${Math.round(band.supplies)}${quest ? ` · ${quest.summary}` : ""}`)}</small>
  `;
}

function renderSectorHover(sector: World["geography"]["sectors"][string]): string {
  const biome = world.planet.biomes[sector.biomeId];
  const faction = dominantFactionForSector(sector);
  return `
    <strong>${escapeHtml(biome?.name ?? sector.biomeId)}</strong>
    <small>${escapeHtml(`${sector.kind} · ${sector.terrain} · ${sector.elevationBand}`)}</small>
    <small>${escapeHtml(`humidity ${sector.humidity} · temp ${sector.temperature} · tiles ${sector.tileIds.length}`)}</small>
    <small>${escapeHtml(`threat ${Math.round(sectorThreatScore(sector))}${faction ? ` · ${faction.name}` : ""}`)}</small>
  `;
}

function renderRegionTileHover(tile: World["geography"]["tiles"][string]): string {
  const biome = world.planet.biomes[tile.biomeId];
  const resources = tile.resourceHints.length ? tile.resourceHints.join(", ") : "none";
  return `
    <strong>${escapeHtml(biome?.name ?? tile.biomeId)}</strong>
    <small>${escapeHtml(`${tile.terrain} · ${layerLabels[tile.layer] ?? tile.layer} · ${tile.elevationBand}`)}</small>
    <small>${escapeHtml(`pass ${Math.round(tile.passability)} · danger ${Math.round(tile.danger)} · ${tile.q},${tile.r}`)}</small>
    <small>${escapeHtml(`resources ${resources}`)}</small>
  `;
}

function renderMapHoverAt(canvas: HTMLCanvasElement, event: MouseEvent): string {
  const point = canvasPointFromEvent(canvas, event);
  if (atlasZoom === "local") {
    const tile = nearestLocalTileAt(point, canvas.width, canvas.height, selectedSettlement());
    return tile ? renderRegionTileHover(tile) : renderSettlementHover(selectedSettlement());
  }
  if (atlasZoom === "region") {
    const sector = nearestRegionSectorAt(point, canvas.width, canvas.height, selectedSettlement()) ?? sectorForSettlement(selectedSettlement());
    return sector ? renderSectorHover(sector) : renderSettlementHover(selectedSettlement());
  }
  const band = nearestProjectedBand(point, canvas.width, canvas.height, 22);
  if (band) {
    return renderBandHover(band);
  }
  const settlement = nearestProjectedSettlement(point, canvas.width, canvas.height, atlasZoom === "world" ? 28 : 36);
  if (settlement) {
    return renderSettlementHover(settlement);
  }
  const sector = atlasZoom === "world" ? nearestPlanetSectorAt(point, canvas.width, canvas.height) : nearestSectorAt(point.x / canvas.width, point.y / canvas.height);
  return sector ? renderSectorHover(sector) : "";
}

function renderMap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#world-map");
  if (!canvas) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const snapshot = currentRenderSnapshot();
  const settlements = snapshot.settlements;
  const labels: MapLabel[] = [];
  context.clearRect(0, 0, width, height);

  if (atlasZoom === "local") {
    drawLocalAtlas(context, width, height, selectedSettlement(), labels);
    drawLingeringEffects(context, width, height, snapshot.effects);
    drawMapLabels(context, labels, width, height);
    return;
  }

  if (atlasZoom === "region") {
    drawRegionAtlas(context, width, height, selectedSettlement(), labels);
    drawMapLabels(context, labels, width, height);
    return;
  }

  drawWorldTerrainField(context, width, height, atlasOverlay);
  drawWorldBodies(context, labels, width, height);
  context.save();
  clipToPlanet(context, width, height);
  drawTerritoryClaims(context, width, height);
  drawWeatherFronts(context, width, height);
  if (atlasOverlay !== "political") {
    drawFeatures(context, width, height);
  }

  const selectedRouteId = selectedBand().travel?.routeId;
  const selectedSettlementId = snapshot.selections.settlementId;
  const visibleRoutes = snapshot.routes
    .map((route) => ({
      route,
      score:
        (route.id === selectedRouteId ? 1000 : 0) +
        (route.fromId === selectedSettlementId || route.toId === selectedSettlementId ? 160 : 0) +
        route.danger * 1.2 +
        route.passDifficulty
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  for (const { route } of visibleRoutes) {
    drawRoute(context, route, width, height);
  }
  drawStoryMarkers(context, width, height);

  const selectedId = selectedSettlement().id;
  for (const settlement of settlements.sort((a, b) => a.y - b.y)) {
    drawSettlement(context, settlement, width, height, selectedId, labels, undefined, "major");
  }
  drawBands(context, width, height, labels, true);
  context.restore();
  drawMapLabels(context, labels, width, height);
}

function render(): void {
  ensureUiSelections();
  document.querySelector<HTMLButtonElement>('[data-action="toggle-run"]')!.textContent = running ? "Pause" : "Play";
  document.querySelector<HTMLButtonElement>('[data-action="cycle-speed"]')!.textContent = speeds[speedIndex].label;
  renderLeftRail();
  renderChronicle();
  renderRightRail();
  renderMap();
  pendingRender = false;
}

function shouldDeferAutoRender(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLSelectElement;
}

function requestRender(): void {
  if (shouldDeferAutoRender()) {
    pendingRender = true;
    return;
  }
  render();
}

function restartTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
  }
  timer = window.setInterval(() => {
    if (!running) {
      return;
    }
    const speed = speeds[speedIndex];
    tickWorld(world, speed.steps);
    requestRender();
  }, speeds[speedIndex].ms);
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const actionButton = target.closest<HTMLButtonElement>("[data-action]");
  const personButton = target.closest<HTMLButtonElement>("[data-person-id]");
  const bandButton = target.closest<HTMLButtonElement>("[data-band-id]");
  const factionButton = target.closest<HTMLButtonElement>("[data-faction-id]");
  const organizationButton = target.closest<HTMLButtonElement>("[data-organization-id]");

  if (personButton) {
    world.selectedPersonId = personButton.dataset.personId ?? world.selectedPersonId;
    render();
    return;
  }

  if (bandButton) {
    world.selectedBandId = bandButton.dataset.bandId ?? world.selectedBandId;
    const band = selectedBand();
    world.selectedPersonId = band.leaderId;
    selectedMapSettlementId = band.travel?.destinationId ?? band.locationId;
    render();
    return;
  }

  if (factionButton) {
    selectedFactionId = factionButton.dataset.factionId ?? selectedFactionId;
    selectedMapSettlementId = world.factions[selectedFactionId]?.capitalId ?? selectedMapSettlementId;
    activityScope = "empire";
    render();
    return;
  }

  if (organizationButton) {
    selectedOrganizationId = organizationButton.dataset.organizationId ?? selectedOrganizationId;
    organizationView = "groups";
    render();
    return;
  }

  if (!actionButton) {
    const canvas = target.closest<HTMLCanvasElement>("#world-map");
    if (canvas) {
      focusMapFromCanvasEvent(canvas, event);
      render();
    }
    return;
  }

  const action = actionButton.dataset.action;
  if (action === "toggle-run") {
    running = !running;
  }
  if (action === "step") {
    tickWorld(world, 1);
  }
  if (action === "cycle-speed") {
    speedIndex = (speedIndex + 1) % speeds.length;
    restartTimer();
  }
  if (action === "save") {
    saveWorld();
  }
  if (action === "load") {
    const loaded = loadWorld();
    if (loaded) {
      world = loaded;
      worldGenDraft = { ...defaultWorldGenConfig(), ...world.generation };
      selectedFactionId = world.factions[selectedFactionId]?.id ?? Object.values(world.factions)[0]?.id ?? "";
      selectedOrganizationId = world.organizations?.[selectedOrganizationId]?.id ?? Object.keys(world.organizations ?? {})[0] ?? "";
      selectedMapSettlementId = world.bands[world.selectedBandId]?.locationId ?? Object.values(world.settlements)[0]?.id ?? "";
    }
  }
  if (action === "reset") {
    world = createWorld(`frontier-${Date.now()}`, worldGenDraft);
    worldGenDraft = { ...world.generation };
    selectedFactionId = Object.values(world.factions)[0]?.id ?? "";
    selectedOrganizationId = Object.keys(world.organizations ?? {})[0] ?? "";
    selectedMapSettlementId = world.bands[world.selectedBandId]?.locationId ?? Object.values(world.settlements)[0]?.id ?? "";
    saveWorld();
  }
  if (action === "generate-world") {
    world = createWorld(`frontier-${Date.now()}`, worldGenDraft);
    worldGenDraft = { ...world.generation };
    selectedFactionId = Object.values(world.factions)[0]?.id ?? "";
    selectedOrganizationId = Object.keys(world.organizations ?? {})[0] ?? "";
    selectedMapSettlementId = world.bands[world.selectedBandId]?.locationId ?? Object.values(world.settlements)[0]?.id ?? "";
    saveWorld();
  }
  if (action === "set-roster-view") {
    rosterView = actionButton.dataset.view === "graveyard" ? "graveyard" : "living";
  }
  if (action === "set-chronicle-view") {
    chronicleView = actionButton.dataset.view === "all" ? "all" : "major";
  }
  if (action === "set-organization-view") {
    const view = actionButton.dataset.view;
    if (view === "groups" || view === "assets" || view === "agreements") {
      organizationView = view;
    }
  }
  if (action === "set-atlas-zoom") {
    const zoom = actionButton.dataset.zoom;
    if (zoom === "world" || zoom === "region" || zoom === "local") {
      atlasZoom = zoom;
    }
  }
  if (action === "set-atlas-overlay") {
    const overlay = actionButton.dataset.overlay;
    if (overlay === "biomes" || overlay === "elevation" || overlay === "threat" || overlay === "political") {
      atlasOverlay = overlay;
    }
  }
  if (action === "set-activity-scope") {
    const scope = actionButton.dataset.scope;
    if (scope === "person" || scope === "band" || scope === "village" || scope === "empire") {
      activityScope = scope;
    }
  }
  if (action === "set-activity-category") {
    const category = actionButton.dataset.category;
    if (category === "general" || category === "diplomacy" || category === "health" || category === "economy" || category === "conflict" || category === "quests" || category === "world") {
      activityCategory = category;
    }
  }
  if (action === "bless-selected") {
    blessPerson(world, selectedPerson().id);
  }
  if (action === "watch-selected") {
    toggleWatchedPerson(world, selectedPerson().id);
  }
  if (action === "favor-selected-band") {
    setFavoredBand(world, selectedBand().id);
  }

  render();
});

document.addEventListener("focusout", () => {
  if (pendingRender) {
    window.setTimeout(() => {
      if (pendingRender) {
        render();
      }
    }, 0);
  }
});

document.addEventListener("mousemove", (event) => {
  const target = event.target as HTMLElement;
  const canvas = target.closest<HTMLCanvasElement>("#world-map");
  const card = document.querySelector<HTMLElement>(".map-hover-card");
  if (!canvas || !card) {
    return;
  }
  const panel = canvas.closest<HTMLElement>(".map-panel");
  const panelRect = panel?.getBoundingClientRect();
  const html = renderMapHoverAt(canvas, event);
  if (!html || !panelRect) {
    card.classList.add("empty");
    card.textContent = "Open terrain";
    return;
  }
  const left = clampNumber(event.clientX - panelRect.left + 14, 12, Math.max(12, panelRect.width - 318));
  const top = clampNumber(event.clientY - panelRect.top + 14, 58, Math.max(58, panelRect.height - 132));
  card.classList.remove("empty");
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.innerHTML = html;
});

document.addEventListener("mouseout", (event) => {
  const target = event.target as HTMLElement;
  const canvas = target.closest?.("#world-map");
  const related = event.relatedTarget as HTMLElement | null;
  if (!canvas || related?.closest?.("#world-map")) {
    return;
  }
  const card = document.querySelector<HTMLElement>(".map-hover-card");
  if (card) {
    card.classList.add("empty");
    card.textContent = "Open terrain";
  }
});

document.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const field = target.dataset.field;
  if (!field) {
    return;
  }

  if (field === "omen") {
    setOmen(world, target.value as QuestKind | "none");
  } else if (field === "worldSize") {
    worldGenDraft.size = target.value === "large" || target.value === "medium" ? target.value : "small";
  } else if (field === "worldContinents") {
    worldGenDraft.continents = Number(target.value);
  } else if (field === "healBelow" || field === "aoeAt" || field === "retreatBelow") {
    world.doctrine[field] = Number(target.value) as never;
  } else if (field in world.doctrine) {
    world.doctrine[field as keyof typeof world.doctrine] = target.value as never;
  }

  render();
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  const field = target.dataset.field;
  if (field === "healBelow" || field === "aoeAt" || field === "retreatBelow") {
    world.doctrine[field] = Number(target.value) as never;
    render();
  } else if (field === "worldLandmass" || field === "worldOcean" || field === "worldClimate") {
    const key = field === "worldLandmass" ? "landmass" : field === "worldOcean" ? "ocean" : "climate";
    worldGenDraft[key] = Number(target.value);
    render();
  }
});

restartTimer();
render();

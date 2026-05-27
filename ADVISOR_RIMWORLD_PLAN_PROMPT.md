# Advisor Prompt: Godwatch RimWorld-Style Simulation Plan

You are advising on Godwatch, a browser-based TypeScript fantasy world simulation in `C:\dev\godwatch`.

We want a concrete implementation plan for turning Godwatch toward a RimWorld-like readable simulation, without copying RimWorld assets or UI. Use RimWorld as a reference for strategic planet readability, local map clarity, pawns/entities doing real work, and emergent stories. The target is still Godwatch: a deity-watcher fantasy simulation where people, bands, villages, societies, guilds, monsters, artifacts, cultures, and crises act continuously.

## Situation

The current app is a Vite + TypeScript canvas/DOM project. It already simulates a world with people, bands, settlements, factions/societies, cultures, quests, abilities, items, recipes, combat, buildings, weather, territory, remains, and telemetry. The UI has world/region/local atlas modes, inspectors, logs, controls, and deterministic smoke/micro-scenario scripts.

The user’s current visual direction is:

- Stop decorative orbit/tilt/starfield animation for now.
- Make the world readable and simple before adding spectacle.
- World view should behave more like a strategic planet map: static globe/planet, hex coverage, continents/oceans, major settlements, territories, threats, routes, and clear zoom hierarchy.
- Region view should show the area around a selected settlement.
- Tiles should be seamless and coherent: borders, roads, rivers, coastlines, biomes, elevation bands, walls, and settlement edges should connect cleanly instead of reading as disconnected stamps.
- Tiles should have a clear visual matrix, not just a fill color. Each tile may need biome fill, elevation/topography shaping, weather overlay, climate state, contents, resources, ownership, danger, work orders, corpses, effects, construction state, borders, roads, rivers, walls, corner badges, edge markers, and status overlays.
- We have/will have Figma material for tile catalogs, hexes, hover states, icons, effects, minimap markings, tooltips, nested tooltips, variables, overlays, and UI categories. Advisor should plan how to turn that material into a reusable map grammar and implementation pipeline.
- Rendering should depend on zoom level. Far zoom should show planets, continents, oceans, empire territories, armies, major cities/villages, large threats, and strategic routes. Mid zoom should show regions, territories, villages, bands, routes, biome/elevation detail, resources, weather, and local threats. Local zoom should enter the subtiles and look closer to a RimWorld-like playable map.
- Local view should show subtiles inside an overtile/settlement: buildings, roads, occupants, resources, flora/fauna, corpses, effects/projectiles, construction, and combat.
- The renderer needs a vocabulary for entities, individuals, groups, bands, armies, villages, cities, buildings, flora, fauna, resources, territories, empires, threats, projectiles, and area/status effects.
- Entities must be the cause of things. Cities should expand because people haul/build/work, not because a group magically progresses an order.
- We want visible entities moving, fighting, gaining skills from repeated actions, teaching/learning, and becoming better at what they do.
- Simulation ticks should not make the game hard on the eyes. The backend can remain tick-authoritative, but the renderer should interpolate between tick snapshots with roughly 10-20+ visual frames per tick where possible, so movement, combat, projectiles, effects, construction, hauling, and work progress feel live rather than jump-cut.
- The zoom model should support going inward from overworld/planet to region to local subtiles, then outward again without losing selection context.
- Longer term, Godwatch should support multiple planets in a system. Entities should eventually explore and colonize other planets, requiring ships or equivalent traversal vehicles, offworld threats, exploration sites, colonization logistics, and interplanetary routes.
- God powers are a first-class design goal. The player is a dev-god watching and intervening in the simulation: pick up entities and place/settle/throw them elsewhere, bless or curse individuals, grant special buffs/items/abilities, spawn threats/resources/weather/events, change global conditions, alter biomes, crash meteors, mutate regions, start crises, or intervene at higher levels such as societies, armies, empires, climates, and planets.
- We are open to free/license-safe online pawn sprites/icons/tilesets or generated placeholders, but need a license-compliant asset strategy.

## Current Shape

Key files and modules:

- `package.json`: scripts are `npm run dev`, `npm run build`, `npm run test:smoke`, `npm run test:scenarios`, `npm test`, and `npm run check`.
- `index.html`: Vite entry shell.
- `src/main.ts`: current UI and canvas atlas rendering.
- `src/styles.css`: current app styling.
- `src/simulation.ts`: world creation, tick orchestration, persistence repair, deity interventions.
- `src/types.ts`: public type export surface used by the UI.
- `src/sim/types.ts`: shared persistent world contract.
- `src/sim/README.md`: module boundary map.
- `src/content.ts` and `src/sim/data/content.ts`: labels/authored fantasy content used by UI and simulation.
- `src/sim/world/buildings.ts`: settlement building catalog, construction, building services, footprints.
- `src/sim/world/occupancy.ts`: derives positions and occupancy buckets for persons, bands, settlements, remains, effects.
- `src/sim/combat/combat.ts`: automatic combat resolution.
- `src/sim/individuals/*`: stats, identity, moods, ambitions, influence, conversations, augmentations, people.
- `src/sim/abilities/compendium.ts`: abilities/spells/passives and learning/study helpers.
- `src/sim/economy/*`: items, recipes, organizations, assets, power.
- `src/sim/environment/*`: planet, climate, terrain, biomes, routes, topography.
- `src/sim/world/effects.ts`: lingering effects/projectiles/areas.
- `src/sim/world/remains.ts`: corpses/remains/graveyard handling.
- `src/sim/telemetry.ts`: backend validation and status.
- `scripts/run-sim-smoke.mjs`: broader deterministic smoke.
- `scripts/run-micro-scenarios.mjs`: targeted deterministic micro-scenarios.
- `scripts/sim-smoke-entry.ts` and `scripts/micro-scenarios-entry.ts`: scenario/test entrypoints bundled by the runner scripts.

Current structure notes:

- The repo is still small enough for incremental refactors, but `src/main.ts` currently carries UI state, DOM rendering, canvas drawing, hit-testing, hover text, and event handling in one large file. Advisor should assume we need careful seams rather than a rewrite: local map renderer helpers, visual snapshot/interpolation helpers, command handlers, and inspectors can be carved out gradually.
- `src/simulation.ts` should remain the public orchestration facade. Domain modules under `src/sim/*` should own simulation truth, while rendering helpers should consume derived snapshots instead of mutating world state directly.
- Existing deity-style hooks include selection/favoring, watching people, omens, and blessing-style interventions. The desired god powers are much broader and should probably become explicit commands/events with telemetry, validation, and deterministic replay/repair behavior.

Current simulation-world primer:

- People/champions are individual entities. They have names, ancestry, faction/society membership, location, role, archetype, stats, derived stats, skills, traits, identity axes, memories/knowledge, moods, relationships, possessions/equipment, wounds/statuses, and sometimes band membership. Visually they can begin as pawn-like icons/sprites with overlays for health, intent, job, faction, status, equipment, and selected/hover states.
- Individuals do things: roam, travel, fight, accept quests, learn abilities/recipes, use items, work building services, occupy local tiles/buildings, form bonds/rivalries, become wards/parents/teachers, die and leave remains, and eventually should haul, mine, build, farm, craft, guard, train, teach, trade, worship, scheme, lead, desert, or migrate.
- Bands are small groups of individuals with a purpose, leader, cohesion, supplies, current quest/goal, route/travel state, and local tile position. They are not the same as empires; they are mobile parties, pilgrim groups, warbands, escorts, adventurers, raiders, or work crews.
- Societies/empires are the main large political/cultural bodies. They hold settlements, territories, cultures, outlook/identity averages, laws/practices, capital sites, subject populations, strategic interests, and eventually armies/navies/colonies. They may war, fracture, conquer, suffer civil unrest, issue quests, absorb wards/orphans, and mutate culturally.
- Factions inside a society should be understood as political/interest groups, not separate empires by default. They can behave like political bands: loyalists, rebels, guild blocs, religious movements, noble houses, dynasties, cults, mercantile interests, exiles, heretics, or usurpers. Individuals can be loyal to multiple groups at once, creating conflicts.
- Guilds and organizations are collective economic/social actors. A guild can be a cluster of businesses or services: blacksmiths, apothecaries, construction crews, mercenaries, escorts, thieves, assassins, peacekeepers, miners, priests, scholars, shipwrights, and similar groups. They own assets, hire people/bands, issue quests, lobby societies, create agreements, and compete for resources/status.
- Settlements/cities/villages are places with population, buildings, borders, resources, services, assets, threats, build orders, local tiles, and ties to societies/guilds. They should expand through actual work by entities and available resources rather than abstract progress alone.
- The economy is currently embryonic but should grow into food, gold/coin, ore, wood, stone, herbs, souls/aether/relic materials, trade goods, tools, weapons, armor, components, fuel/energy, batteries, livestock, produced goods, and services. We need production chains, inventories/stockpiles, ownership, contracts, logistics, markets, prices/value, scarcity, trade routes, taxes/tribute, guild assets, settlement needs, and quests created from economic pressure.

Recent foundation changes:

- World view was simplified by removing visual animation loop, starfield, sun marker/orbit line, and tilt/orbit state. Simulation still ticks; the map redraws on tick or interaction.
- The building service micro-scenario now asserts that active service buildings have valid footprints, assigned workers have `localTileId`, and the assigned local tile is inside the building footprint.

## Planning Problem

Design a staged path from the current canvas/text sim to a readable RimWorld-like Godwatch foundation where:

1. Entities have coordinates and visible local movement.
2. Work orders are claimed and performed by specific entities.
3. Buildings occupy local subtiles and visibly expand villages/cities.
4. Combat, projectiles, effects, statuses, corpses, hauling, construction, and resource extraction can be seen.
5. Skills improve from action loops and affect future action quality/speed/outcomes.
6. World, region, and local zoom levels have coherent data contracts and visual responsibilities.
7. The sim can scale through cadence, LOD, batching, and deterministic telemetry instead of UI-driven hacks.
8. Tile art/data joins seamlessly across adjacent tiles: terrain, rivers, roads, settlement borders, biome transitions, walls, ownership borders, and elevation contours should visually and semantically line up.
9. The strategic model can later grow from one planet to a solar/system map with ships, exploration, colonization, offworld threats, and interplanetary logistics.
10. Visual state interpolates smoothly between authoritative ticks, targeting about 10-20+ rendered frames per sim tick when the browser can afford it.
11. Each tile can present a compact matrix of biome, climate/weather, elevation, ownership, contents, statuses, borders/edges/corners, and overlays without becoming unreadable.
12. God powers can act at multiple scales while remaining explicit, inspectable simulation interventions: individual, group, settlement, region, planet, and eventually system-level.
13. The economy evolves from current assets/recipes/trade hints into concrete resources, stockpiles, production chains, markets, ownership, logistics, and trade pressure that cause quests, work orders, guild behavior, settlement growth, conflict, and exploration.

## Constraints

- Keep the backend simulation authoritative. Visuals must witness simulation truth, not invent it.
- Do not break save/repair unless a migration is explicitly planned.
- Keep changes incremental and testable.
- Prefer deterministic scenario validation for every new system.
- God powers should be implemented as deliberate commands/events, not hidden direct mutations, so they can be tested, logged, repaired, and visualized.
- Do not copy RimWorld assets, names, or exact UI; use only license-safe assets or placeholders.
- Avoid broad rewrites unless the plan proves they are cheaper than incremental repair.
- The project is browser TypeScript today; recommend a rendering stack only if it is clearly justified.

## Questions To Answer

1. What should the core spatial model be for world/region/local coordinates?
2. Should local maps be hexes, squares, or hybrid: hex overworld with square subtiles?
3. What is the minimal entity-action model for hauling, building, mining, fighting, resting, training, teaching, and socializing?
4. How should construction become entity-driven without over-simulating every nail?
5. How should skills advance from actions, and how should action quality/speed feed back into the simulation?
6. What should the visual renderer draw first so the game becomes easier to reason about immediately?
7. What data should be exposed from `occupancy.ts` or a new local map module for local rendering?
8. What asset strategy should we use for pawns, building icons, terrain, effects, and projectiles?
9. What tile/autotile/edge-joining strategy should make terrain, roads, rivers, borders, walls, and settlement footprints seamless?
10. What is the tile visual grammar: fill, border, edge, corner, center glyph, contents stack, weather layer, danger/status layer, route layer, hover layer, and selected/inspected layer?
11. How should Figma tile catalogs, variables, icons, hover states, overlays, minimap marks, tooltips, and nested tooltips become implementation assets or design tokens?
12. How should we represent individuals, groups, armies, cities/villages, empire territories, flora/fauna, and threats at each zoom level?
13. How should tick snapshots, render interpolation, trails, easing, and animation budgets work so the sim remains deterministic while the game looks live?
14. How should future ships, offworld exploration, colonization, and multi-planet system traversal fit without derailing the first local-map foundation?
15. How should god powers be modeled: command API, UI affordances, scope levels, target selection, validation, telemetry, replay/repair, and visual effects?
16. Which god powers should be first: pick up/place entity, bless/curse, grant item/ability, spawn entity/group/threat/resource/weather, alter tile biome/status, crash meteor, or global condition changes?
17. How should people, bands, societies/empires, political factions, guilds, organizations, businesses, armies, and settlements be represented visually and mechanically without collapsing them into one generic "faction" concept?
18. What is the first practical economy slice: food, gold, ore, trade goods, production chains, stockpiles, ownership, hauling/logistics, markets, trade routes, guild assets, or quest pressure?
19. What test/micro-scenario suite should prove the foundation works?
20. What should be deferred until the foundation is stable?

## Required Output

Return an implementation-ready plan, not abstract advice.

Use this shape:

- `Target Architecture`: spatial model, simulation loop, visual renderer, data ownership.
- `Lane Plan`: 3-5 lanes with scope, allowed files/modules, dependencies, and merge order. Include a future-facing but bounded exploration/ships/threats lane that a subagent can extend after the single-planet foundation is stable.
- `First 5 Tranches`: concrete changes small enough for subagents to build and test.
- `Validation Matrix`: micro-scenarios, smoke tests, visual screenshot checks, invariants.
- `Asset Plan`: license-safe sources/categories and placeholder strategy.
- `Tile Visual Matrix`: how tile biome, weather, climate, contents, ownership, borders, corners, routes, resources, danger, and statuses are encoded at each zoom level, including Figma component/token usage.
- `Animation Plan`: tick snapshot interpolation, frame budgets, easing rules, motion trails/effects, and how to keep deterministic simulation separate from non-authoritative visual smoothing.
- `God Powers Plan`: command/event model, UI targeting, safe mutation rules, telemetry, validation, replay/repair, and first powers to implement at individual/local/global scales.
- `Actor/Society Plan`: how individuals, bands, societies/empires, political factions, guilds, organizations, businesses, armies, villages, and cities differ in data, behavior, visual representation, and UI inspection.
- `Economy Plan`: first resource model, stockpiles, ownership, production chains, work orders, hauling/logistics, markets, trade routes, guild assets, and how economic pressure creates quests/conflicts.
- `Performance Plan`: cadence/LOD/batching/SoA thresholds and when to optimize.
- `Risks`: sharp edges and rollback criteria.
- `Do Not Do Yet`: tempting work that should wait.

Make each tranche specific enough that an implementation agent can start without another planning pass.

# Simulation Module Map

`src/simulation.ts` is the public orchestration facade used by the UI. It owns world creation, per-tick scheduling, quest flow, persistence repair, and deity interventions. Domain logic that can grow independently lives under `src/sim`.

## Boundaries

- `core/`: deterministic helpers shared by every domain, currently RNG and math/id helpers.
- `data/`: authored fantasy content tables such as biome profiles, settlement names, faction roots, labels, and quest flavor.
- `abilities/`: the compendium of spells, tactics, passives, requirements, observation-based studies, learning rules, and ability-scoring helpers.
- `environment/`: the planet medium, biomes, terrain, topography, elevation ecology, mineable/explorable features, holdings, routes, settlement distance, pass difficulty, and travel-cost helpers.
- `economy/`: item creation, biome loot, quality/material/tech variants, item provenance, legendary recipe knowledge, recipe observation, sentient relic wills, consumables, and equipment choices.
- `individuals/`: people, memories, traits, skills, core and derived stats, archetypes, mutable identity axes, party leadership, and power scoring.
- `society/`: society cultures, hybrid cultures, practice research trees, settlement effects, lineage repair, ancestry, orphans, wards, fostering, birth, inheritance, childhood education, and coming-of-age promotion.
- `combat/`: automatic battle resolution, target policy, healing, AoE behavior, retreat checks, wounds, and death.
- `chronicle/`: world event creation and event-list trimming.
- `world/`: persistent story drivers such as artifacts, bosses, crises, emerging legend hooks, legendary quest spawning, and future empire diplomacy or political factions inside societies.

## Expansion Notes

Keep `src/simulation.ts` thin when adding new systems. If a feature answers "what happens inside a domain", put it in the domain module; if it answers "when does this domain run during the tick", wire it through `simulation.ts`.

Use the shared `World` shape in `src/sim/types.ts` as the simulation contract. When adding a new subsystem, add explicit state to the relevant type first, then make the tick orchestration call a named function from that subsystem.

Legend objects keep bounded `hooks` arrays for emerging possibilities. Story adjudication should add deterministic hooks alongside history, while `updateStoryEngine` owns hook decay and promotion into legend-linked quests or chronicle events.

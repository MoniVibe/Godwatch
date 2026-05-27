# Nightly cycle - Godwatch legibility

You are a bounded implementation agent for the Godwatch sim. This prompt is idempotent: run it many times tonight; each run leaves the tree test-green, or documents a blocker, and updates the progress checkpoint.

## 0. Re-orient

1. Repo root: `C:\dev\godwatch`
2. Plan source: `C:\dev\plans\godwatch.md`
3. Check repo ground truth:
   ```powershell
   cd C:\dev\godwatch
   git status -sb 2>$null; if ($LASTEXITCODE -ne 0) { Write-Host "GIT: not initialized" }
   git branch --show-current 2>$null
   git rev-parse HEAD 2>$null
   git log -3 --oneline 2>$null
   ```
4. Read and update checkpoint: `C:\dev\godwatch\.nightly\PROGRESS.md`.

Do not redo items marked `DONE` in `PROGRESS.md` unless tests regressed.

If no `.git` exists, initialize it:

```powershell
cd C:\dev\godwatch
git init
git checkout -b nightly/godwatch-legibility
```

Commit and push every successful slice. If no `origin` exists, commit locally and note `push deferred` in `PROGRESS.md`.

## 1. Mission

Make Godwatch legible: actors at positions, actors doing work, work changing tiles, tiles explaining themselves, and renderer witnessing truth rather than inventing gameplay.

Core law:

- Simulation stores semantic coordinates: planet hex and local square, never pixel coords in sim state.
- Backend is authoritative. Renderer/interpolation never decides movement, harvest, build, death, or combat outcomes.
- Cut seams into the existing codebase; do not rewrite the app.

Target loop:

```txt
Input / god command queue -> validate -> apply at tick -> advance truth -> repair/invariants -> domain events -> render snapshot -> interpolate A->B (visual only)
```

## 2. Backlog

Strict order. Pick the lowest-numbered tranche not fully `DONE`; finish the smallest shippable vertical slice. Mark each sub-item in `PROGRESS.md` as `TODO`, `IN_PROGRESS`, `DONE`, or `BLOCKED`.

### Tranche 1 - Spatial contracts & local map skeleton

Goal: every settlement has stable local space.

Build:

- Add `src/sim/world/spatial.ts`, `src/sim/world/localMap.ts`, `src/sim/world/localTerrain.ts`.
- Add `PlanetCoord`, `HexCoord`, `LocalCoord`, `EntityPosition`.
- Add `makeLocalTileId`, `parseLocalTileId`, `ensureLocalMapForSettlement`.
- Local dimensions: camp `32x32`, village `64x64`, town/city `96x96`.
- Save repair: lazy local maps; invalid person tiles -> entrance; OOB footprints -> repair flag, no crash.

Acceptance:

- Existing saves load.
- Building footprint micro-scenario still passes.
- New deterministic scenario: settlement and all buildings have in-bounds local coordinates.
- `npm run check`.

### Tranche 2 - Snapshot pipeline & `main.ts` split

Goal: rendering reads snapshots, not world internals.

Build:

- Add `src/view/snapshot.ts`, `src/view/selectors.ts`, `src/render/canvasRenderer.ts`, `src/render/layers/worldLayer.ts`, `src/render/layers/regionLayer.ts`, `src/render/layers/localLayer.ts`, `src/render/hitTest.ts`, `src/render/tileGrammar.ts`.
- Extract drawing/hover from `src/main.ts`; canvas setup stays in `src/main.ts`.
- Define `RenderSnapshot` with tick, mode, camera, tiles, entities, effects, routes, labels, selections.

Acceptance:

- No renderer mutates `world`.
- World/region/local redraw from snapshot only.
- Hover still works.
- Smoke tests pass.
- Debug snapshot JSON test for one deterministic seed.
- `npm run check`.

### Tranche 3 - Work orders, reservations, visible haul/build

Goal: growth from named actors doing work.

Build:

- Add `src/sim/actions/types.ts`, `workOrders.ts`, `reservations.ts`, `actorActions.ts`.
- Add or extend `src/sim/economy/resources.ts`, `stockpiles.ts`.
- First jobs: `haul`, `build`, `mine`, `rest`.
- Workflow: need -> work order -> score -> reserve -> move -> perform -> event -> XP -> release.
- Construction states: planned -> needsMaterials -> materialsDelivered -> underConstruction -> complete | damaged.
- Resource categories only: wood, stone, ore, food, coin, tools.

Acceptance:

- Scenario: builder hauls wood stockpile -> blueprint.
- Scenario: builder completes hut from delivered materials.
- Invariant: no active work order without `claimedBy`.
- Invariant: no double reservation of same stack unless split.
- Local view shows actor, route intent, carried item, construction progress.
- `npm run check`.

### Tranche 4 - Interpolation, combat readability, skills

Goal: motion and combat readable without lying to sim.

Build:

- Add `src/view/interpolation.ts`, `src/render/layers/entityLayer.ts`, `src/render/layers/effectsLayer.ts`, `src/sim/individuals/skillProgression.ts`.
- Prev/next snapshot interpolation, visual only.
- Combat event packets; remains from `remains.ts`; status badges.
- Skill XP loop: construction, mining, combat, hauling, social/teaching, medicine.

Acceptance:

- Mining XP increases with repeated mining.
- Higher construction skill -> faster equal building.
- Projectile/effect visual only between actors.
- Death -> remains on correct local tile.
- Interpolation works when sim ticks slowly.
- `npm run check`.

### Tranche 5 - God command bus + first economy pressure

Goal: player interventions and shortages are explicit causes.

Build:

- Add `src/sim/god/commands.ts`, `validate.ts`, `apply.ts`, `src/sim/economy/needs.ts`, `markets.ts`, `src/ui/godTools.ts`, `src/ui/inspectors/economyInspector.ts`.
- First powers: pick/place entity, bless/curse, spawn resource, spawn threat, change tile/biome, region weather.
- Food-low -> gather/farm/trade work -> visible hauling/stockpile changes.

Acceptance:

- Invalid god targets rejected.
- Commands in telemetry and domain events.
- Deterministic replay micro-scenario for god pick/place.
- Low food creates work orders.
- Stockpile changes only via actor action or explicit god command.
- `npm run check`.

## 3. Rules

Ownership:

| Area | Path |
| --- | --- |
| Facade | `src/simulation.ts` |
| Spatial / local maps | `src/sim/world/spatial.ts`, `src/sim/world/localMap.ts` |
| Actions | `src/sim/actions/*` |
| Economy | `src/sim/economy/*` |
| God | `src/sim/god/*` |
| View | `src/view/*` |
| Render | `src/render/*` |
| UI | `src/ui/*` |
| Conductor | `src/main.ts` wires DOM/canvas only |

Invariants:

- No actor has two active actions.
- No active work order without `claimedBy`.
- No negative resource stacks.
- No renderer writes to `world`.
- No god mutation without validation.
- No settlement expansion without build completion or explicit god command.
- Projectiles/effects are not authoritative without domain events.

Forbidden for now:

- PixiJS/Phaser switch before Canvas2D profiling proves need.
- Full multi-planet colonization, orbital spectacle, spherical topology.
- Full dynamic market economy or per-item nail simulation.
- Societies performing local labor directly.
- Dozens of god powers before command bus exists.
- Every actor thinking every tick.
- RimWorld UI/sprites/names clone.
- Screenshots driving sim truth.
- Bulk non-CC0 art without manifest.
- Broad unrelated refactors or `main.ts` rewrite-in-place.

## 4. Test

Before committing:

```powershell
cd C:\dev\godwatch
npm run check
```

Equivalent: `npm run build && npm test`.

If adding a scenario, use existing patterns in `scripts/micro-scenarios-entry.ts`: `scenario()`, `assertValid`, and deterministic seeds.

Do not commit failing `npm run check`. Fix or revert before commit.

## 5. Commit and checkpoint

```powershell
cd C:\dev\godwatch
git add -A
git status
git commit -m "godwatch(nightly): <tranche-N> <what and why>"
git push -u origin HEAD
```

If push is unavailable, commit locally and document the next step.

Append to `C:\dev\godwatch\.nightly\PROGRESS.md`:

```markdown
## Run <UTC ISO8601>
- Branch / HEAD: ...
- Tranche / slice: ...
- Status: DONE | IN_PROGRESS | BLOCKED
- Tests: npm run check -> PASS/FAIL
- Commit: <sha> pushed: yes/no
- Files touched: ...
- Next run: <one sentence>
- Blockers: ...
```

Maintain the tranche status table at the top.

## 6. Halt conditions

Stop and document:

- Wrong directory or accidental edits outside `C:\dev\godwatch`.
- Tranche N+1 starts while Tranche N acceptance is incomplete.
- Save load breaks and repair path is unclear.
- Test failure cannot be fixed within slice budget.
- Law ambiguity: sim vs render ownership.

## 7. Handoff

```text
PLAN: Godwatch legibility (godwatch.md)
REPO: C:\dev\godwatch @ <branch> <sha>
TRANCHE: <1-5> - <slice title> -> <DONE|IN_PROGRESS|BLOCKED>
TESTS: npm run check -> <PASS|FAIL>
COMMIT: <sha|none> pushed: <yes|no>
NEXT: <one sentence>
BLOCKERS: <none|list>
```

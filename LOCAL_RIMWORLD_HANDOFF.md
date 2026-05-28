# Godwatch Local RimWorld-Style Foundation Handoff

Updated: 2026-05-28

## Current Direction

Godwatch is pivoting toward a local-map, RimWorld-like simulation foundation. Treat the earlier planet/world visual work as secondary context, not the current implementation center.

The current priority is a deterministic local gameplay kernel where:

- pawns live on square local tiles;
- player/god commands apply at tick boundaries;
- jobs/reservations drive pawn labor;
- resources move through pawn actions, not abstract group magic;
- snapshots/replay support future multiplayer and rendering;
- rendering must witness sim truth and must not decide gameplay.

Multiplayer readiness means the authoritative host/server owns commands, ticks, state mutation, events, and replay checksums. Clients should submit commands and render snapshots.

## Repo State

- Repo: `C:\dev\godwatch`
- Branch: `nightly/godwatch-legibility`
- Remote: `origin` -> `git@github.com:MoniVibe/Godwatch.git`
- Latest pushed commit: `2927383 godwatch(local): index haul work for stress scale`

Recent local-sim commits:

- `522c775 godwatch(local): add deterministic local gameplay kernel`
- `bd50033 godwatch(local): extend rimworld foundation`
- `2927383 godwatch(local): index haul work for stress scale`

## Important Files

- `src/sim/local/types.ts`  
  Serializable local state, commands, tiles, pawns, jobs, reservations, stockpile zones.

- `src/sim/local/sim.ts`  
  Authoritative tick loop, work indexes, job derivation/claiming, hauling, building, mining, validation.

- `src/sim/local/grid.ts`  
  Local tile IDs, bounds, direct-step movement fast path, BFS fallback.

- `src/sim/local/snapshot.ts`  
  Read-only local sync/render snapshot for tiles, pawns, jobs, reservations, stockpiles, events.

- `src/sim/local/replay.ts`  
  Clone/replay/checksum helpers for deterministic validation.

- `scripts/micro-scenarios-entry.ts`  
  Deterministic micro-scenarios proving local behaviors.

- `scripts/local-stress-entry.ts` and `scripts/run-local-stress.mjs`  
  Headless stress harness for local pawn hauling.

## What Works Now

The local kernel supports:

- deterministic square local maps;
- pawn movement on local tiles;
- build designation commands;
- mine designation commands;
- spawn resource commands;
- stockpile zone commands from tile lists or rectangles;
- derived haul jobs for blueprint materials;
- derived haul jobs for loose resources into stockpiles;
- job claiming and reservations;
- resource pickup/delivery;
- building completion through pawn labor;
- mining/harvesting through pawn labor;
- skill XP increments for hauling, construction, mining;
- validation of basic invariants;
- read-only local snapshots;
- deterministic replay/checksum tests;
- a repeatable stress harness.

## Validation Commands

Baseline check:

```powershell
cd C:\dev\godwatch
npm run check
```

Local stress harness:

```powershell
cd C:\dev\godwatch
node scripts\run-local-stress.mjs --mode=derived --count=10000 --ticks=3 --cols=100
node scripts\run-local-stress.mjs --mode=precreated --count=10000 --ticks=3 --cols=100
node scripts\run-local-stress.mjs --mode=active-adjacent --count=20000 --ticks=2 --cols=200
```

Known recent stress results on this machine:

- `derived`, 10,000 pawns, 10,000 generated stockpile jobs, 3 ticks:
  - delivered: `10000`
  - issueCount: `0`
  - run: about `277.9ms`
  - perTick: about `92.6ms`

- `precreated`, 10,000 pawns/jobs, 3 ticks:
  - delivered: `10000`
  - issueCount: `0`
  - run: about `317.2ms`

- `active-adjacent`, 20,000 pawns, 2 ticks:
  - delivered: `20000`
  - issueCount: `0`
  - run: about `387.5ms`

## Key Invariants

Maintain these unless deliberately changing the architecture:

- Player/god commands apply at tick boundaries.
- Sim state uses semantic tile coordinates, not pixels.
- Renderer/snapshot/interpolation code cannot mutate sim truth.
- A pawn should not run multiple active jobs.
- A claimed job must have `claimedBy`.
- Reservations must prevent double-booking of source resources and stockpile/build targets.
- Resources should only change through pawn actions or explicit commands.
- Replay/checksum should stay deterministic for the same initial state and commands.
- Stockpile hauling must not preempt higher-priority blueprint material hauling.

## Current Performance Shape

Before indexing, the naive job pipeline timed out around 1,000 pawns/jobs. The current commit adds per-tick work indexes:

- reservations by target;
- reservation IDs by job;
- active haul sources;
- active stockpile haul targets;
- build jobs by target;
- incoming build-material haul counts;
- resource tiles by kind;
- stockpile target tiles by accepted resource kind;
- stable/numeric-aware job ordering;
- direct-step movement before BFS.

This makes thousands of simple adjacent hauling jobs feasible. It is still not a full large-scale colony AI architecture.

## Main Risks

1. Event volume  
   10k pawns doing visible work emits tens of thousands of events in seconds. Long-running simulations will drown logs unless events are channelized, bounded, aggregated, or sampled.

2. Pathfinding  
   Direct adjacent/line movement is fine. Far-path movement with many pawns can still be expensive because BFS fallback is per pawn per movement step. Future work needs cached paths, flow fields, or room/zone path abstractions.

3. Work index lifetime  
   Indexes are rebuilt per tick, which is safe and simple. This may be enough for now, but long-term scale may need persistent dirty indexes. Do not move there prematurely without proof.

4. Event replay size  
   Snapshots and replay checksums are useful, but the event stream will become a storage/network issue.

5. Single-threaded JavaScript ceiling  
   Current stress is okay for thousands of simple jobs. Richer pawn AI, pathfinding, combat, needs, and economy will need cadence partitioning, LOD, worker threads, or sharding.

## Recommended Next Slices

1. Event channels and bounded buffers  
   Add event categories such as `movement`, `jobs`, `resources`, `combat`, `debug`. Keep high-volume movement events out of permanent history by default. Add aggregate counters for stress runs.

2. Local pawn needs and job priorities  
   Add hunger/rest/basic needs, then ensure job selection prioritizes survival, hauling/building, and player commands deterministically.

3. Stockpile capacity and stack merging rules  
   Current stockpiles accept by resource kind and merge simply. Add capacity, stack limits, and forbidden/allowed filters.

4. Local renderer from snapshots  
   Build a simple square-tile local view that consumes `createLocalGameSnapshot` only. Show pawns, resources, stockpiles, blueprints, job intent, and carried items.

5. Pathfinding scale tranche  
   Add path cache or flow fields for many pawns moving to common targets. Benchmark far-path stress separately from adjacent hauling.

6. Multiplayer command contract  
   Define host-authoritative command envelopes, client IDs, tick targeting, rejection events, replay checkpoints, and checksum comparison.

## Advisor Questions

Advisor should review the current approach and advise on:

1. Whether the local sim should stay object-record based for now or move toward ECS/SoA sooner.
2. How to structure long-running event telemetry so the game remains debuggable without logging 50k movement events per burst.
3. What scale target is sensible for:
   - active pawns on one local map;
   - simulated offscreen pawns;
   - background villages/empires at lower LOD.
4. Whether per-tick rebuilt indexes are acceptable for the next few tranches, or whether persistent dirty indexes should be introduced now.
5. How to design multiplayer determinism:
   - command ordering;
   - rollback/replay;
   - snapshot/checksum cadence;
   - authority model;
   - spectator/client interpolation.
6. How to connect the local maps back to the planet/world layer without letting global societies perform local labor abstractly.
7. What minimum playable loop should come before expanding world scale again.

## Agent Instructions

For new implementation agents:

- Start by reading this file, then `src/sim/local/README.md`, then `src/sim/local/sim.ts`.
- Keep changes small and prove them with micro-scenarios.
- Use `npm run check` before committing.
- Use `node scripts\run-local-stress.mjs ...` for performance-sensitive changes.
- Do not rewrite old planet visuals while working this local gameplay track.
- Do not make renderer code authoritative.
- If touching scheduling/pathfinding/events, include a stress result in the handoff.

## Suggested Next Agent Prompt

```markdown
Work from `C:\dev\godwatch` on `nightly/godwatch-legibility`.
Read `LOCAL_RIMWORLD_HANDOFF.md` first.
Advance the local RimWorld-like foundation by one bounded slice.
Preserve deterministic commands/ticks, authoritative sim truth, snapshot read-only behavior, and existing micro-scenarios.
Prefer the next slice: event channels/ring buffers or local pawn needs/job priorities.
Run `npm run check`.
If performance-sensitive, also run `node scripts\run-local-stress.mjs --mode=derived --count=10000 --ticks=3 --cols=100`.
Report changed files, validation, stress numbers if relevant, risks, and next step.
```

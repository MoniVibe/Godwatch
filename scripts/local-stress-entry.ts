import { createLocalGameState, tickLocalGame, validateLocalGameState } from "../src/sim/local";
import { localTileId } from "../src/sim/local/grid";
import type { LocalGameState, LocalId, LocalJob, LocalPawn, LocalResourceKind, LocalStockpileZone } from "../src/sim/local/types";

type StressMode = "derived" | "precreated" | "active-adjacent";

interface StressOptions {
  count: number;
  ticks: number;
  mode: StressMode;
  seed: string;
  cols: number;
  validate: boolean;
}

interface StressLayout {
  resourceTileIds: LocalId[];
  stockpileTileIds: LocalId[];
}

const options = parseOptions(process.argv.slice(2));
const setupStarted = performance.now();
const { state, layout } = createStressState(options);
const setupMs = performance.now() - setupStarted;

const runStarted = performance.now();
tickLocalGame(state, options.ticks);
const runMs = performance.now() - runStarted;

const validateStarted = performance.now();
const issues = options.validate ? validateLocalGameState(state) : [];
const validateMs = performance.now() - validateStarted;

const heap = process.memoryUsage();
const result = {
  mode: options.mode,
  seed: options.seed,
  count: options.count,
  ticks: options.ticks,
  dimensions: { width: state.width, height: state.height, tiles: Object.keys(state.tiles).length },
  timingsMs: {
    setup: round(setupMs),
    run: round(runMs),
    validate: round(validateMs),
    perTick: round(runMs / Math.max(1, options.ticks)),
    perPawnTick: round(runMs / Math.max(1, options.count * options.ticks))
  },
  delivered: countDeliveredWood(state, layout.stockpileTileIds),
  sourceRemaining: countRemainingWood(state, layout.resourceTileIds),
  jobs: countJobs(state),
  pawns: countPawns(state),
  issueCount: issues.length,
  issues: issues.slice(0, 10),
  eventCount: state.events.length,
  recentEvents: state.events.slice(-5).map((event) => ({ tick: event.tick, kind: event.kind, subjectId: event.subjectId })),
  heap: {
    usedMb: round(heap.heapUsed / 1024 / 1024),
    totalMb: round(heap.heapTotal / 1024 / 1024),
    rssMb: round(heap.rss / 1024 / 1024)
  }
};

console.log(JSON.stringify(result, null, 2));

function createStressState(options: StressOptions): { state: LocalGameState; layout: StressLayout } {
  const rows = Math.ceil(options.count / options.cols);
  const width = options.cols * 2 + 4;
  const height = rows + 4;
  const state = createLocalGameState({ seed: options.seed, width, height });
  const resourceTileIds: LocalId[] = [];
  const stockpileTileIds: LocalId[] = [];

  const zone: LocalStockpileZone = {
    id: "stockpile-stress",
    name: "Stress Stockpile",
    tileIds: stockpileTileIds,
    accepts: ["wood"],
    priority: 50,
    createdByCommandId: "stress-setup"
  };
  state.stockpiles[zone.id] = zone;

  for (let index = 0; index < options.count; index += 1) {
    const column = index % options.cols;
    const row = Math.floor(index / options.cols);
    const resourceTileId = localTileId(2 + column * 2, 2 + row);
    const stockpileTileId = localTileId(3 + column * 2, 2 + row);
    const resourceTile = state.tiles[resourceTileId];
    const stockpileTile = state.tiles[stockpileTileId];
    resourceTile.kind = "grass";
    resourceTile.walkable = true;
    resourceTile.resource = options.mode === "active-adjacent" ? undefined : { kind: "wood", amount: 1 };
    stockpileTile.kind = "grass";
    stockpileTile.walkable = true;
    stockpileTile.stockpileZoneId = zone.id;
    resourceTileIds.push(resourceTileId);
    stockpileTileIds.push(stockpileTileId);

    const pawn = makeStressPawn(index, resourceTile.x, resourceTile.y);
    state.pawns[pawn.id] = pawn;

    if (options.mode === "precreated") {
      state.jobs[`job-${index}`] = makeHaulJob(index, resourceTileId, stockpileTileId, "open");
    } else if (options.mode === "active-adjacent") {
      const job = makeHaulJob(index, resourceTileId, stockpileTileId, "claimed");
      job.claimedBy = pawn.id;
      state.jobs[job.id] = job;
      pawn.inventory = { kind: "wood", amount: 1 };
      pawn.action = {
        kind: "haul",
        jobId: job.id,
        stage: "to-target",
        sourceTileId: resourceTileId,
        targetTileId: stockpileTileId,
        resource: "wood",
        amount: 1
      };
      state.reservations[`reservation-source-${index}`] = {
        id: `reservation-source-${index}`,
        jobId: job.id,
        pawnId: pawn.id,
        targetKind: "resource",
        targetId: resourceTileId
      };
      state.reservations[`reservation-target-${index}`] = {
        id: `reservation-target-${index}`,
        jobId: job.id,
        pawnId: pawn.id,
        targetKind: "tile",
        targetId: `${stockpileTileId}:wood`
      };
    }
  }

  return { state, layout: { resourceTileIds, stockpileTileIds } };
}

function makeStressPawn(index: number, x: number, y: number): LocalPawn {
  return {
    id: `pawn-${index.toString().padStart(6, "0")}`,
    name: `Pawn ${index}`,
    x,
    y,
    skills: { hauling: 2, construction: 0, mining: 0 },
    xp: { hauling: 0, construction: 0, mining: 0 }
  };
}

function makeHaulJob(index: number, sourceTileId: LocalId, targetTileId: LocalId, status: "open" | "claimed"): LocalJob {
  return {
    id: `job-${index}`,
    kind: "haul",
    purpose: "stockpile",
    status,
    priority: 25,
    targetTileId,
    sourceTileId,
    resource: "wood",
    amount: 1,
    progress: 0,
    workRequired: 1,
    createdTick: 0,
    createdByCommandId: "stress-setup"
  };
}

function countDeliveredWood(state: LocalGameState, stockpileTileIds: readonly LocalId[]): number {
  return stockpileTileIds.reduce((sum, tileId) => {
    const resource = state.tiles[tileId]?.resource;
    return sum + (resource?.kind === "wood" ? resource.amount : 0);
  }, 0);
}

function countRemainingWood(state: LocalGameState, resourceTileIds: readonly LocalId[]): number {
  return resourceTileIds.reduce((sum, tileId) => {
    const resource = state.tiles[tileId]?.resource;
    return sum + (resource?.kind === "wood" ? resource.amount : 0);
  }, 0);
}

function countJobs(state: LocalGameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of Object.values(state.jobs)) {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }
  return counts;
}

function countPawns(state: LocalGameState): Record<string, number> {
  const counts: Record<string, number> = { total: 0, idle: 0, active: 0, carrying: 0 };
  for (const pawn of Object.values(state.pawns)) {
    counts.total += 1;
    if (pawn.action) {
      counts.active += 1;
    } else {
      counts.idle += 1;
    }
    if (pawn.inventory) {
      counts.carrying += 1;
    }
  }
  return counts;
}

function parseOptions(args: readonly string[]): StressOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      values.set(match[1], match[2]);
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.set(key, next);
        index += 1;
      } else {
        values.set(key, "true");
      }
    }
  }
  const count = parsePositiveInt(optionValue(values, "count"), 1000);
  const mode = parseMode(optionValue(values, "mode"));
  return {
    count,
    ticks: parsePositiveInt(optionValue(values, "ticks"), mode === "active-adjacent" ? 2 : 3),
    mode,
    seed: optionValue(values, "seed") ?? "local-stress",
    cols: parsePositiveInt(optionValue(values, "cols"), Math.max(1, Math.ceil(Math.sqrt(count)))),
    validate: optionValue(values, "validate") !== "false"
  };
}

function optionValue(values: ReadonlyMap<string, string>, key: string): string | undefined {
  return values.get(key) ?? process.env[`npm_config_${key.replaceAll("-", "_")}`];
}

function parseMode(value: string | undefined): StressMode {
  if (value === "derived" || value === "precreated" || value === "active-adjacent") {
    return value;
  }
  return "derived";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

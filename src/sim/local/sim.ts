import { applyDueLocalCommands, emitLocalEvent, mergeResource, nextLocalId, queueLocalCommand, resourceAmount } from "./commands";
import { localManhattan, localTileId, nextLocalStepToward } from "./grid";
import type {
  LocalCommand,
  LocalGameState,
  LocalId,
  LocalJob,
  LocalPawn,
  LocalResourceKind,
  LocalResourceStack,
  LocalTile,
  LocalTileKind
} from "./types";

interface CreateLocalGameOptions {
  seed?: string;
  width?: number;
  height?: number;
}

interface LocalWorkIndex {
  pawns: LocalPawn[];
  tiles: LocalTile[];
  openJobs: LocalJob[];
  openJobCursor: number;
  openJobsNeedSort: boolean;
  reservationsByTarget: Set<LocalId>;
  stockpileReservationTileIds: Set<LocalId>;
  reservationIdsByJob: Map<LocalId, LocalId[]>;
  activeHaulSourceIds: Set<LocalId>;
  activeStockpileHaulTargetIds: Set<LocalId>;
  buildJobsByTarget: Map<LocalId, LocalJob[]>;
  buildMaterialIncomingByTargetResource: Map<string, number>;
  resourceTilesByKind: Map<LocalResourceKind, LocalTile[]>;
  stockpileTargetsByKind: Map<LocalResourceKind, LocalTile[]>;
  stockpileTargetCursorByKind: Map<LocalResourceKind, number>;
}

export function createLocalGameState(options: CreateLocalGameOptions = {}): LocalGameState {
  const width = options.width ?? 16;
  const height = options.height ?? 16;
  const state: LocalGameState = {
    version: 1,
    seed: options.seed ?? "local-game",
    tick: 0,
    width,
    height,
    nextId: 1,
    tiles: {},
    pawns: {},
    jobs: {},
    reservations: {},
    stockpiles: {},
    commandQueue: [],
    events: []
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const kind: LocalTileKind = edge ? "stone" : "grass";
      state.tiles[localTileId(x, y)] = {
        id: localTileId(x, y),
        x,
        y,
        kind,
        walkable: true
      };
    }
  }

  return state;
}

export function createLocalGameplayFixture(seed = "local-fixture"): LocalGameState {
  const state = createLocalGameState({ seed, width: 16, height: 16 });
  const pawn: LocalPawn = {
    id: "pawn-builder",
    name: "Mira",
    x: 2,
    y: 2,
    skills: { hauling: 2, construction: 3, mining: 1 },
    xp: { hauling: 0, construction: 0, mining: 0 }
  };
  state.pawns[pawn.id] = pawn;

  const woodTile = state.tiles[localTileId(4, 2)];
  woodTile.resource = { kind: "wood", amount: 6 };
  const stoneTile = state.tiles[localTileId(5, 2)];
  stoneTile.resource = { kind: "stone", amount: 4 };
  state.tiles[localTileId(9, 7)].kind = "tree";
  state.tiles[localTileId(9, 7)].walkable = true;
  state.tiles[localTileId(10, 7)].kind = "ore";
  state.tiles[localTileId(10, 7)].walkable = true;
  return state;
}

export function submitLocalCommand(state: LocalGameState, command: LocalCommand): void {
  queueLocalCommand(state, command);
}

export function tickLocalGame(state: LocalGameState, steps = 1): void {
  for (let step = 0; step < steps; step += 1) {
    applyDueLocalCommands(state);
    const index = createLocalWorkIndex(state);
    refreshDerivedLocalJobs(state, index);
    sortOpenJobsForClaiming(index);
    for (const pawn of index.pawns) {
      tickPawn(state, pawn, index);
    }
    state.tick += 1;
  }
}

export function validateLocalGameState(state: LocalGameState): string[] {
  const issues: string[] = [];
  for (const tile of Object.values(state.tiles)) {
    if (tile.stockpileZoneId && !state.stockpiles[tile.stockpileZoneId]) {
      issues.push(`${tile.id} points at missing stockpile ${tile.stockpileZoneId}.`);
    }
    if (tile.resource && tile.resource.amount < 0) {
      issues.push(`${tile.id} has negative ${tile.resource.kind}.`);
    }
    if (tile.blueprint) {
      for (const delivered of tile.blueprint.delivered) {
        if (delivered.amount < 0) {
          issues.push(`${tile.id} has negative delivered ${delivered.kind}.`);
        }
      }
    }
  }

  for (const pawn of Object.values(state.pawns)) {
    if (pawn.x < 0 || pawn.y < 0 || pawn.x >= state.width || pawn.y >= state.height) {
      issues.push(`${pawn.name} is out of bounds at ${pawn.x},${pawn.y}.`);
    }
    if (pawn.inventory && pawn.inventory.amount < 0) {
      issues.push(`${pawn.name} has negative carried ${pawn.inventory.kind}.`);
    }
  }

  const reservationTargets = new Set<LocalId>();
  for (const reservation of Object.values(state.reservations)) {
    if (reservationTargets.has(reservation.targetId)) {
      issues.push(`Reservation target ${reservation.targetId} is double-booked.`);
    }
    reservationTargets.add(reservation.targetId);
    if (!state.jobs[reservation.jobId]) {
      issues.push(`Reservation ${reservation.id} points at missing job ${reservation.jobId}.`);
    }
    if (!state.pawns[reservation.pawnId]) {
      issues.push(`Reservation ${reservation.id} points at missing pawn ${reservation.pawnId}.`);
    }
  }

  for (const job of Object.values(state.jobs)) {
    if (job.status === "claimed" && !job.claimedBy) {
      issues.push(`${job.id} is claimed without claimedBy.`);
    }
    if (job.status !== "claimed" && job.claimedBy) {
      issues.push(`${job.id} has claimedBy while ${job.status}.`);
    }
    if (!state.tiles[job.targetTileId]) {
      issues.push(`${job.id} points at missing target ${job.targetTileId}.`);
    }
    if (job.amount !== undefined && job.amount < 0) {
      issues.push(`${job.id} has negative amount.`);
    }
  }

  for (const stockpile of Object.values(state.stockpiles)) {
    if (stockpile.tileIds.length === 0) {
      issues.push(`${stockpile.id} has no tiles.`);
    }
    if (stockpile.accepts.length === 0) {
      issues.push(`${stockpile.id} accepts no resources.`);
    }
    for (const tileId of stockpile.tileIds) {
      const tile = state.tiles[tileId];
      if (!tile) {
        issues.push(`${stockpile.id} points at missing tile ${tileId}.`);
      } else if (tile.stockpileZoneId !== stockpile.id) {
        issues.push(`${stockpile.id} tile ${tileId} does not point back at the zone.`);
      }
    }
  }

  return issues;
}

export function summarizeLocalGameState(state: LocalGameState): string {
  const completed = Object.values(state.tiles)
    .filter((tile) => tile.building)
    .map((tile) => `${tile.id}:${tile.building?.kind}`)
    .sort()
    .join(",");
  const pawns = sortedPawns(state)
    .map((pawn) => `${pawn.id}@${pawn.x},${pawn.y}:h${pawn.xp.hauling}:c${pawn.xp.construction}:m${pawn.xp.mining}`)
    .join("|");
  const openJobs = Object.values(state.jobs)
    .filter((job) => job.status !== "done")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((job) => `${job.id}:${job.kind}:${job.status}`)
    .join(",");
  const stockpiles = Object.values(state.stockpiles)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((stockpile) => `${stockpile.id}:${stockpile.tileIds.length}:${stockpile.accepts.join("+")}`)
    .join(",");
  return `tick=${state.tick};buildings=${completed};pawns=${pawns};jobs=${openJobs};stockpiles=${stockpiles};events=${state.events.length}`;
}

function createLocalWorkIndex(state: LocalGameState): LocalWorkIndex {
  const index: LocalWorkIndex = {
    pawns: sortedPawns(state),
    tiles: Object.values(state.tiles).sort(compareLocalTiles),
    openJobs: Object.values(state.jobs)
      .filter((job) => job.status === "open")
      .sort(compareLocalJobsForClaiming),
    openJobCursor: 0,
    openJobsNeedSort: false,
    reservationsByTarget: new Set<LocalId>(),
    stockpileReservationTileIds: new Set<LocalId>(),
    reservationIdsByJob: new Map<LocalId, LocalId[]>(),
    activeHaulSourceIds: new Set<LocalId>(),
    activeStockpileHaulTargetIds: new Set<LocalId>(),
    buildJobsByTarget: new Map<LocalId, LocalJob[]>(),
    buildMaterialIncomingByTargetResource: new Map<string, number>(),
    resourceTilesByKind: new Map<LocalResourceKind, LocalTile[]>(),
    stockpileTargetsByKind: new Map<LocalResourceKind, LocalTile[]>(),
    stockpileTargetCursorByKind: new Map<LocalResourceKind, number>()
  };

  for (const reservation of Object.values(state.reservations)) {
    index.reservationsByTarget.add(reservation.targetId);
    addMapValue(index.reservationIdsByJob, reservation.jobId, reservation.id);
    const tileId = tileIdForReservationTarget(reservation.targetId);
    if (tileId) {
      index.stockpileReservationTileIds.add(tileId);
    }
  }

  for (const job of Object.values(state.jobs)) {
    if (job.kind === "build" && job.status !== "done") {
      addMapValue(index.buildJobsByTarget, job.targetTileId, job);
    }
    if (job.kind === "haul" && job.status !== "done" && job.status !== "blocked") {
      if (job.sourceTileId) {
        index.activeHaulSourceIds.add(job.sourceTileId);
      }
      if (job.purpose === "stockpile") {
        index.activeStockpileHaulTargetIds.add(job.targetTileId);
      }
      if (job.purpose === "build-material" && job.resource) {
        const key = targetResourceKey(job.targetTileId, job.resource);
        index.buildMaterialIncomingByTargetResource.set(key, (index.buildMaterialIncomingByTargetResource.get(key) ?? 0) + (job.amount ?? 0));
      }
    }
  }

  for (const tile of index.tiles) {
    if (tile.resource && tile.resource.amount > 0) {
      addMapValue(index.resourceTilesByKind, tile.resource.kind, tile);
    }
  }

  for (const zone of Object.values(state.stockpiles).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))) {
    for (const kind of zone.accepts) {
      for (const tileId of zone.tileIds) {
        const tile = state.tiles[tileId];
        if (!tile || !tile.walkable || tile.blueprint || tile.building || (tile.resource && tile.resource.kind !== kind)) {
          continue;
        }
        addMapValue(index.stockpileTargetsByKind, kind, tile);
      }
    }
  }

  for (const [kind, tiles] of index.stockpileTargetsByKind) {
    tiles.sort((left, right) => {
      const leftZone = left.stockpileZoneId ? state.stockpiles[left.stockpileZoneId] : undefined;
      const rightZone = right.stockpileZoneId ? state.stockpiles[right.stockpileZoneId] : undefined;
      return (rightZone?.priority ?? 0) - (leftZone?.priority ?? 0) || compareLocalTiles(left, right);
    });
    index.stockpileTargetCursorByKind.set(kind, 0);
  }

  return index;
}

function refreshDerivedLocalJobs(state: LocalGameState, index: LocalWorkIndex): void {
  for (const tile of index.tiles) {
    const blueprint = tile.blueprint;
    if (!blueprint || blueprint.status === "complete") {
      continue;
    }

    const buildJob = index.buildJobsByTarget.get(tile.id)?.[0];
    if (buildJob) {
      buildJob.status = blueprintNeedsMaterials(blueprint.required, blueprint.delivered) ? "blocked" : buildJob.status === "claimed" ? "claimed" : "open";
      if (buildJob.status === "open" && !index.openJobs.includes(buildJob)) {
        addOpenJobToIndex(index, buildJob);
      }
    }

    for (const required of blueprint.required) {
      const delivered = resourceAmount(blueprint.delivered, required.kind);
      const incoming = index.buildMaterialIncomingByTargetResource.get(targetResourceKey(tile.id, required.kind)) ?? 0;
      const missing = required.amount - delivered - incoming;
      if (missing <= 0) {
        continue;
      }
      const source = nearestResourceTile(tile, required.kind, index);
      if (!source) {
        continue;
      }
      const amount = Math.min(missing, source.resource?.amount ?? 0);
      if (amount <= 0) {
        continue;
      }
      const job: LocalJob = {
        id: nextLocalId(state, "job"),
        kind: "haul",
        purpose: "build-material",
        status: "open",
        priority: 70,
        targetTileId: tile.id,
        sourceTileId: source.id,
        resource: required.kind,
        amount,
        progress: 0,
        workRequired: 1,
        createdTick: state.tick,
        createdByCommandId: blueprint.placedByCommandId
      };
      state.jobs[job.id] = job;
      addJobToWorkIndex(index, job);
      emitLocalEvent(state, {
        kind: "haul.created",
        subjectId: job.id,
        message: `Created haul job for ${amount} ${required.kind}.`,
        data: { sourceTileId: source.id, targetTileId: tile.id }
      });
    }
  }

  refreshStockpileHaulJobs(state, index);
}

function tickPawn(state: LocalGameState, pawn: LocalPawn, index: LocalWorkIndex): void {
  if (!pawn.action) {
    assignNextLocalJob(state, pawn, index);
  }
  if (!pawn.action) {
    return;
  }

  if (pawn.action.kind === "haul") {
    advanceHaul(state, pawn, index);
  } else if (pawn.action.kind === "build") {
    advanceBuild(state, pawn, index);
  } else {
    advanceMine(state, pawn, index);
  }
}

function assignNextLocalJob(state: LocalGameState, pawn: LocalPawn, index: LocalWorkIndex): void {
  sortOpenJobsForClaiming(index);
  let job: LocalJob | undefined;
  while (index.openJobCursor < index.openJobs.length) {
    const candidate = index.openJobs[index.openJobCursor];
    index.openJobCursor += 1;
    if (candidate.status === "open" && canPawnClaimJob(state, pawn, candidate, index)) {
      job = candidate;
      break;
    }
  }
  if (!job) {
    return;
  }

  job.status = "claimed";
  job.claimedBy = pawn.id;
  reserveJobTargets(state, pawn, job, index);
  if (job.kind === "haul") {
    pawn.action = {
      kind: "haul",
      jobId: job.id,
      stage: "to-source",
      sourceTileId: job.sourceTileId ?? job.targetTileId,
      targetTileId: job.targetTileId,
      resource: job.resource ?? "wood",
      amount: job.amount ?? 1
    };
  } else if (job.kind === "build") {
    pawn.action = { kind: "build", jobId: job.id, targetTileId: job.targetTileId };
  } else {
    pawn.action = { kind: "mine", jobId: job.id, targetTileId: job.targetTileId };
  }
  emitLocalEvent(state, {
    kind: "job.claimed",
    subjectId: job.id,
    message: `${pawn.name} claimed ${job.kind}.`,
    data: { pawnId: pawn.id, targetTileId: job.targetTileId }
  });
}

function canPawnClaimJob(state: LocalGameState, pawn: LocalPawn, job: LocalJob, index: LocalWorkIndex): boolean {
  if (pawn.action || pawn.inventory) {
    return false;
  }
  if (job.kind === "haul") {
    const source = job.sourceTileId ? state.tiles[job.sourceTileId] : undefined;
    const target = state.tiles[job.targetTileId];
    const resource = job.resource;
    if (!source?.resource || !target || !resource || source.resource.kind !== resource || source.resource.amount <= 0) {
      return false;
    }
    const targetCanAccept = job.purpose === "stockpile" ? canAcceptStockpileDrop(state, target.id, resource) : Boolean(target.blueprint);
    const targetReserved = job.purpose === "stockpile" ? reservationForStockpileTarget(index, target.id) : reservationForTarget(index, `${target.id}:${resource}`);
    return Boolean(targetCanAccept && !reservationForTarget(index, source.id) && !targetReserved);
  }
  if (job.kind === "build") {
    const target = state.tiles[job.targetTileId];
    return Boolean(target?.blueprint && !blueprintNeedsMaterials(target.blueprint.required, target.blueprint.delivered) && !reservationForTarget(index, target.id));
  }
  const target = state.tiles[job.targetTileId];
  return Boolean(target && (target.kind === "tree" || target.kind === "ore" || target.kind === "stone") && !reservationForTarget(index, target.id));
}

function advanceHaul(state: LocalGameState, pawn: LocalPawn, index: LocalWorkIndex): void {
  const action = pawn.action;
  if (!action || action.kind !== "haul") {
    return;
  }

  if (action.stage === "to-source") {
    if (!movePawnTowardTile(state, pawn, action.sourceTileId)) {
      const source = state.tiles[action.sourceTileId];
      const available = source?.resource?.kind === action.resource ? source.resource.amount : 0;
      const amount = Math.min(action.amount, available);
      if (!source?.resource || amount <= 0) {
        blockJob(state, action.jobId, "missing-resource", index);
        pawn.action = undefined;
        return;
      }
      source.resource.amount -= amount;
      if (source.resource.amount === 0) {
        delete source.resource;
      }
      pawn.inventory = { kind: action.resource, amount };
      pawn.xp.hauling += 1;
      action.stage = "to-target";
      emitLocalEvent(state, {
        kind: "resource.picked-up",
        subjectId: pawn.id,
        message: `${pawn.name} picked up ${amount} ${action.resource}.`,
        data: { jobId: action.jobId, sourceTileId: action.sourceTileId }
      });
    }
    return;
  }

  if (movePawnTowardTile(state, pawn, action.targetTileId)) {
    return;
  }

  const target = state.tiles[action.targetTileId];
  const carried = pawn.inventory;
  const job = state.jobs[action.jobId];
  if (!job || !target || !carried || carried.kind !== action.resource) {
    blockJob(state, action.jobId, "missing-haul-target", index);
    pawn.action = undefined;
    pawn.inventory = undefined;
    return;
  }
  const isStockpileHaul = job.purpose === "stockpile";
  if (isStockpileHaul && canAcceptStockpileDrop(state, target.id, carried.kind)) {
    target.resource = mergeResource(target.resource, carried);
  } else if (!isStockpileHaul && target.blueprint) {
    addDeliveredResource(target.blueprint.delivered, carried);
  } else {
    blockJob(state, action.jobId, "invalid-haul-target", index);
    pawn.action = undefined;
    pawn.inventory = undefined;
    return;
  }
  pawn.inventory = undefined;
  completeJob(state, action.jobId, index);
  pawn.action = undefined;
  emitLocalEvent(state, {
    kind: isStockpileHaul ? "resource.stockpiled" : "resource.delivered",
    subjectId: target.id,
    message: `${pawn.name} delivered ${carried.amount} ${carried.kind}.`,
    data: { jobId: action.jobId, targetTileId: target.id }
  });
}

function advanceBuild(state: LocalGameState, pawn: LocalPawn, index: LocalWorkIndex): void {
  const action = pawn.action;
  if (!action || action.kind !== "build") {
    return;
  }
  if (movePawnTowardTile(state, pawn, action.targetTileId)) {
    return;
  }

  const tile = state.tiles[action.targetTileId];
  const blueprint = tile?.blueprint;
  if (!tile || !blueprint || blueprintNeedsMaterials(blueprint.required, blueprint.delivered)) {
    blockJob(state, action.jobId, "build-not-ready", index);
    pawn.action = undefined;
    return;
  }

  blueprint.status = "under-construction";
  const work = 1 + pawn.skills.construction * 0.25;
  blueprint.buildProgress += work;
  pawn.xp.construction += 1;
  if (blueprint.buildProgress < blueprint.buildWorkRequired) {
    return;
  }

  blueprint.status = "complete";
  tile.kind = "constructed";
  tile.walkable = true;
  tile.building = {
    id: nextLocalId(state, "building"),
    kind: blueprint.kind,
    completedTick: state.tick
  };
  completeJob(state, action.jobId, index);
  pawn.action = undefined;
  emitLocalEvent(state, {
    kind: "build.complete",
    subjectId: tile.id,
    message: `${pawn.name} completed ${blueprint.kind}.`,
    data: { jobId: action.jobId, buildingId: tile.building.id }
  });
}

function advanceMine(state: LocalGameState, pawn: LocalPawn, index: LocalWorkIndex): void {
  const action = pawn.action;
  if (!action || action.kind !== "mine") {
    return;
  }
  if (movePawnTowardTile(state, pawn, action.targetTileId)) {
    return;
  }

  const job = state.jobs[action.jobId];
  const tile = state.tiles[action.targetTileId];
  if (!job || !tile || (tile.kind !== "tree" && tile.kind !== "ore" && tile.kind !== "stone")) {
    blockJob(state, action.jobId, "mine-not-ready", index);
    pawn.action = undefined;
    return;
  }

  job.progress += 1 + pawn.skills.mining * 0.2;
  pawn.xp.mining += 1;
  if (job.progress < job.workRequired) {
    return;
  }

  const resource: LocalResourceKind = tile.kind === "tree" ? "wood" : tile.kind === "ore" ? "ore" : "stone";
  tile.kind = "grass";
  tile.resource = { kind: resource, amount: tile.resource?.kind === resource ? tile.resource.amount + 2 : 2 };
  completeJob(state, action.jobId, index);
  pawn.action = undefined;
  emitLocalEvent(state, {
    kind: "mine.complete",
    subjectId: tile.id,
    message: `${pawn.name} harvested ${resource}.`,
    data: { jobId: action.jobId, resource }
  });
}

function movePawnTowardTile(state: LocalGameState, pawn: LocalPawn, tileId: LocalId): boolean {
  const target = state.tiles[tileId];
  if (!target || (pawn.x === target.x && pawn.y === target.y)) {
    return false;
  }
  const next = nextLocalStepToward(state, { x: pawn.x, y: pawn.y }, { x: target.x, y: target.y });
  if (!next) {
    return false;
  }
  pawn.x = next.x;
  pawn.y = next.y;
  emitLocalEvent(state, {
    kind: "pawn.moved",
    subjectId: pawn.id,
    message: `${pawn.name} moved to ${pawn.x},${pawn.y}.`,
    data: { targetTileId: tileId }
  });
  return true;
}

function reserveJobTargets(state: LocalGameState, pawn: LocalPawn, job: LocalJob, index: LocalWorkIndex): void {
  const targets = job.kind === "haul" ? [job.sourceTileId, `${job.targetTileId}:${job.resource}`] : [job.targetTileId];
  for (const targetId of targets) {
    if (!targetId) {
      continue;
    }
    const reservation = {
      id: nextLocalId(state, "reservation"),
      jobId: job.id,
      pawnId: pawn.id,
      targetKind: job.kind === "haul" && targetId === job.sourceTileId ? ("resource" as const) : ("tile" as const),
      targetId
    };
    state.reservations[reservation.id] = reservation;
    index.reservationsByTarget.add(reservation.targetId);
    addMapValue(index.reservationIdsByJob, reservation.jobId, reservation.id);
    const tileId = tileIdForReservationTarget(reservation.targetId);
    if (tileId) {
      index.stockpileReservationTileIds.add(tileId);
    }
  }
}

function releaseJobReservations(state: LocalGameState, jobId: LocalId, index?: LocalWorkIndex): void {
  const reservationIds = index?.reservationIdsByJob.get(jobId);
  if (index && reservationIds) {
    for (const reservationId of reservationIds) {
      const reservation = state.reservations[reservationId];
      if (!reservation) {
        continue;
      }
      delete state.reservations[reservationId];
      index.reservationsByTarget.delete(reservation.targetId);
      const tileId = tileIdForReservationTarget(reservation.targetId);
      if (tileId) {
        index.stockpileReservationTileIds.delete(tileId);
      }
    }
    index.reservationIdsByJob.delete(jobId);
    return;
  }

  for (const reservation of Object.values(state.reservations)) {
    if (reservation.jobId !== jobId) {
      continue;
    }
    delete state.reservations[reservation.id];
    index?.reservationsByTarget.delete(reservation.targetId);
    const tileId = tileIdForReservationTarget(reservation.targetId);
    if (tileId) {
      index?.stockpileReservationTileIds.delete(tileId);
    }
  }
}

function completeJob(state: LocalGameState, jobId: LocalId, index?: LocalWorkIndex): void {
  const job = state.jobs[jobId];
  if (!job) {
    return;
  }
  job.status = "done";
  job.claimedBy = undefined;
  releaseJobFromIndex(index, job);
  releaseJobReservations(state, jobId, index);
  emitLocalEvent(state, {
    kind: "job.done",
    subjectId: job.id,
    message: `${job.kind} job completed.`,
    data: { targetTileId: job.targetTileId }
  });
}

function blockJob(state: LocalGameState, jobId: LocalId, reason: string, index?: LocalWorkIndex): void {
  const job = state.jobs[jobId];
  if (!job) {
    return;
  }
  job.status = "blocked";
  job.claimedBy = undefined;
  releaseJobFromIndex(index, job);
  releaseJobReservations(state, jobId, index);
  emitLocalEvent(state, {
    kind: "job.blocked",
    subjectId: job.id,
    message: `${job.kind} job blocked.`,
    data: { reason, targetTileId: job.targetTileId }
  });
}

function nearestResourceTile(target: LocalTile, kind: LocalResourceKind, index: LocalWorkIndex): LocalTile | undefined {
  let best: LocalTile | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of index.resourceTilesByKind.get(kind) ?? []) {
    if (!tile.resource || tile.resource.amount <= 0 || reservationForTarget(index, tile.id) || index.activeHaulSourceIds.has(tile.id)) {
      continue;
    }
    const distance = localManhattan(tile, target);
    if (distance < bestDistance || (distance === bestDistance && tile.id.localeCompare(best?.id ?? "") < 0)) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

function refreshStockpileHaulJobs(state: LocalGameState, index: LocalWorkIndex): void {
  for (const source of index.tiles) {
    if (!source.walkable || !source.resource || source.resource.amount <= 0 || isResourceInAcceptingStockpile(state, source)) {
      continue;
    }
    if (reservationForTarget(index, source.id) || index.activeHaulSourceIds.has(source.id)) {
      continue;
    }
    const target = nearestStockpileTileForResource(state, source, source.resource.kind, index);
    if (!target) {
      continue;
    }
    const job: LocalJob = {
      id: nextLocalId(state, "job"),
      kind: "haul",
      purpose: "stockpile",
      status: "open",
      priority: 25,
      targetTileId: target.id,
      sourceTileId: source.id,
      resource: source.resource.kind,
      amount: source.resource.amount,
      progress: 0,
      workRequired: 1,
      createdTick: state.tick,
      createdByCommandId: target.stockpileZoneId ? state.stockpiles[target.stockpileZoneId]?.createdByCommandId : undefined
    };
    state.jobs[job.id] = job;
    addJobToWorkIndex(index, job);
    emitLocalEvent(state, {
      kind: "haul.created",
      subjectId: job.id,
      message: `Created stockpile haul job for ${job.amount ?? 0} ${job.resource}.`,
      data: { purpose: "stockpile", sourceTileId: source.id, targetTileId: target.id }
    });
  }
}

function isResourceInAcceptingStockpile(state: LocalGameState, tile: LocalTile): boolean {
  const zone = tile.stockpileZoneId ? state.stockpiles[tile.stockpileZoneId] : undefined;
  return Boolean(tile.resource && zone?.accepts.includes(tile.resource.kind));
}

function nearestStockpileTileForResource(state: LocalGameState, source: LocalTile, kind: LocalResourceKind, index: LocalWorkIndex): LocalTile | undefined {
  const candidates = index.stockpileTargetsByKind.get(kind) ?? [];
  let cursor = index.stockpileTargetCursorByKind.get(kind) ?? 0;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidateIndex = (cursor + offset) % candidates.length;
    const tile = candidates[candidateIndex];
    if (
      tile.id === source.id ||
      !canAcceptStockpileDrop(state, tile.id, kind) ||
      reservationForStockpileTarget(index, tile.id) ||
      index.activeStockpileHaulTargetIds.has(tile.id)
    ) {
      continue;
    }
    index.stockpileTargetCursorByKind.set(kind, candidateIndex + 1);
    return tile;
  }
  index.stockpileTargetCursorByKind.set(kind, cursor);
  return undefined;
}

function canAcceptStockpileDrop(state: LocalGameState, tileId: LocalId, kind: LocalResourceKind | undefined): boolean {
  if (!kind) {
    return false;
  }
  const tile = state.tiles[tileId];
  const zone = tile?.stockpileZoneId ? state.stockpiles[tile.stockpileZoneId] : undefined;
  return Boolean(tile && tile.walkable && !tile.blueprint && !tile.building && zone?.accepts.includes(kind) && (!tile.resource || tile.resource.kind === kind));
}

function reservationForTarget(index: LocalWorkIndex, targetId: LocalId): boolean {
  return index.reservationsByTarget.has(targetId);
}

function reservationForStockpileTarget(index: LocalWorkIndex, tileId: LocalId): boolean {
  return index.stockpileReservationTileIds.has(tileId);
}

function blueprintNeedsMaterials(required: readonly LocalResourceStack[], delivered: readonly LocalResourceStack[]): boolean {
  return required.some((stack) => resourceAmount(delivered, stack.kind) < stack.amount);
}

function addDeliveredResource(delivered: LocalResourceStack[], stack: LocalResourceStack): void {
  const existing = delivered.find((item) => item.kind === stack.kind);
  if (existing) {
    existing.amount += stack.amount;
  } else {
    delivered.push({ ...stack });
  }
}

function sortedPawns(state: LocalGameState): LocalPawn[] {
  return Object.values(state.pawns).sort((left, right) => left.id.localeCompare(right.id));
}

function compareLocalTiles(left: LocalTile, right: LocalTile): number {
  return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);
}

function compareLocalJobsForClaiming(left: LocalJob, right: LocalJob): number {
  return right.priority - left.priority || left.createdTick - right.createdTick || compareLocalIdsNaturally(left.id, right.id);
}

function compareLocalIdsNaturally(left: LocalId, right: LocalId): number {
  const leftMatch = /^(.*?)-(\d+)$/.exec(left);
  const rightMatch = /^(.*?)-(\d+)$/.exec(right);
  if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
    return Number(leftMatch[2]) - Number(rightMatch[2]);
  }
  return left.localeCompare(right);
}

function addOpenJobToIndex(index: LocalWorkIndex, job: LocalJob): void {
  index.openJobs.push(job);
  index.openJobsNeedSort = true;
}

function sortOpenJobsForClaiming(index: LocalWorkIndex): void {
  if (!index.openJobsNeedSort) {
    return;
  }
  index.openJobs.sort(compareLocalJobsForClaiming);
  index.openJobsNeedSort = false;
}

function addJobToWorkIndex(index: LocalWorkIndex, job: LocalJob): void {
  if (job.status === "open") {
    addOpenJobToIndex(index, job);
  }
  if (job.kind === "build" && job.status !== "done") {
    addMapValue(index.buildJobsByTarget, job.targetTileId, job);
  }
  if (job.kind === "haul" && job.status !== "done" && job.status !== "blocked") {
    if (job.sourceTileId) {
      index.activeHaulSourceIds.add(job.sourceTileId);
    }
    if (job.purpose === "stockpile") {
      index.activeStockpileHaulTargetIds.add(job.targetTileId);
    }
    if (job.purpose === "build-material" && job.resource) {
      const key = targetResourceKey(job.targetTileId, job.resource);
      index.buildMaterialIncomingByTargetResource.set(key, (index.buildMaterialIncomingByTargetResource.get(key) ?? 0) + (job.amount ?? 0));
    }
  }
}

function releaseJobFromIndex(index: LocalWorkIndex | undefined, job: LocalJob): void {
  if (!index || job.kind !== "haul") {
    return;
  }
  if (job.sourceTileId) {
    index.activeHaulSourceIds.delete(job.sourceTileId);
  }
  if (job.purpose === "stockpile") {
    index.activeStockpileHaulTargetIds.delete(job.targetTileId);
  }
  if (job.purpose === "build-material" && job.resource) {
    const key = targetResourceKey(job.targetTileId, job.resource);
    const remaining = (index.buildMaterialIncomingByTargetResource.get(key) ?? 0) - (job.amount ?? 0);
    if (remaining > 0) {
      index.buildMaterialIncomingByTargetResource.set(key, remaining);
    } else {
      index.buildMaterialIncomingByTargetResource.delete(key);
    }
  }
}

function targetResourceKey(targetTileId: LocalId, kind: LocalResourceKind): string {
  return `${targetTileId}:${kind}`;
}

function tileIdForReservationTarget(targetId: LocalId): LocalId | undefined {
  const parts = targetId.split(":");
  if (parts.length < 3 || parts[0] !== "local") {
    return undefined;
  }
  return parts.slice(0, 3).join(":");
}

function addMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

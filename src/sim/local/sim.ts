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
    refreshDerivedLocalJobs(state);
    for (const pawn of sortedPawns(state)) {
      tickPawn(state, pawn);
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

function refreshDerivedLocalJobs(state: LocalGameState): void {
  for (const tile of Object.values(state.tiles)) {
    const blueprint = tile.blueprint;
    if (!blueprint || blueprint.status === "complete") {
      continue;
    }

    const buildJob = Object.values(state.jobs).find((job) => job.kind === "build" && job.targetTileId === tile.id && job.status !== "done");
    if (buildJob) {
      buildJob.status = blueprintNeedsMaterials(blueprint.required, blueprint.delivered) ? "blocked" : buildJob.status === "claimed" ? "claimed" : "open";
    }

    for (const required of blueprint.required) {
      const delivered = resourceAmount(blueprint.delivered, required.kind);
      const incoming = Object.values(state.jobs)
        .filter((job) => job.kind === "haul" && job.targetTileId === tile.id && job.resource === required.kind && job.status !== "done")
        .reduce((sum, job) => sum + (job.amount ?? 0), 0);
      const missing = required.amount - delivered - incoming;
      if (missing <= 0) {
        continue;
      }
      const source = nearestResourceTile(state, tile, required.kind);
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
      emitLocalEvent(state, {
        kind: "haul.created",
        subjectId: job.id,
        message: `Created haul job for ${amount} ${required.kind}.`,
        data: { sourceTileId: source.id, targetTileId: tile.id }
      });
    }
  }

  refreshStockpileHaulJobs(state);
}

function tickPawn(state: LocalGameState, pawn: LocalPawn): void {
  if (!pawn.action) {
    assignNextLocalJob(state, pawn);
  }
  if (!pawn.action) {
    return;
  }

  if (pawn.action.kind === "haul") {
    advanceHaul(state, pawn);
  } else if (pawn.action.kind === "build") {
    advanceBuild(state, pawn);
  } else {
    advanceMine(state, pawn);
  }
}

function assignNextLocalJob(state: LocalGameState, pawn: LocalPawn): void {
  const job = Object.values(state.jobs)
    .filter((candidate) => candidate.status === "open" && canPawnClaimJob(state, pawn, candidate))
    .sort((left, right) => right.priority - left.priority || left.createdTick - right.createdTick || left.id.localeCompare(right.id))[0];
  if (!job) {
    return;
  }

  job.status = "claimed";
  job.claimedBy = pawn.id;
  reserveJobTargets(state, pawn, job);
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

function canPawnClaimJob(state: LocalGameState, pawn: LocalPawn, job: LocalJob): boolean {
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
    const targetReserved = job.purpose === "stockpile" ? reservationForStockpileTarget(state, target.id) : reservationForTarget(state, `${target.id}:${resource}`);
    return Boolean(targetCanAccept && !reservationForTarget(state, source.id) && !targetReserved);
  }
  if (job.kind === "build") {
    const target = state.tiles[job.targetTileId];
    return Boolean(target?.blueprint && !blueprintNeedsMaterials(target.blueprint.required, target.blueprint.delivered) && !reservationForTarget(state, target.id));
  }
  const target = state.tiles[job.targetTileId];
  return Boolean(target && (target.kind === "tree" || target.kind === "ore" || target.kind === "stone") && !reservationForTarget(state, target.id));
}

function advanceHaul(state: LocalGameState, pawn: LocalPawn): void {
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
        blockJob(state, action.jobId, "missing-resource");
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
    blockJob(state, action.jobId, "missing-haul-target");
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
    blockJob(state, action.jobId, "invalid-haul-target");
    pawn.action = undefined;
    pawn.inventory = undefined;
    return;
  }
  pawn.inventory = undefined;
  completeJob(state, action.jobId);
  pawn.action = undefined;
  emitLocalEvent(state, {
    kind: isStockpileHaul ? "resource.stockpiled" : "resource.delivered",
    subjectId: target.id,
    message: `${pawn.name} delivered ${carried.amount} ${carried.kind}.`,
    data: { jobId: action.jobId, targetTileId: target.id }
  });
}

function advanceBuild(state: LocalGameState, pawn: LocalPawn): void {
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
    blockJob(state, action.jobId, "build-not-ready");
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
  completeJob(state, action.jobId);
  pawn.action = undefined;
  emitLocalEvent(state, {
    kind: "build.complete",
    subjectId: tile.id,
    message: `${pawn.name} completed ${blueprint.kind}.`,
    data: { jobId: action.jobId, buildingId: tile.building.id }
  });
}

function advanceMine(state: LocalGameState, pawn: LocalPawn): void {
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
    blockJob(state, action.jobId, "mine-not-ready");
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
  completeJob(state, action.jobId);
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

function reserveJobTargets(state: LocalGameState, pawn: LocalPawn, job: LocalJob): void {
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
  }
}

function releaseJobReservations(state: LocalGameState, jobId: LocalId): void {
  for (const reservation of Object.values(state.reservations)) {
    if (reservation.jobId === jobId) {
      delete state.reservations[reservation.id];
    }
  }
}

function completeJob(state: LocalGameState, jobId: LocalId): void {
  const job = state.jobs[jobId];
  if (!job) {
    return;
  }
  job.status = "done";
  job.claimedBy = undefined;
  releaseJobReservations(state, jobId);
  emitLocalEvent(state, {
    kind: "job.done",
    subjectId: job.id,
    message: `${job.kind} job completed.`,
    data: { targetTileId: job.targetTileId }
  });
}

function blockJob(state: LocalGameState, jobId: LocalId, reason: string): void {
  const job = state.jobs[jobId];
  if (!job) {
    return;
  }
  job.status = "blocked";
  job.claimedBy = undefined;
  releaseJobReservations(state, jobId);
  emitLocalEvent(state, {
    kind: "job.blocked",
    subjectId: job.id,
    message: `${job.kind} job blocked.`,
    data: { reason, targetTileId: job.targetTileId }
  });
}

function nearestResourceTile(state: LocalGameState, target: LocalTile, kind: LocalResourceKind): LocalTile | undefined {
  return Object.values(state.tiles)
    .filter((tile) => tile.resource?.kind === kind && tile.resource.amount > 0 && !reservationForTarget(state, tile.id))
    .sort((left, right) => localManhattan(left, target) - localManhattan(right, target) || left.id.localeCompare(right.id))[0];
}

function refreshStockpileHaulJobs(state: LocalGameState): void {
  for (const source of Object.values(state.tiles).sort(compareLocalTiles)) {
    if (!source.walkable || !source.resource || source.resource.amount <= 0 || isResourceInAcceptingStockpile(state, source)) {
      continue;
    }
    if (reservationForTarget(state, source.id) || existingOpenHaulFromSource(state, source.id)) {
      continue;
    }
    const target = nearestStockpileTileForResource(state, source, source.resource.kind);
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
    emitLocalEvent(state, {
      kind: "haul.created",
      subjectId: job.id,
      message: `Created stockpile haul job for ${job.amount ?? 0} ${job.resource}.`,
      data: { purpose: "stockpile", sourceTileId: source.id, targetTileId: target.id }
    });
  }
}

function existingOpenHaulFromSource(state: LocalGameState, sourceTileId: LocalId): boolean {
  return Object.values(state.jobs).some((job) => job.kind === "haul" && job.sourceTileId === sourceTileId && job.status !== "done" && job.status !== "blocked");
}

function existingOpenHaulToTarget(state: LocalGameState, targetTileId: LocalId): boolean {
  return Object.values(state.jobs).some((job) => job.kind === "haul" && job.targetTileId === targetTileId && job.status !== "done" && job.status !== "blocked");
}

function isResourceInAcceptingStockpile(state: LocalGameState, tile: LocalTile): boolean {
  const zone = tile.stockpileZoneId ? state.stockpiles[tile.stockpileZoneId] : undefined;
  return Boolean(tile.resource && zone?.accepts.includes(tile.resource.kind));
}

function nearestStockpileTileForResource(state: LocalGameState, source: LocalTile, kind: LocalResourceKind): LocalTile | undefined {
  const candidates: { zoneId: LocalId; zonePriority: number; tile: LocalTile }[] = [];
  for (const zone of Object.values(state.stockpiles)) {
    if (!zone.accepts.includes(kind)) {
      continue;
    }
    for (const tileId of zone.tileIds) {
      const tile = state.tiles[tileId];
      if (
        !tile ||
        tile.id === source.id ||
        !tile.walkable ||
        tile.blueprint ||
        tile.building ||
        (tile.resource && tile.resource.kind !== kind) ||
        reservationForStockpileTarget(state, tile.id) ||
        existingOpenHaulToTarget(state, tile.id)
      ) {
        continue;
      }
      candidates.push({ zoneId: zone.id, zonePriority: zone.priority, tile });
    }
  }
  return candidates.sort(
    (left, right) =>
      right.zonePriority - left.zonePriority ||
      localManhattan(left.tile, source) - localManhattan(right.tile, source) ||
      left.tile.id.localeCompare(right.tile.id) ||
      left.zoneId.localeCompare(right.zoneId)
  )[0]?.tile;
}

function canAcceptStockpileDrop(state: LocalGameState, tileId: LocalId, kind: LocalResourceKind | undefined): boolean {
  if (!kind) {
    return false;
  }
  const tile = state.tiles[tileId];
  const zone = tile?.stockpileZoneId ? state.stockpiles[tile.stockpileZoneId] : undefined;
  return Boolean(tile && tile.walkable && !tile.blueprint && !tile.building && zone?.accepts.includes(kind) && (!tile.resource || tile.resource.kind === kind));
}

function reservationForTarget(state: LocalGameState, targetId: LocalId): boolean {
  return Object.values(state.reservations).some((reservation) => reservation.targetId === targetId);
}

function reservationForStockpileTarget(state: LocalGameState, tileId: LocalId): boolean {
  return Object.values(state.reservations).some((reservation) => reservation.targetId === tileId || reservation.targetId.startsWith(`${tileId}:`));
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

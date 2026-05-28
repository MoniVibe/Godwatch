import type {
  LocalAction,
  LocalBlueprint,
  LocalBuilding,
  LocalCoord,
  LocalEvent,
  LocalGameState,
  LocalId,
  LocalJob,
  LocalJobKind,
  LocalPawn,
  LocalResourceKind,
  LocalResourceStack,
  LocalStockpileZone,
  LocalTile,
  LocalTileKind
} from "./types";

export interface LocalSnapshotOptions {
  readonly recentEventLimit?: number;
}

export interface LocalGameSnapshot {
  readonly version: 1;
  readonly seed: string;
  readonly tick: number;
  readonly dimensions: LocalSnapshotDimensions;
  readonly tiles: readonly LocalTileSnapshot[];
  readonly pawns: readonly LocalPawnSnapshot[];
  readonly jobs: readonly LocalJobSnapshot[];
  readonly reservations: readonly LocalReservationSnapshot[];
  readonly stockpiles: readonly LocalStockpileSnapshot[];
  readonly recentEvents: readonly LocalEventSnapshot[];
}

export interface LocalSnapshotDimensions {
  readonly width: number;
  readonly height: number;
}

export interface LocalTileSnapshot {
  readonly id: LocalId;
  readonly coord: LocalCoord;
  readonly kind: LocalTileKind;
  readonly walkable: boolean;
  readonly contents: LocalTileContentsSnapshot;
  readonly flags: LocalTileFlagsSnapshot;
  readonly resource?: LocalResourceStack;
  readonly blueprint?: LocalBlueprintSnapshot;
  readonly building?: LocalBuildingSnapshot;
}

export interface LocalTileContentsSnapshot {
  readonly pawnIds: readonly LocalId[];
  readonly jobIds: readonly LocalId[];
  readonly reservationIds: readonly LocalId[];
}

export interface LocalTileFlagsSnapshot {
  readonly hasPawn: boolean;
  readonly hasJob: boolean;
  readonly hasReservation: boolean;
  readonly hasResource: boolean;
  readonly hasBlueprint: boolean;
  readonly hasBuilding: boolean;
  readonly stockpileZoneId?: LocalId;
  readonly zoneFlags: readonly LocalZoneFlagSnapshot[];
}

export type LocalZoneFlagSnapshot = "stockpile" | "home" | "forbidden" | "grow" | "medical";

export interface LocalBlueprintSnapshot {
  readonly id: LocalId;
  readonly kind: LocalBlueprint["kind"];
  readonly status: LocalBlueprint["status"];
  readonly buildProgress: number;
  readonly buildWorkRequired: number;
  readonly required: readonly LocalResourceStack[];
  readonly delivered: readonly LocalResourceStack[];
  readonly placedByCommandId: LocalId;
}

export interface LocalBuildingSnapshot {
  readonly id: LocalId;
  readonly kind: LocalBuilding["kind"];
  readonly completedTick: number;
}

export interface LocalPawnSnapshot {
  readonly id: LocalId;
  readonly name: string;
  readonly coord: LocalCoord;
  readonly skills: LocalPawn["skills"];
  readonly xp: LocalPawn["xp"];
  readonly carriedItem?: LocalResourceStack;
  readonly action?: LocalActionSnapshot;
  readonly intent: LocalIntentSnapshot;
}

export type LocalActionSnapshot =
  | {
      readonly kind: "haul";
      readonly jobId: LocalId;
      readonly stage: "to-source" | "to-target";
      readonly sourceTileId: LocalId;
      readonly targetTileId: LocalId;
      readonly resource: LocalResourceKind;
      readonly amount: number;
    }
  | {
      readonly kind: "build";
      readonly jobId: LocalId;
      readonly targetTileId: LocalId;
    }
  | {
      readonly kind: "mine";
      readonly jobId: LocalId;
      readonly targetTileId: LocalId;
    };

export interface LocalIntentSnapshot {
  readonly kind: "idle" | "moving-to-source" | "moving-to-target" | "building" | "mining";
  readonly label: string;
  readonly jobId?: LocalId;
  readonly sourceTileId?: LocalId;
  readonly targetTileId?: LocalId;
}

export interface LocalJobSnapshot {
  readonly id: LocalId;
  readonly kind: LocalJobKind;
  readonly purpose?: LocalJob["purpose"];
  readonly status: LocalJob["status"];
  readonly priority: number;
  readonly targetTileId: LocalId;
  readonly targetCoord?: LocalCoord;
  readonly sourceTileId?: LocalId;
  readonly sourceCoord?: LocalCoord;
  readonly claimedBy?: LocalId;
  readonly resource?: LocalResourceKind;
  readonly amount?: number;
  readonly progress: number;
  readonly workRequired: number;
  readonly createdTick: number;
  readonly createdByCommandId?: LocalId;
}

export interface LocalReservationSnapshot {
  readonly id: LocalId;
  readonly jobId: LocalId;
  readonly pawnId: LocalId;
  readonly targetKind: "tile" | "resource";
  readonly targetId: LocalId;
}

export interface LocalStockpileSnapshot {
  readonly id: LocalId;
  readonly name: string;
  readonly tileIds: readonly LocalId[];
  readonly accepts: readonly LocalResourceKind[];
  readonly priority: number;
  readonly createdByCommandId: LocalId;
  readonly stored: readonly LocalResourceStack[];
}

export interface LocalEventSnapshot {
  readonly tick: number;
  readonly kind: string;
  readonly subjectId: LocalId;
  readonly message: string;
  readonly data?: Readonly<Record<string, string | number | boolean | undefined>>;
}

export function createLocalGameSnapshot(state: LocalGameState, options: LocalSnapshotOptions = {}): LocalGameSnapshot {
  const pawnIdsByTile = new Map<LocalId, LocalId[]>();
  const jobIdsByTile = new Map<LocalId, LocalId[]>();
  const reservationIdsByTile = new Map<LocalId, LocalId[]>();

  for (const pawn of sortedValues(state.pawns)) {
    addToBucket(pawnIdsByTile, tileIdForPawn(pawn), pawn.id);
  }

  for (const job of sortedValues(state.jobs)) {
    addToBucket(jobIdsByTile, job.targetTileId, job.id);
    if (job.sourceTileId) {
      addToBucket(jobIdsByTile, job.sourceTileId, job.id);
    }
  }

  for (const reservation of sortedValues(state.reservations)) {
    addToBucket(reservationIdsByTile, tileIdForReservation(reservation.targetId), reservation.id);
  }

  return {
    version: 1,
    seed: state.seed,
    tick: state.tick,
    dimensions: {
      width: state.width,
      height: state.height
    },
    tiles: sortedValues(state.tiles).map((tile) => snapshotTile(tile, pawnIdsByTile, jobIdsByTile, reservationIdsByTile)),
    pawns: sortedValues(state.pawns).map(snapshotPawn),
    jobs: sortedValues(state.jobs).map((job) => snapshotJob(state, job)),
    reservations: sortedValues(state.reservations).map((reservation) => ({ ...reservation })),
    stockpiles: sortedValues(state.stockpiles).map((stockpile) => snapshotStockpile(state, stockpile)),
    recentEvents: snapshotRecentEvents(state.events, options.recentEventLimit ?? 40)
  };
}

function snapshotTile(
  tile: LocalTile,
  pawnIdsByTile: ReadonlyMap<LocalId, readonly LocalId[]>,
  jobIdsByTile: ReadonlyMap<LocalId, readonly LocalId[]>,
  reservationIdsByTile: ReadonlyMap<LocalId, readonly LocalId[]>
): LocalTileSnapshot {
  const pawnIds = sortedCopy(pawnIdsByTile.get(tile.id) ?? []);
  const jobIds = sortedCopy(jobIdsByTile.get(tile.id) ?? []);
  const reservationIds = sortedCopy(reservationIdsByTile.get(tile.id) ?? []);

  return {
    id: tile.id,
    coord: { x: tile.x, y: tile.y },
    kind: tile.kind,
    walkable: tile.walkable,
    contents: {
      pawnIds,
      jobIds,
      reservationIds
    },
    flags: {
      hasPawn: pawnIds.length > 0,
      hasJob: jobIds.length > 0,
      hasReservation: reservationIds.length > 0,
      hasResource: Boolean(tile.resource),
      hasBlueprint: Boolean(tile.blueprint),
      hasBuilding: Boolean(tile.building),
      stockpileZoneId: tile.stockpileZoneId,
      zoneFlags: tile.stockpileZoneId ? ["stockpile"] : []
    },
    resource: tile.resource ? { ...tile.resource } : undefined,
    blueprint: tile.blueprint ? snapshotBlueprint(tile.blueprint) : undefined,
    building: tile.building ? { ...tile.building } : undefined
  };
}

function snapshotBlueprint(blueprint: LocalBlueprint): LocalBlueprintSnapshot {
  return {
    id: blueprint.id,
    kind: blueprint.kind,
    status: blueprint.status,
    buildProgress: blueprint.buildProgress,
    buildWorkRequired: blueprint.buildWorkRequired,
    required: cloneResourceStacks(blueprint.required),
    delivered: cloneResourceStacks(blueprint.delivered),
    placedByCommandId: blueprint.placedByCommandId
  };
}

function snapshotPawn(pawn: LocalPawn): LocalPawnSnapshot {
  return {
    id: pawn.id,
    name: pawn.name,
    coord: { x: pawn.x, y: pawn.y },
    skills: { ...pawn.skills },
    xp: { ...pawn.xp },
    carriedItem: pawn.inventory ? { ...pawn.inventory } : undefined,
    action: pawn.action ? snapshotAction(pawn.action) : undefined,
    intent: pawnIntent(pawn.action)
  };
}

function snapshotAction(action: LocalAction): LocalActionSnapshot {
  return { ...action };
}

function pawnIntent(action: LocalAction | undefined): LocalIntentSnapshot {
  if (!action) {
    return {
      kind: "idle",
      label: "Idle"
    };
  }

  if (action.kind === "haul") {
    if (action.stage === "to-source") {
      return {
        kind: "moving-to-source",
        label: `Collect ${action.amount} ${action.resource}`,
        jobId: action.jobId,
        sourceTileId: action.sourceTileId,
        targetTileId: action.targetTileId
      };
    }
    return {
      kind: "moving-to-target",
      label: `Deliver ${action.amount} ${action.resource}`,
      jobId: action.jobId,
      sourceTileId: action.sourceTileId,
      targetTileId: action.targetTileId
    };
  }

  if (action.kind === "build") {
    return {
      kind: "building",
      label: "Build",
      jobId: action.jobId,
      targetTileId: action.targetTileId
    };
  }

  return {
    kind: "mining",
    label: "Mine",
    jobId: action.jobId,
    targetTileId: action.targetTileId
  };
}

function snapshotJob(state: LocalGameState, job: LocalJob): LocalJobSnapshot {
  return {
    id: job.id,
    kind: job.kind,
    purpose: job.purpose,
    status: job.status,
    priority: job.priority,
    targetTileId: job.targetTileId,
    targetCoord: coordForTile(state, job.targetTileId),
    sourceTileId: job.sourceTileId,
    sourceCoord: job.sourceTileId ? coordForTile(state, job.sourceTileId) : undefined,
    claimedBy: job.claimedBy,
    resource: job.resource,
    amount: job.amount,
    progress: job.progress,
    workRequired: job.workRequired,
    createdTick: job.createdTick,
    createdByCommandId: job.createdByCommandId
  };
}

function snapshotStockpile(state: LocalGameState, stockpile: LocalStockpileZone): LocalStockpileSnapshot {
  return {
    id: stockpile.id,
    name: stockpile.name,
    tileIds: sortedCopy(stockpile.tileIds),
    accepts: [...stockpile.accepts].sort(),
    priority: stockpile.priority,
    createdByCommandId: stockpile.createdByCommandId,
    stored: storedResourcesForStockpile(state, stockpile.tileIds)
  };
}

function snapshotRecentEvents(events: readonly LocalEvent[], limit: number): LocalEventSnapshot[] {
  return events.slice(Math.max(0, events.length - Math.max(0, limit))).map((event) => ({
    tick: event.tick,
    kind: event.kind,
    subjectId: event.subjectId,
    message: event.message,
    data: event.data ? { ...event.data } : undefined
  }));
}

function storedResourcesForStockpile(state: LocalGameState, tileIds: readonly LocalId[]): LocalResourceStack[] {
  const stored = new Map<LocalResourceKind, number>();
  for (const tileId of tileIds) {
    const resource = state.tiles[tileId]?.resource;
    if (resource) {
      stored.set(resource.kind, (stored.get(resource.kind) ?? 0) + resource.amount);
    }
  }
  return [...stored.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, amount]) => ({ kind, amount }));
}

function coordForTile(state: Pick<LocalGameState, "tiles">, tileId: LocalId): LocalCoord | undefined {
  const tile = state.tiles[tileId];
  return tile ? { x: tile.x, y: tile.y } : undefined;
}

function tileIdForPawn(pawn: Pick<LocalPawn, "x" | "y">): LocalId {
  return `local:${pawn.x}:${pawn.y}`;
}

function tileIdForReservation(targetId: LocalId): LocalId {
  return targetId.startsWith("local:") ? targetId.split(":").slice(0, 3).join(":") : targetId;
}

function cloneResourceStacks(stacks: readonly LocalResourceStack[]): LocalResourceStack[] {
  return stacks.map((stack) => ({ ...stack }));
}

function sortedValues<T extends { id: LocalId }>(records: Readonly<Record<LocalId, T>>): T[] {
  return Object.values(records).sort((left, right) => left.id.localeCompare(right.id));
}

function sortedCopy<T extends string>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function addToBucket(buckets: Map<LocalId, LocalId[]>, key: LocalId, value: LocalId): void {
  const bucket = buckets.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    buckets.set(key, [value]);
  }
}

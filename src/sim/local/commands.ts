import { localTileId, parseLocalTileId } from "./grid";
import type { LocalCommand, LocalEvent, LocalGameState, LocalId, LocalJob, LocalResourceStack } from "./types";

export function queueLocalCommand(state: LocalGameState, command: LocalCommand): void {
  state.commandQueue.push(command);
  state.commandQueue.sort((left, right) => left.applyAtTick - right.applyAtTick || left.id.localeCompare(right.id));
}

export function applyDueLocalCommands(state: LocalGameState): void {
  const due = state.commandQueue.filter((command) => command.applyAtTick <= state.tick);
  state.commandQueue = state.commandQueue.filter((command) => command.applyAtTick > state.tick);
  for (const command of due) {
    applyLocalCommand(state, command);
  }
}

export function emitLocalEvent(state: LocalGameState, event: Omit<LocalEvent, "tick">): void {
  state.events.push({ tick: state.tick, ...event });
}

export function nextLocalId(state: LocalGameState, prefix: string): LocalId {
  const id = `${prefix}-${state.nextId}`;
  state.nextId += 1;
  return id;
}

function applyLocalCommand(state: LocalGameState, command: LocalCommand): void {
  if (command.kind === "designate-build") {
    const tile = state.tiles[command.payload.tileId];
    if (!tile || tile.kind === "water" || tile.building || tile.blueprint) {
      emitLocalEvent(state, {
        kind: "command.rejected",
        subjectId: command.id,
        message: `Rejected build command ${command.id}.`,
        data: { reason: "invalid-build-tile", tileId: command.payload.tileId }
      });
      return;
    }

    const required = buildCost(command.payload.buildingKind);
    tile.blueprint = {
      id: nextLocalId(state, "blueprint"),
      kind: command.payload.buildingKind,
      required,
      delivered: [],
      buildProgress: 0,
      buildWorkRequired: buildWorkRequired(command.payload.buildingKind),
      status: "needs-materials",
      placedByCommandId: command.id
    };
    tile.walkable = true;

    const job: LocalJob = {
      id: nextLocalId(state, "job"),
      kind: "build",
      status: "blocked",
      priority: 50,
      targetTileId: tile.id,
      progress: 0,
      workRequired: tile.blueprint.buildWorkRequired,
      createdTick: state.tick,
      createdByCommandId: command.id
    };
    state.jobs[job.id] = job;
    emitLocalEvent(state, {
      kind: "build.designated",
      subjectId: tile.id,
      message: `Designated ${command.payload.buildingKind} at ${tile.id}.`,
      data: { commandId: command.id }
    });
    return;
  }

  if (command.kind === "designate-mine") {
    const tile = state.tiles[command.payload.tileId];
    if (!tile || (tile.kind !== "tree" && tile.kind !== "ore" && tile.kind !== "stone")) {
      emitLocalEvent(state, {
        kind: "command.rejected",
        subjectId: command.id,
        message: `Rejected mine command ${command.id}.`,
        data: { reason: "invalid-mine-tile", tileId: command.payload.tileId }
      });
      return;
    }

    const job: LocalJob = {
      id: nextLocalId(state, "job"),
      kind: "mine",
      status: "open",
      priority: 40,
      targetTileId: tile.id,
      progress: 0,
      workRequired: tile.kind === "tree" ? 5 : 8,
      createdTick: state.tick,
      createdByCommandId: command.id
    };
    state.jobs[job.id] = job;
    emitLocalEvent(state, {
      kind: "mine.designated",
      subjectId: tile.id,
      message: `Designated harvest at ${tile.id}.`,
      data: { commandId: command.id }
    });
    return;
  }

  const tile = state.tiles[command.payload.tileId];
  if (!tile || command.payload.amount <= 0) {
    emitLocalEvent(state, {
      kind: "command.rejected",
      subjectId: command.id,
      message: `Rejected resource spawn command ${command.id}.`,
      data: { reason: "invalid-resource-spawn", tileId: command.payload.tileId }
    });
    return;
  }

  tile.resource = mergeResource(tile.resource, { kind: command.payload.resource, amount: command.payload.amount });
  emitLocalEvent(state, {
    kind: "resource.spawned",
    subjectId: tile.id,
    message: `Spawned ${command.payload.amount} ${command.payload.resource} at ${tile.id}.`,
    data: { commandId: command.id, resource: command.payload.resource, amount: command.payload.amount }
  });
}

export function buildCost(kind: "hut" | "wall" | "workshop"): LocalResourceStack[] {
  if (kind === "wall") {
    return [{ kind: "stone", amount: 2 }];
  }
  if (kind === "workshop") {
    return [
      { kind: "wood", amount: 3 },
      { kind: "stone", amount: 2 },
      { kind: "tools", amount: 1 }
    ];
  }
  return [{ kind: "wood", amount: 3 }];
}

function buildWorkRequired(kind: "hut" | "wall" | "workshop"): number {
  if (kind === "wall") {
    return 6;
  }
  if (kind === "workshop") {
    return 18;
  }
  return 10;
}

export function mergeResource(existing: LocalResourceStack | undefined, incoming: LocalResourceStack): LocalResourceStack {
  if (!existing) {
    return { ...incoming };
  }
  if (existing.kind !== incoming.kind) {
    return { ...incoming };
  }
  return { kind: existing.kind, amount: existing.amount + incoming.amount };
}

export function resourceAmount(stacks: readonly LocalResourceStack[] | undefined, kind: LocalResourceStack["kind"]): number {
  return stacks?.filter((stack) => stack.kind === kind).reduce((sum, stack) => sum + stack.amount, 0) ?? 0;
}

export function setLocalTileWalkableFromKind(state: LocalGameState, tileId: LocalId): void {
  const coord = parseLocalTileId(tileId);
  const tile = coord ? state.tiles[localTileId(coord.x, coord.y)] : undefined;
  if (tile) {
    tile.walkable = tile.kind !== "water";
  }
}

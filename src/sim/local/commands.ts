import { localTileId, parseLocalTileId } from "./grid";
import type {
  LocalCommand,
  LocalEvent,
  LocalGameState,
  LocalId,
  LocalJob,
  LocalResourceKind,
  LocalResourceStack,
  LocalStockpileRectangle,
  LocalStockpileZone
} from "./types";

const allLocalResourceKinds: readonly LocalResourceKind[] = ["wood", "stone", "ore", "food", "tools"];

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
  if (command.kind === "create-stockpile-zone") {
    if (command.payload.rectangle && !isValidStockpileRectangle(command.payload.rectangle)) {
      emitLocalEvent(state, {
        kind: "command.rejected",
        subjectId: command.id,
        message: `Rejected stockpile command ${command.id}.`,
        data: { reason: "invalid-stockpile-rectangle" }
      });
      return;
    }

    const tileIds = normalizeStockpileTileIds(command.payload.tileIds, command.payload.rectangle);
    const accepts = uniqueResourceKinds(command.payload.accepts);
    const invalidTileId = tileIds.find((tileId) => {
      const tile = state.tiles[tileId];
      return !tile || tile.kind === "water" || !tile.walkable || Boolean(tile.blueprint) || Boolean(tile.building);
    });
    if (tileIds.length === 0 || accepts.length === 0 || invalidTileId) {
      emitLocalEvent(state, {
        kind: "command.rejected",
        subjectId: command.id,
        message: `Rejected stockpile command ${command.id}.`,
        data: { reason: "invalid-stockpile-zone", tileId: invalidTileId }
      });
      return;
    }
    if (command.payload.priority !== undefined && !Number.isFinite(command.payload.priority)) {
      emitLocalEvent(state, {
        kind: "command.rejected",
        subjectId: command.id,
        message: `Rejected stockpile command ${command.id}.`,
        data: { reason: "invalid-stockpile-priority" }
      });
      return;
    }

    const zone: LocalStockpileZone = {
      id: nextLocalId(state, "stockpile"),
      name: command.payload.name?.trim() || `Stockpile ${Object.keys(state.stockpiles).length + 1}`,
      tileIds,
      accepts,
      priority: Math.trunc(command.payload.priority ?? 50),
      createdByCommandId: command.id
    };
    state.stockpiles[zone.id] = zone;
    for (const tileId of tileIds) {
      const existingZoneId = state.tiles[tileId].stockpileZoneId;
      if (existingZoneId && existingZoneId !== zone.id) {
        removeTileFromStockpileZone(state, existingZoneId, tileId);
      }
      state.tiles[tileId].stockpileZoneId = zone.id;
    }
    emitLocalEvent(state, {
      kind: "stockpile.designated",
      subjectId: zone.id,
      message: `Designated stockpile ${zone.name}.`,
      data: { commandId: command.id, tiles: tileIds.length, accepts: accepts.join(",") }
    });
    return;
  }

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
      purpose: "direct",
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
      purpose: "direct",
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

function normalizeStockpileTileIds(tileIds: readonly LocalId[] | undefined, rectangle: LocalStockpileRectangle | undefined): LocalId[] {
  const normalized = new Set<LocalId>();
  for (const tileId of tileIds ?? []) {
    normalized.add(tileId);
  }
  if (rectangle) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
        normalized.add(localTileId(x, y));
      }
    }
  }
  return Array.from(normalized).sort(compareLocalTileIds);
}

function isValidStockpileRectangle(rectangle: LocalStockpileRectangle): boolean {
  return (
    Number.isInteger(rectangle.x) &&
    Number.isInteger(rectangle.y) &&
    Number.isInteger(rectangle.width) &&
    Number.isInteger(rectangle.height) &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}

function uniqueResourceKinds(kinds: readonly LocalResourceKind[] | undefined): LocalResourceKind[] {
  if (!kinds) {
    return [...allLocalResourceKinds];
  }
  return allLocalResourceKinds.filter((kind) => kinds.includes(kind));
}

function removeTileFromStockpileZone(state: LocalGameState, zoneId: LocalId, tileId: LocalId): void {
  const zone = state.stockpiles[zoneId];
  if (!zone) {
    return;
  }
  zone.tileIds = zone.tileIds.filter((candidate) => candidate !== tileId);
  if (zone.tileIds.length === 0) {
    delete state.stockpiles[zoneId];
  }
}

function compareLocalTileIds(left: LocalId, right: LocalId): number {
  const leftCoord = parseLocalTileId(left);
  const rightCoord = parseLocalTileId(right);
  if (leftCoord && rightCoord) {
    return leftCoord.y - rightCoord.y || leftCoord.x - rightCoord.x;
  }
  return left.localeCompare(right);
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

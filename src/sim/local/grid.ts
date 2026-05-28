import type { LocalCoord, LocalGameState, LocalId, LocalTile } from "./types";

export function localTileId(x: number, y: number): LocalId {
  return `local:${x}:${y}`;
}

export function parseLocalTileId(tileId: LocalId): LocalCoord | undefined {
  const parts = tileId.split(":");
  if (parts.length !== 3 || parts[0] !== "local") {
    return undefined;
  }
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return undefined;
  }
  return { x, y };
}

export function isInLocalBounds(state: Pick<LocalGameState, "width" | "height">, coord: LocalCoord): boolean {
  return Number.isInteger(coord.x) && Number.isInteger(coord.y) && coord.x >= 0 && coord.y >= 0 && coord.x < state.width && coord.y < state.height;
}

export function getLocalTile(state: Pick<LocalGameState, "tiles">, coord: LocalCoord): LocalTile | undefined {
  return state.tiles[localTileId(coord.x, coord.y)];
}

export function localManhattan(left: LocalCoord, right: LocalCoord): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

export function localNeighbors4(state: Pick<LocalGameState, "width" | "height" | "tiles">, coord: LocalCoord): LocalCoord[] {
  const candidates: LocalCoord[] = [
    { x: coord.x + 1, y: coord.y },
    { x: coord.x - 1, y: coord.y },
    { x: coord.x, y: coord.y + 1 },
    { x: coord.x, y: coord.y - 1 }
  ];
  return candidates.filter((candidate) => {
    const tile = getLocalTile(state, candidate);
    return tile && isInLocalBounds(state, candidate) && tile.walkable;
  });
}

export function nextLocalStepToward(state: Pick<LocalGameState, "width" | "height" | "tiles">, from: LocalCoord, to: LocalCoord): LocalCoord | undefined {
  if (from.x === to.x && from.y === to.y) {
    return from;
  }

  const startKey = localTileId(from.x, from.y);
  const targetKey = localTileId(to.x, to.y);
  const queue: LocalCoord[] = [from];
  const previous = new Map<LocalId, LocalId | undefined>([[startKey, undefined]]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const neighbor of localNeighbors4(state, current)) {
      const key = localTileId(neighbor.x, neighbor.y);
      if (previous.has(key)) {
        continue;
      }
      previous.set(key, localTileId(current.x, current.y));
      if (key === targetKey) {
        let cursor = key;
        let before = previous.get(cursor);
        while (before && before !== startKey) {
          cursor = before;
          before = previous.get(cursor);
        }
        return parseLocalTileId(cursor);
      }
      queue.push(neighbor);
    }
  }

  return undefined;
}

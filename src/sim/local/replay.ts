import { submitLocalCommand, tickLocalGame } from "./sim";
import type { LocalCommand, LocalGameState } from "./types";

export interface LocalReplayResult {
  state: LocalGameState;
  checksum: string;
}

export function cloneLocalGameState(state: LocalGameState): LocalGameState {
  return JSON.parse(JSON.stringify(state)) as LocalGameState;
}

export function replayLocalCommands(initialState: LocalGameState, commands: readonly LocalCommand[], ticks: number): LocalReplayResult {
  const state = cloneLocalGameState(initialState);
  for (const command of [...commands].sort(compareLocalCommands)) {
    submitLocalCommand(state, cloneCommand(command));
  }
  tickLocalGame(state, ticks);
  return {
    state,
    checksum: checksumLocalGameState(state)
  };
}

export function checksumLocalGameState(state: LocalGameState): string {
  return stableStringify({
    version: state.version,
    seed: state.seed,
    tick: state.tick,
    width: state.width,
    height: state.height,
    nextId: state.nextId,
    tiles: state.tiles,
    pawns: state.pawns,
    jobs: state.jobs,
    reservations: state.reservations,
    stockpiles: state.stockpiles,
    commandQueue: state.commandQueue,
    events: state.events
  });
}

function compareLocalCommands(left: LocalCommand, right: LocalCommand): number {
  return left.applyAtTick - right.applyAtTick || left.issuedTick - right.issuedTick || left.playerId.localeCompare(right.playerId) || left.id.localeCompare(right.id);
}

function cloneCommand(command: LocalCommand): LocalCommand {
  return JSON.parse(JSON.stringify(command)) as LocalCommand;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

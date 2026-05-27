import { makeId } from "../core/math";
import type { ChronicleEvent, Id, World } from "../types";

const eventLimit = 260;

export function event(
  world: World,
  kind: ChronicleEvent["kind"],
  severity: ChronicleEvent["severity"],
  text: string,
  actorIds: Id[] = [],
  factionIds: Id[] = [],
  locationId?: Id
): void {
  world.events.unshift({
    id: makeId("event", world.tick * 1000 + world.events.length),
    tick: world.tick,
    day: world.day,
    kind,
    severity,
    actorIds,
    factionIds,
    locationId,
    text
  });
  if (world.events.length > eventLimit) {
    world.events.length = eventLimit;
  }
}

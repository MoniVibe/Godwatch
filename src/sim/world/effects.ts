import { clamp, makeId } from "../core/math";
import type { Id, LingeringEffect, MediumLayer, World } from "../types";

export type LingeringEffectInput = Omit<LingeringEffect, "id" | "progress" | "remainingTicks"> & {
  id?: Id;
  progress?: number;
  remainingTicks?: number;
};

function nextEffectId(world: World): Id {
  return makeId("effect", world.tick * 1000 + Object.keys(world.lingeringEffects ?? {}).length);
}

export function addLingeringEffect(world: World, input: LingeringEffectInput): LingeringEffect {
  world.lingeringEffects ??= {};
  const durationTicks = Math.max(1, Math.round(input.durationTicks));
  const effect: LingeringEffect = {
    ...input,
    id: input.id ?? nextEffectId(world),
    progress: clamp(input.progress ?? 0, 0, 1),
    durationTicks,
    remainingTicks: Math.max(1, Math.round(input.remainingTicks ?? durationTicks))
  };
  world.lingeringEffects[effect.id] = effect;
  return effect;
}

export function addLocationPulse(
  world: World,
  locationId: Id,
  name: string,
  color: string,
  tags: string[],
  durationTicks = 6,
  radius = 24,
  layer: MediumLayer = "surface"
): void {
  const settlement = world.settlements[locationId];
  if (!settlement) {
    return;
  }
  addLingeringEffect(world, {
    kind: "impact",
    name,
    layer,
    locationId,
    x: settlement.x,
    y: settlement.y,
    durationTicks,
    radius,
    intensity: 64,
    color,
    actorIds: [],
    factionIds: [settlement.factionId],
    tags
  });
}

export function addRouteTrail(world: World, routeId: Id, progress: number, name: string, color: string, actorIds: Id[], durationTicks = 5): void {
  const route = world.planet.routes[routeId];
  const origin = route ? world.settlements[route.fromId] : undefined;
  const target = route ? world.settlements[route.toId] : undefined;
  if (!route || !origin || !target) {
    return;
  }
  const t = clamp(progress, 0, 1);
  addLingeringEffect(world, {
    kind: "trail",
    name,
    layer: "surface",
    routeId,
    originLocationId: origin.id,
    targetLocationId: target.id,
    x: origin.x + (target.x - origin.x) * t,
    y: origin.y + (target.y - origin.y) * t,
    targetX: target.x,
    targetY: target.y,
    durationTicks,
    radius: 12,
    intensity: 42,
    color,
    actorIds,
    factionIds: [],
    tags: ["travel", "motion", route.topography, route.elevationBand]
  });
}

export function addCombatEffect(world: World, locationId: Id, input: Pick<LingeringEffectInput, "kind" | "name" | "color" | "radius" | "intensity" | "actorIds" | "factionIds" | "tags">): void {
  const settlement = world.settlements[locationId];
  if (!settlement) {
    return;
  }
  const offset = Object.keys(world.lingeringEffects ?? {}).length;
  const angle = (offset * 2.399963229728653) % (Math.PI * 2);
  addLingeringEffect(world, {
    ...input,
    layer: "surface",
    locationId,
    x: clamp(settlement.x + Math.cos(angle) * 0.035, 0.02, 0.98),
    y: clamp(settlement.y + Math.sin(angle) * 0.03, 0.02, 0.98),
    durationTicks: input.kind === "projectile" ? 4 : input.kind === "charge" ? 5 : 8
  });
}

export function updateLingeringEffects(world: World): void {
  world.lingeringEffects ??= {};
  for (const effect of Object.values(world.lingeringEffects)) {
    effect.remainingTicks -= 1;
    effect.progress = clamp(1 - effect.remainingTicks / effect.durationTicks, 0, 1);
    if (effect.kind === "projectile" || effect.kind === "charge") {
      effect.x = effect.targetX === undefined ? effect.x : effect.x + (effect.targetX - effect.x) * 0.42;
      effect.y = effect.targetY === undefined ? effect.y : effect.y + (effect.targetY - effect.y) * 0.42;
    }
    if (effect.remainingTicks <= 0) {
      delete world.lingeringEffects[effect.id];
    }
  }
}

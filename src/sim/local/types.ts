export type LocalId = string;

export type LocalResourceKind = "wood" | "stone" | "ore" | "food" | "tools";

export interface LocalCoord {
  x: number;
  y: number;
}

export type LocalTileKind = "soil" | "grass" | "stone" | "tree" | "ore" | "water" | "constructed";

export type LocalBuildingKind = "hut" | "wall" | "workshop";

export interface LocalResourceStack {
  kind: LocalResourceKind;
  amount: number;
}

export interface LocalStockpileRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocalBlueprint {
  id: LocalId;
  kind: LocalBuildingKind;
  required: LocalResourceStack[];
  delivered: LocalResourceStack[];
  buildProgress: number;
  buildWorkRequired: number;
  status: "needs-materials" | "under-construction" | "complete";
  placedByCommandId: LocalId;
}

export interface LocalBuilding {
  id: LocalId;
  kind: LocalBuildingKind;
  completedTick: number;
}

export interface LocalStockpileZone {
  id: LocalId;
  name: string;
  tileIds: LocalId[];
  accepts: LocalResourceKind[];
  priority: number;
  createdByCommandId: LocalId;
}

export interface LocalTile {
  id: LocalId;
  x: number;
  y: number;
  kind: LocalTileKind;
  walkable: boolean;
  resource?: LocalResourceStack;
  blueprint?: LocalBlueprint;
  building?: LocalBuilding;
  stockpileZoneId?: LocalId;
}

export interface LocalSkills {
  hauling: number;
  construction: number;
  mining: number;
}

export interface LocalSkillXp {
  hauling: number;
  construction: number;
  mining: number;
}

export type LocalAction =
  | {
      kind: "haul";
      jobId: LocalId;
      stage: "to-source" | "to-target";
      sourceTileId: LocalId;
      targetTileId: LocalId;
      resource: LocalResourceKind;
      amount: number;
    }
  | {
      kind: "build";
      jobId: LocalId;
      targetTileId: LocalId;
    }
  | {
      kind: "mine";
      jobId: LocalId;
      targetTileId: LocalId;
    };

export interface LocalPawn {
  id: LocalId;
  name: string;
  x: number;
  y: number;
  inventory?: LocalResourceStack;
  skills: LocalSkills;
  xp: LocalSkillXp;
  action?: LocalAction;
}

export type LocalJobKind = "haul" | "build" | "mine";

export interface LocalJob {
  id: LocalId;
  kind: LocalJobKind;
  purpose?: "build-material" | "stockpile" | "direct";
  status: "open" | "claimed" | "done" | "blocked";
  priority: number;
  targetTileId: LocalId;
  sourceTileId?: LocalId;
  claimedBy?: LocalId;
  resource?: LocalResourceKind;
  amount?: number;
  progress: number;
  workRequired: number;
  createdTick: number;
  createdByCommandId?: LocalId;
}

export interface LocalReservation {
  id: LocalId;
  jobId: LocalId;
  pawnId: LocalId;
  targetKind: "tile" | "resource";
  targetId: LocalId;
}

export type LocalCommand =
  | {
      id: LocalId;
      playerId: LocalId;
      issuedTick: number;
      applyAtTick: number;
      kind: "designate-build";
      payload: {
        tileId: LocalId;
        buildingKind: LocalBuildingKind;
      };
    }
  | {
      id: LocalId;
      playerId: LocalId;
      issuedTick: number;
      applyAtTick: number;
      kind: "designate-mine";
      payload: {
        tileId: LocalId;
      };
    }
  | {
      id: LocalId;
      playerId: LocalId;
      issuedTick: number;
      applyAtTick: number;
      kind: "spawn-resource";
      payload: {
        tileId: LocalId;
        resource: LocalResourceKind;
        amount: number;
      };
    }
  | {
      id: LocalId;
      playerId: LocalId;
      issuedTick: number;
      applyAtTick: number;
      kind: "create-stockpile-zone";
      payload: {
        name?: string;
        tileIds?: LocalId[];
        rectangle?: LocalStockpileRectangle;
        accepts?: LocalResourceKind[];
        priority?: number;
      };
    };

export interface LocalEvent {
  tick: number;
  kind: string;
  subjectId: LocalId;
  message: string;
  data?: Record<string, string | number | boolean | undefined>;
}

export interface LocalGameState {
  version: 1;
  seed: string;
  tick: number;
  width: number;
  height: number;
  nextId: number;
  tiles: Record<LocalId, LocalTile>;
  pawns: Record<LocalId, LocalPawn>;
  jobs: Record<LocalId, LocalJob>;
  reservations: Record<LocalId, LocalReservation>;
  stockpiles: Record<LocalId, LocalStockpileZone>;
  commandQueue: LocalCommand[];
  events: LocalEvent[];
}

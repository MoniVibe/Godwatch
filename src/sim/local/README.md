# Local Gameplay Kernel

This folder is the new RimWorld-like foundation track. It is intentionally separate from the current planet visualization work.

The local sim stores semantic state only:

- square tile coordinates, never pixels
- serializable player commands with `issuedTick` and `applyAtTick`
- deterministic tick advancement
- pawn-owned labor through jobs and reservations
- command-created stockpile zones where loose resources can be hauled
- read-only local snapshots for clients, renderers, telemetry, and replay tools
- domain events for renderers, telemetry, replay, and eventual networking

Multiplayer readiness comes from making the server or host authoritative over commands and ticks. Clients should submit commands, receive snapshots/events, and interpolate visuals without deciding movement, hauling, construction, mining, combat, or resource mutation.

Near-term expansion path:

1. Add more pawn needs and job kinds.
2. Add hauling policies, forbidden zones, and richer stockpile filters.
3. Add combat and projectiles as events between tile positions.
4. Add save/load and replay checks for local state.
5. Wire a renderer to snapshots from this kernel instead of reading or mutating state directly.

`snapshot.ts` is the read-only sync/render contract for this kernel. It copies local truth into deterministic arrays of tiles, pawns, jobs, reservations, and recent events so a UI, replay viewer, or multiplayer client can render and interpolate without holding mutable references into `LocalGameState`.

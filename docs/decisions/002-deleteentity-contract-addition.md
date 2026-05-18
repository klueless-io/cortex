# ADR 002 — `deleteEntity` added to StructuredStore interface

**Status**: Accepted (retroactive)
**Date**: 2026-05-18
**Decider**: David Cruwys (AppyDave)

## Context

During KyberBot's adoption of module #2 (`entity-graph.ts`), the dual-write wrapper needed to mirror local entity deletions to Arcana. The `StructuredStore` interface in `arcana-contracts` had `upsertEntity` and `getEntity` but no `deleteEntity` counterpart.

The original architectural design in `~/dev/ad/brains/kybernesis/arcana-spec.md` §10 lists `deleteMemory` as a lifecycle op but no entity-deletion equivalent.

## Decision

**Added `deleteEntity(id: string): Promise<void>` to the `StructuredStore` interface** as part of commit `17c3f48`.

## Rationale

The omission was a real gap in the spec, not a deliberate design choice:

- **Symmetry**: `deleteMemory` exists; `deleteEntity` is the natural counterpart for any complete data model that allows entities to be merged, renamed, or pruned.
- **Cross-consumer applicability**: Both KyberBot (entity-graph cleanup, mergeEntities outcome) AND Kybernesis Brain (entity hygiene during sleep) will eventually need entity deletion. Adding it now isn't KyberBot-specific.
- **Additive contract change**: the method is required on the interface. Any current/future provider implementation gains a method to write. No existing call sites need updating (no kernel method depends on `deleteEntity` yet — it's exposed via `command.deleteEntity` which is also new).

## Procedural learning

The addition was made in the same commit as the new kernel methods, without first raising it as a decision via comms `NOTE` or ADR. This was the same procedural mistake flagged in ADR 001 (the `linkMemories → linkNodes` rename): API/contract changes triggered during demand-driven implementation should be **proposed before implemented**, even when justified.

The pattern to enforce going forward:
1. Consumer surfaces a need that implies a contract change
2. Arcana session writes a `NOTE` or `QUESTION` in comms naming the proposed change + rationale
3. Architect (David) acknowledges or pushes back
4. Implementation lands with the ADR

This ADR is being written retroactively. From here on out, ADRs precede commits for contract-level changes.

## Consequences

- `StructuredStore` interface signature is wider by one method
- All implementations (current: `createFakeStructuredStore` in arcana-testkit; future: `LibsqlStructuredStore`, `ConvexStructuredStore`, etc.) must implement `deleteEntity`
- The fake in testkit already implements it
- `command.deleteEntity` kernel method depends on this provider method

## What this is NOT

- Not an endorsement of arbitrary contract growth driven by consumer demand. The bar remains: *is this a real architectural gap that any independent reviewer would recognize, or is it a consumer-preference issue?* `deleteEntity` met the first bar.
- Not a license to skip the propose-before-implement step in the future. This ADR being retroactive is the failure mode — going forward, ADRs precede commits.

## References

- Commit: `17c3f48 feat(arcana-core): command.upsertEntity, deleteEntity, linkNodes`
- Comms exchange: `~/dev/kybernesis/.comms/arcana-kyberbot.md` 2026-05-18 13:00 → 13:25
- ADR 001 — Method renames before publish (related procedural learning)
- `~/dev/ad/brains/kybernesis/arcana-spec.md` §10 — original kernel surface (missing deleteEntity)

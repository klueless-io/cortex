# Workspace: cortex

**Purpose**: Live documentation of the Cortex build (renamed from Arcana at v2.0.0) — task progress, package graph, publish pipeline, contracts surface, and provider compliance. Updated after every significant release.

**Audience**: David (primary, scan/explore), Ian (KyberBot maintainer, consumer view), Martin (Kyber in Cloud side), future contributors.

**Mode**: documentation — surfacing structure, progress, and decisions from the active build.

**Workspace type**: single.

**Canonical source**: `SPEC.md` + `PLAN.md` + current repo state (file tree, package.json files, git log).

**Provenance tool**: Peter refreshes data files after each release. Mocha re-renders affected views. Gallery auto-regenerates.

**Brand source**: `brand-dave:brand` (AppyDave default — no Kybernesis brand yet).

**Status**: active

**Created**: 2026-05-18
**Last Updated**: 2026-05-24

## Data files

| File | Shape | Refreshed after |
|---|---|---|
| `data/01-task-progress.json` | kanban (done / active / deferred) | every release |
| `data/02-package-graph.json` | card-grid + dependency edges | when package status changes |
| `data/03-publish-pipeline.json` | data-flow (version lanes) | when publish flow advances |
| `data/04-contracts-surface.json` | matrix (schema × status, interface × status) | when contracts add/change |
| `data/05-testkit-compliance.json` | matrix (provider × compliance test) | when testkit grows |
| `data/06-kernel-methods.json` | matrix (zone × method × status × driven-by) | every kernel method implementation |

## Related workspaces

- `~/dev/ad/brains/.mochaccino/kybernesis/` — the broader Kybernesis ecosystem visualization (KyberBot + cloud + portable-cortex pattern). This Cortex workspace is the *build-side* view; that one is the *architectural* view.

# Workspace: arcana

**Purpose**: Live documentation of the Arcana build — task progress, package graph, publish pipeline, contracts surface, and provider compliance. Updated after every task closes per the SPEC.md "build-as-documented" boundary rule.

**Audience**: David (primary, scan/explore), Ian (KyberBot maintainer, consumer view), Martin (Kyber in Cloud side), future contributors.

**Mode**: documentation — surfacing structure, progress, and decisions from the active build. Doubles as the eventual studio-build-pattern artefact when Arcana ships.

**Workspace type**: single. Promote to temporal (snapshot per minor version) once v0.1.0 ships and v0.2 work begins.

**Canonical source**: `SPEC.md` + `PLAN.md` + current repo state (file tree, package.json files, CI workflow runs).

**Provenance tool**: Peter refreshes data files after each task closes. Mocha re-renders affected views. Gallery auto-regenerates.

**Brand source**: `brand-dave:brand` (AppyDave default — no Kybernesis brand yet).

**Status**: active

**Created**: 2026-05-18
**Last Updated**: 2026-05-18

## Data files

| File | Shape | Refreshed after |
|---|---|---|
| `data/01-task-progress.json` | kanban (todo / in-progress / done / deferred / v0.x) | every Tn + every v0.x kernel impl |
| `data/02-package-graph.json` | card-grid + dependency edges | when package status changes |
| `data/03-publish-pipeline.json` | data-flow (lint → typecheck → test → tag → publish) | when publish flow advances |
| `data/04-contracts-surface.json` | matrix (schema × status, interface × status) | when contracts add/change |
| `data/05-testkit-compliance.json` | matrix (provider × compliance test) | when testkit grows |
| `data/06-kernel-methods.json` | matrix (zone × method × status × driven-by) | every kernel method implementation |

## Related workspaces

- `~/dev/ad/brains/.mochaccino/kybernesis/` — the broader Kybernesis ecosystem visualization (KyberBot + cloud + portable-cortex pattern). This Arcana workspace is the *build-side* view; that one is the *architectural* view.

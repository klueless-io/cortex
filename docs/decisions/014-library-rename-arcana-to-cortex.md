# ADR 014 — Library rename: Arcana → Cortex

**Status**: Accepted
**Date**: 2026-05-23
**Decider**: David Cruwys (AppyDave)
**Driver**: KyberBot comms 2026-05-23 10:30
**Related**: ADR 007 (shape thesis — "portable cortex" pattern), ADR 011 (port-first), CHANGELOG v2.0.0

---

## Context

Two distinct Kybernesis-family projects both used the name "Arcana":

1. **`klueless-io/arcana`** (this library) — the portable knowledge-brain TypeScript SDK consumed by KyberBot and future products. Six packages under the `@kybernesis/arcana-*` npm scope.
2. **`KybernesisAI/arcana`** — Ian Doust's cloud brain service, shipping to end users at `arcana.kybernesis.ai`. A separate product with its own roadmap, brand, and architecture.

Both projects are now active. The shared name caused confusion at every level: directory names, npm imports, comms entries, brain-doc references, cross-repo discussion ("which arcana?"). Ian's product ships under that brand to end users, so the library side is the one that has to move.

The `klueless-io/arcana` README already calls the underlying design pattern "**portable cortex**". The library *is* the cortex (the brain kernel); promoting that name to the project level is honest, unambiguous, and requires no new metaphor.

## Decision

Rename the library from **Arcana** to **Cortex** across every surface that consumers see:

- **GitHub repo**: `klueless-io/arcana` → `klueless-io/cortex` (manual step, outside this sprint)
- **npm packages**: `@kybernesis/arcana-*` → `@kybernesis/cortex-*` (all six)
- **Source identifiers**:
  - Factory: `createArcana()` → `createCortex()`
  - Types: `Arcana`, `ArcanaOptions`, `ArcanaApi` → `Cortex`, `CortexOptions`, `CortexApi`
  - Logger debug strings: `'arcana.ingest.X'` → `'cortex.ingest.X'`, etc.
  - Error messages: `'arcana-core: …'` → `'cortex-core: …'`
- **Project documentation**: README.md, SPEC.md, PLAN.md, SYSTEM-HEALTH.md, new ADR 014, ADR README index
- **Mochaccino dashboards**: data + views refreshed

The rename ships as a single sprint (v2.0.0). Historical sprint plans (`docs/plans/2026-05-2X-*.md`), older ADRs (001-013), session-checkpoint reviews, and audits are **left untouched** — they are point-in-time records dated at time of writing; rewriting them would be revisionism that misleads future readers about what was actually decided when.

## Versioning

**v2.0.0 — strictly breaking.** The npm scope change (`@kybernesis/arcana-*` → `@kybernesis/cortex-*`) and the factory/type renames break every consumer that has imported anything from the library. There is exactly one consumer today — KyberBot — and they signed off on the rename in advance (comms 2026-05-23 10:30) so the breakage is coordinated.

The migration recipe for any future consumer in the wild (after npm publish):

```bash
# 1. dep names
sed -i 's|@kybernesis/arcana-|@kybernesis/cortex-|g' package.json
# 2. imports
find . -name '*.ts' -exec sed -i 's|@kybernesis/arcana-|@kybernesis/cortex-|g' {} +
# 3. factory + types
find . -name '*.ts' -exec sed -i 's/createArcana/createCortex/g; s/\bArcana\b/Cortex/g' {} +
# 4. install
npm install   # or pnpm / bun
```

## Consequences

**Positive**

- Eliminates the "which arcana?" ambiguity across all Kybernesis-family discussions, repos, comms files, and brain docs.
- Aligns the library's identity with what it actually is — the cortex (brain kernel), not a generic mystical placeholder.
- Provides a single semver-correct cutover: every consumer either uses Arcana (v1.x) or Cortex (v2.x); no half-renamed limbo.
- Lays clean ground for future Kybernesis products to depend on `@kybernesis/cortex-*` without inheriting the name conflict.

**Negative**

- Major version bump within 24 hours of v1.2.1 — visible churn, even though no consumer is functionally broken.
- KyberBot must bump deps on their `arcana-adoption` branch (one-line change, but coordination required).
- Historical docs continue referencing "Arcana" in their original form — readers diving into pre-v2.0 sprint plans or ADRs need to know that's the library's old name. The CHANGELOG v2.0.0 entry serves as the explicit pointer.

**Mitigations**

- This ADR + the CHANGELOG v2.0.0 entry are the canonical pointers explaining the rename. Anyone confused by "Arcana" references in historical docs can follow the trail back here.
- The comms file at `~/dev/kybernesis/.comms/arcana-kyberbot.md` keeps its name for continuity (the conversation history with KyberBot is real history; renaming the file would orphan ~5000 lines of context). Future comms files for other consumers can use the new naming.
- The brain-doc `~/dev/ad/brains/kybernesis/arcana-spec.md` lives outside this repo; its rename is the user's call.

## Out of scope (user-driven, sequenced AFTER this sprint ships)

1. GitHub repo rename `klueless-io/arcana` → `klueless-io/cortex` (David in GitHub settings).
2. Local working directory rename `~/dev/kybernesis/arcana` → `~/dev/kybernesis/cortex` (David on both machines; syncthing-aware).
3. `git remote set-url` after the GitHub rename.
4. `pnpm publish -r --otp <code>` of all 6 `@kybernesis/cortex-*` packages at v2.0.0.
5. KyberBot's `arcana-adoption` branch updates its deps (KyberBot side).
6. Brain-doc rename (optional, outside this repo).

## References

- KyberBot comms entry: `~/dev/kybernesis/.comms/arcana-kyberbot.md` 2026-05-23 10:30
- Sprint plan: `docs/plans/2026-05-23-rename-to-cortex.md`
- CHANGELOG: v2.0.0 entry
- README.md (post-rename): cortex-named throughout

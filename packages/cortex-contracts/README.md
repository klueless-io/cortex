# @kybernesis/arcana-contracts

Zod schemas and inferred TypeScript types for the Arcana knowledge-brain kernel.

This package is the canonical source of truth for the Arcana data model. Every Arcana provider, consumer, and downstream package validates against the schemas defined here.

## Data model

Schemas correspond to the canonical kernel surface defined in `~/dev/ad/brains/kybernesis/arcana-spec.md` §10:

- `Memory` + `Chunk` — units of stored knowledge and their text sub-pieces
- `Entity` — nouns extracted from memory text (person, company, project, place, topic)
- `Edge` — typed relationships between memories and/or entities
- `Fact` + `Contradiction` — atomic entity-attribute-value triples and detected conflicts
- `Insight` + `EntityProfile` — LLM-derived deductions and per-entity dossiers
- `AgentSelf` — agent's own identity / memory blocks

Plus the cross-cutting `Scopes` type for ARP-style multi-tenancy (`org_id`, `project_id`, `connection_id`, `source_did`, `classification`).

## Usage

```ts
import { MemorySchema, type Memory } from '@kybernesis/arcana-contracts/memory';

const memory: Memory = MemorySchema.parse(unknownInput);
```

Granular subpath imports (`/memory`, `/entity`, `/edge`, ...) are tree-shakable. The root entry point (`@kybernesis/arcana-contracts`) re-exports everything.

## Stability

Pre-alpha at v0.1.0. The data model is locked to `arcana-spec.md` §10; deferred decisions (relation vocabulary unification, ARP scoping promotion) are documented in §14 of the spec.

## License

MIT

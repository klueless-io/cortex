import { z } from 'zod';

/**
 * ARP-style scoping fields. Optional sub-tenancy vocabulary used across every
 * scope-aware entity (Memory, Entity, Fact). See cortex-spec.md §14 for the
 * open question on promoting these from KyberBot-only to first-class kernel
 * fields.
 */
export const ScopesSchema = z
  .object({
    org_id: z.string().optional(),
    project_id: z.string().optional(),
    connection_id: z.string().optional(),
    source_did: z.string().optional(),
    classification: z.string().optional(),
  })
  .strict();

export type Scopes = z.infer<typeof ScopesSchema>;

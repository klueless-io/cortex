import { z } from 'zod';

export const MemoryBlockSchema = z
  .object({
    label: z.string().min(1),
    content: z.string(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MemoryBlock = z.infer<typeof MemoryBlockSchema>;

export const MemoryBlockHistoryEntrySchema = z
  .object({
    label: z.string().min(1),
    previousContent: z.string(),
    changedAt: z.string().datetime(),
    changedBy: z.string().optional(),
  })
  .strict();
export type MemoryBlockHistoryEntry = z.infer<
  typeof MemoryBlockHistoryEntrySchema
>;

export const AgentSelfSchema = z
  .object({
    memoryBlocks: z.array(MemoryBlockSchema),
    history: z.array(MemoryBlockHistoryEntrySchema),
  })
  .strict();
export type AgentSelf = z.infer<typeof AgentSelfSchema>;

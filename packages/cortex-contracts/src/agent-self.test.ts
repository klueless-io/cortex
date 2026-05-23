import { describe, it, expect } from 'vitest';
import { AgentSelfSchema, type AgentSelf } from './agent-self.js';

describe('AgentSelfSchema', () => {
  it('round-trips an AgentSelf with blocks and history', () => {
    const sample: AgentSelf = {
      memoryBlocks: [
        {
          label: 'persona',
          content: 'I am an AI assistant.',
          updatedAt: '2026-05-18T08:00:00.000Z',
        },
        {
          label: 'objectives',
          content: 'Help the user.',
          updatedAt: '2026-05-18T08:00:00.000Z',
        },
      ],
      history: [
        {
          label: 'persona',
          previousContent: 'I am a bot.',
          changedAt: '2026-05-17T08:00:00.000Z',
          changedBy: 'system',
        },
      ],
    };
    expect(AgentSelfSchema.parse(sample)).toEqual(sample);
  });

  it('round-trips an empty AgentSelf', () => {
    const sample: AgentSelf = { memoryBlocks: [], history: [] };
    expect(AgentSelfSchema.parse(sample)).toEqual(sample);
  });
});

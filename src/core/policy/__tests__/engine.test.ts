import { describe, expect, it } from 'vitest';
import { LenientPolicyEngine } from '../engine.js';
import { ToolRegistry } from '../../tools/registry.js';

describe('LenientPolicyEngine', () => {
  it('allows valid DAG plans', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate({
      original_request: 'test',
      intent: { primary: 'test', sub_intents: [] },
      entities: [],
      sub_tasks: [
        {
          id: '001',
          description: 'search',
          thought: 'find data',
          action_type: 'tool',
          tool_or_prompt: { name: 'webSearch', params: { query: 'x' } },
          expected_output: 'urls',
          dependencies: [],
        },
      ],
      synthesis_plan: 'summarize',
      validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
      clarification_needed: false,
      clarification_query: '',
    });

    expect(decision.outcome).toBe('allow');
    expect(decision.violations).toHaveLength(0);
    expect(decision.directives.maxParallelism).toBe(5);
  });

  it('denies plans with unknown tools', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate({
      original_request: 'test',
      intent: { primary: 'test', sub_intents: [] },
      entities: [],
      sub_tasks: [
        {
          id: '001',
          description: 'unknown tool',
          thought: 'oops',
          action_type: 'tool',
          tool_or_prompt: { name: 'notRegisteredTool', params: {} },
          expected_output: 'x',
          dependencies: [],
        },
      ],
      synthesis_plan: 'summarize',
      validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
      clarification_needed: false,
      clarification_query: '',
    });

    expect(decision.outcome).toBe('deny');
    expect(decision.violations.some((violation) => violation.code === 'TOOL_NOT_FOUND')).toBe(true);
  });

  it('caps requested maxParallelism at 5', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate({
      original_request: 'test',
      intent: { primary: 'test', sub_intents: [] },
      entities: [],
      sub_tasks: [],
      synthesis_plan: 'summarize',
      validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
      clarification_needed: false,
      clarification_query: '',
    }, {
      requestedMaxParallelism: 50,
    });

    expect(decision.directives.maxParallelism).toBe(5);
  });
});

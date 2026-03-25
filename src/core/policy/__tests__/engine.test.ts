import { describe, expect, it } from 'vitest';
import { LenientPolicyEngine } from '../engine.js';
import { ToolRegistry } from '../../tools/registry.js';

function baseJob(overrides: Record<string, any> = {}): any {
  return {
    original_request: 'test',
    intent: { primary: 'test', sub_intents: [] },
    entities: [],
    sub_tasks: [],
    synthesis_plan: 'summarize',
    validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
    clarification_needed: false,
    clarification_query: '',
    ...overrides,
  };
}

describe('LenientPolicyEngine', () => {
  it('allows valid DAG plans', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob({
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
    }));

    expect(decision.outcome).toBe('allow');
    expect(decision.violations).toHaveLength(0);
    expect(decision.directives.maxParallelism).toBe(5);
    expect(decision.directives.maxExecutionTokens).toBeGreaterThan(0);
    expect(decision.directives.maxExecutionCostUsd).toBeGreaterThan(0);
  });

  it('denies plans with unknown tools', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob({
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
    }));

    expect(decision.outcome).toBe('deny');
    expect(decision.violations.some((violation) => violation.code === 'TOOL_NOT_FOUND')).toBe(true);
  });

  it('denies plans with invalid graph dependencies', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob({
      sub_tasks: [
        {
          id: '001',
          description: 'depends on missing task',
          thought: 'invalid dep',
          action_type: 'tool',
          tool_or_prompt: { name: 'webSearch', params: { query: 'x' } },
          expected_output: 'urls',
          dependencies: ['999'],
        },
      ],
    }));

    expect(decision.outcome).toBe('deny');
    expect(decision.violations.some((violation) => violation.code === 'DAG_INVALID_GRAPH')).toBe(true);
  });

  it('caps requested maxParallelism at 5', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob(), {
      requestedMaxParallelism: 50,
    });

    expect(decision.directives.maxParallelism).toBe(5);
  });

  it('requires clarification for high-risk side effects without dependencies', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob({
      sub_tasks: [
        {
          id: '001',
          description: 'send email immediately',
          thought: 'notify now',
          action_type: 'tool',
          tool_or_prompt: { name: 'sendEmail', params: { to: 'user@example.com', subject: 'x', body: 'y' } },
          expected_output: 'sent',
          dependencies: [],
        },
      ],
    }));

    expect(decision.outcome).toBe('needs_clarification');
    expect(decision.violations.some((violation) => violation.code === 'HIGH_RISK_SIDE_EFFECT_WITHOUT_DEPENDENCIES')).toBe(true);
  });

  it('caps parallelism when multiple side effects are in the same wave', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const decision = engine.evaluate(baseJob({
      sub_tasks: [
        {
          id: '001',
          description: 'write first file',
          thought: 'first write',
          action_type: 'tool',
          tool_or_prompt: { name: 'writeFile', params: { path: 'a.txt', content: 'a' } },
          expected_output: 'written',
          dependencies: [],
        },
        {
          id: '002',
          description: 'write second file',
          thought: 'second write',
          action_type: 'tool',
          tool_or_prompt: { name: 'writeFile', params: { path: 'b.txt', content: 'b' } },
          expected_output: 'written',
          dependencies: [],
        },
      ],
    }));

    expect(decision.outcome).toBe('allow');
    expect(decision.directives.maxParallelism).toBe(2);
    expect(decision.violations.some((violation) => violation.code === 'PARALLEL_SIDE_EFFECTS_LIMITED')).toBe(true);
  });

  it('denies plans that exceed hard budget limits', () => {
    const engine = new LenientPolicyEngine(new ToolRegistry(), 5);
    const manyInferenceTasks = Array.from({ length: 30 }, (_, index) => ({
      id: String(index + 1).padStart(3, '0'),
      description: `inference ${index + 1}`,
      thought: 'heavy inference',
      action_type: 'inference',
      tool_or_prompt: { name: 'inference', params: { prompt: 'analyze' } },
      expected_output: 'analysis',
      dependencies: index === 0 ? [] : [String(index).padStart(3, '0')],
    }));

    const decision = engine.evaluate(baseJob({ sub_tasks: manyInferenceTasks }));

    expect(decision.outcome).toBe('deny');
    expect(decision.violations.some((violation) => violation.code === 'BUDGET_EXCEEDS_HARD_LIMIT')).toBe(true);
  });
});

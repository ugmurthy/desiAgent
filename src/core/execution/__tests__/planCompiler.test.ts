import { describe, expect, it } from 'vitest';
import { ExecutionPlanCompiler } from '../planCompiler.js';

describe('ExecutionPlanCompiler', () => {
  it('creates deterministic waves for an acyclic graph', () => {
    const plan = ExecutionPlanCompiler.compile([
      { id: '001', dependencies: [] },
      { id: '002', dependencies: ['001'] },
      { id: '003', dependencies: ['001'] },
      { id: '004', dependencies: ['002', '003'] },
    ]);

    expect(plan.waves.map((wave) => wave.map((task) => task.id))).toEqual([
      ['001'],
      ['002', '003'],
      ['004'],
    ]);
  });

  it('accepts `none` as a placeholder dependency', () => {
    const plan = ExecutionPlanCompiler.compile([
      { id: '001', dependencies: ['none'] },
      { id: '002', dependencies: ['001'] },
    ]);

    expect(plan.waves.map((wave) => wave.map((task) => task.id))).toEqual([
      ['001'],
      ['002'],
    ]);
  });

  it('throws when dependencies are missing', () => {
    expect(() => ExecutionPlanCompiler.compile([
      { id: '001', dependencies: ['999'] },
    ])).toThrow('missing task');
  });

  it('throws on cycles with deadlock wording', () => {
    expect(() => ExecutionPlanCompiler.compile([
      { id: '001', dependencies: ['002'] },
      { id: '002', dependencies: ['001'] },
    ])).toThrow('deadlock');
  });

  it('throws on duplicate task IDs', () => {
    expect(() => ExecutionPlanCompiler.compile([
      { id: '001', dependencies: [] },
      { id: '001', dependencies: [] },
    ])).toThrow('Duplicate task id');
  });
});

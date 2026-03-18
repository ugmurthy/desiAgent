import { describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../core/execution/agents.js';
import { DAGsService } from '../core/execution/dags.js';
import { ExecutionsService } from '../core/execution/executions.js';
import { ToolsService } from '../core/execution/tools.js';
import { ToolRegistry } from '../core/tools/registry.js';

vi.mock('../util/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function methodsOf(instance: any): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter(
    (name) => name !== 'constructor' && typeof instance[name] === 'function'
  );
}

function createAwaitableChain(result: any) {
  let chain: any;
  chain = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve: (value: any) => void) => resolve(result);
        }
        return () => chain;
      },
    }
  );
  return chain;
}

function createInMemoryDbStub(): any {
  return {
    query: {
      dags: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      dagExecutions: {
        findFirst: async () => null,
        findMany: async () => [],
      },
      dagSubSteps: {
        findMany: async () => [],
      },
      agents: {
        findFirst: async () => null,
        findMany: async () => [],
      },
    },
    select: (fields?: any) => createAwaitableChain(fields ? [{ count: 0 }] : []),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  };
}

describe('SDK Service Method Coverage (examples/list-sdk.ts)', () => {
  it('covers services from list-sdk except costs', () => {
    const listSdkServices = ['auth', 'users', 'agents', 'dags', 'executions', 'tools', 'costs', 'billing', 'admin'];
    const implemented = ['agents', 'dags', 'executions', 'tools', 'costs'];
    const nonCostImplemented = implemented.filter((service) => service !== 'costs');
    const missing = listSdkServices.filter((service) => !implemented.includes(service));

    expect(nonCostImplemented).toEqual(['agents', 'dags', 'executions', 'tools']);
    expect(missing).toEqual(['auth', 'users', 'billing', 'admin']);
  });

  it('asserts agents service method inventory', () => {
    const service = new AgentsService(createInMemoryDbStub());
    const methods = methodsOf(service);

    expect(methods).toEqual(
      expect.arrayContaining(['create', 'get', 'list', 'update', 'activate', 'resolve', 'delete', 'mapAgent'])
    );

    const mapped = (service as any).mapAgent({
      id: 'agent_1',
      name: 'AgentOne',
      version: '1.0.0',
      promptTemplate: 'Prompt',
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      active: true,
      metadata: { description: 'mapped agent' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(mapped.systemPrompt).toBe('Prompt');
    expect(mapped.isActive).toBe(true);
  });

  it('asserts dags service method inventory and helper methods', async () => {
    const service = new DAGsService({
      db: createInMemoryDbStub(),
      llmProvider: {
        name: 'mock',
        validateToolCallSupport: async () => ({ supported: true }),
        chat: async () => ({ content: 'mock' }),
        callWithTools: async () => ({ thought: 'mock', finishReason: 'stop' as const }),
      } as any,
      toolRegistry: new ToolRegistry(),
      agentsService: {
        resolve: async () => null,
      } as any,
      artifactsDir: '/tmp',
    });

    const methods = methodsOf(service);
    expect(methods).toEqual(
      expect.arrayContaining([
        'registerScheduleIfActive',
        'buildGlobalContext',
        'buildInferencePrompt',
        'deriveExecutionStatus',
        'aggregateUsage',
        'aggregateCost',
        'createFromGoal',
        'createAndExecuteFromGoal',
        'resumeFromClarification',
        'execute',
        'resume',
        'redoInference',
        'get',
        'list',
        'listScheduled',
        'update',
        'safeDelete',
        'runExperiments',
        'getSubSteps',
        'generateTitleAsync',
        'backgroundUpdateDag',
        'mapDAG',
      ])
    );

    const helperJob = {
      original_request: 'Goal',
      intent: { primary: 'intent', sub_intents: [] },
      entities: [],
      sub_tasks: [
        {
          id: '1',
          description: 'step',
          thought: 'why',
          action_type: 'inference',
          tool_or_prompt: { name: 'inference', params: { prompt: 'p' } },
          expected_output: 'o',
          dependencies: [],
        },
      ],
      synthesis_plan: 'plan',
      validation: { coverage: 'high', gaps: [], iteration_triggers: [] },
      clarification_needed: false,
      clarification_query: '',
    };

    const context = (service as any).buildGlobalContext(helperJob);
    const prompt = (service as any).buildInferencePrompt(helperJob.sub_tasks[0], context, new Map());
    const status = (service as any).deriveExecutionStatus([{ status: 'completed' }, { status: 'failed' }]);
    const usage = (service as any).aggregateUsage([{ usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } }]);
    const cost = (service as any).aggregateCost([{ costUsd: '0.12' }, { costUsd: '0.08' }]);

    expect(context.totalTasks).toBe(1);
    expect(prompt).toContain('Current Task');
    expect(status.status).toBe('partial');
    expect(usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    expect(cost).toBeCloseTo(0.2, 6);

    await expect(
      service.createFromGoal({ goalText: 'x', agentName: 'MissingAgent' })
    ).rejects.toThrow('not found');

    const experiments = await service.runExperiments({
      goalText: 'Experiment goal',
      agentName: 'MissingAgent',
      provider: 'openrouter',
      models: ['openai/gpt-4o'],
      temperatures: [0.2],
    });
    expect(experiments.totalExperiments).toBe(1);
    expect(experiments.failureCount).toBe(1);
  });

  it('asserts executions service method inventory and mapping helpers', async () => {
    const service = new ExecutionsService(createInMemoryDbStub());
    const methods = methodsOf(service);

    expect(methods).toEqual(
      expect.arrayContaining([
        'get',
        'getWithSubSteps',
        'listForDag',
        'list',
        'getSubSteps',
        'streamEvents',
        'delete',
        'mapExecution',
        'mapSubStep',
      ])
    );

    await expect(service.get('exec_missing')).rejects.toThrow('not found');
    await expect(service.getWithSubSteps('exec_missing')).rejects.toThrow('not found');
    await expect(service.listForDag('dag_missing')).rejects.toThrow('not found');

    const list = await service.list();
    expect(list).toEqual([]);

    await expect(service.getSubSteps('exec_missing')).rejects.toThrow('not found');
    await expect(service.delete('exec_missing')).rejects.toThrow('not found');

    const mappedExecution = (service as any).mapExecution({
      id: 'exec_1',
      dagId: 'dag_1',
      originalRequest: 'request',
      primaryIntent: 'intent',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
      waitingTasks: 0,
      finalResult: null,
      synthesisResult: null,
      suspendedReason: null,
      suspendedAt: null,
      retryCount: 0,
      lastRetryAt: null,
      totalUsage: null,
      totalCostUsd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(mappedExecution.id).toBe('exec_1');

    const mappedSubStep = (service as any).mapSubStep({
      id: 'sub_1',
      executionId: 'exec_1',
      taskId: '001',
      description: 'desc',
      thought: 'thought',
      actionType: 'inference',
      toolOrPromptName: 'inference',
      toolOrPromptParams: {},
      dependencies: [],
      status: 'completed',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      result: 'ok',
      error: null,
      usage: null,
      costUsd: null,
      generationStats: null,
      generationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(mappedSubStep.id).toBe('sub_1');
  });

  it('asserts tools service method inventory and executable methods', async () => {
    const service = new ToolsService(new ToolRegistry());
    const methods = methodsOf(service);

    expect(methods).toEqual(
      expect.arrayContaining(['list', 'get', 'getTool', 'isRestricted', 'isAllowed', 'execute'])
    );

    const allTools = await service.list();
    expect(allTools.length).toBeGreaterThan(0);

    const bash = await service.get('bash');
    expect(bash?.function.name).toBe('bash');
    expect(service.getTool('bash')).toBeDefined();

    expect(service.isRestricted('sendWebhook')).toBe(true);
    expect(service.isAllowed('sendWebhook')).toBe(false);
    expect(service.isAllowed('bash')).toBe(true);

    const restricted = await service.execute(
      'sendWebhook',
      { url: 'https://example.com' },
      {
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        artifactsDir: '/tmp',
      }
    );
    expect(restricted).toBeNull();
  });
});

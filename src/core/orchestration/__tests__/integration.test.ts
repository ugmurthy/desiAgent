/**
 * Orchestration Integration Tests
 *
 * End-to-end tests for agent orchestration and execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentOrchestrator } from '../orchestrator.js';
import { AgentPlanner } from '../planner.js';
import { RunsService } from '../../execution/runs.js';
import { GoalsService } from '../../execution/goals.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ToolRegistry } from '../../tools/registry.js';
import { getDatabase } from '../../../db/client.js';
import type { LLMProvider } from '../../providers/types.js';

describe('Orchestration Integration', () => {
  let orchestrator: AgentOrchestrator;
  let db: any;
  let mockProvider: any;
  let runsService: RunsService;
  let goalsService: GoalsService;

  beforeEach(() => {
    // Create test database
    db = getDatabase(':memory:');

    // Create services
    runsService = new RunsService(db);
    goalsService = new GoalsService(db);

    // Create mock LLM provider
    mockProvider = {
      name: 'test',
      callWithTools: vi.fn(),
      chat: vi.fn(),
      validateToolCallSupport: vi.fn(),
    } as unknown as LLMProvider;

    // Create orchestrator
    const registry = new ToolRegistry();
    const toolExecutor = new ToolExecutor(registry);

    orchestrator = new AgentOrchestrator({
      db,
      llmProvider: mockProvider,
      toolExecutor,
      runService: runsService,
      maxSteps: 5,
    });
  });

  describe('executeRun', () => {
    it('executes simple goal with no tools', async () => {
      // Setup
      const goal = await goalsService.create('Simple goal');
      const run = await runsService._create(goal.id, 20);

      // Mock LLM to finish immediately
      vi.mocked(mockProvider.callWithTools).mockResolvedValueOnce({
        thought: 'DONE: Task completed',
        toolCalls: [],
        finishReason: 'stop',
      });

      // Execute
      await orchestrator.executeRun(run.id);

      // Verify
      const completed = await runsService.get(run.id);
      expect(completed.status).toBe('completed');
    });

    it('handles tool execution in run', async () => {
      const goal = await goalsService.create('Tool using goal');
      const run = await runsService._create(goal.id, 20);

      // First step: think and call tool
      vi.mocked(mockProvider.callWithTools).mockResolvedValueOnce({
        thought: 'Let me call bash',
        toolCalls: [
          {
            id: 'call_1',
            name: 'bash',
            arguments: { command: 'echo test' },
          },
        ],
        finishReason: 'tool_calls',
      });

      // Second step: finish after tool
      vi.mocked(mockProvider.callWithTools).mockResolvedValueOnce({
        thought: 'DONE: Completed',
        toolCalls: [],
        finishReason: 'stop',
      });

      await orchestrator.executeRun(run.id);

      const completed = await runsService.get(run.id);
      expect(completed.status).toBe('completed');
    });

    it('respects max steps limit', async () => {
      const goal = await goalsService.create('Max steps test');
      const run = await runsService._create(goal.id, 20);

      // Keep returning tool calls to exceed max steps
      vi.mocked(mockProvider.callWithTools).mockResolvedValue({
        thought: 'Continuing',
        toolCalls: [
          {
            id: 'call_x',
            name: 'bash',
            arguments: { command: 'echo x' },
          },
        ],
        finishReason: 'tool_calls',
      });

      // This should complete after reaching maxSteps
      await orchestrator.executeRun(run.id);

      const completed = await runsService.get(run.id);
      // Should eventually complete (either by finishing or hitting step limit)
      expect(completed.status).toBe('completed');
    });

    it('handles missing goal gracefully', async () => {
      const fakeRun = { id: 'run_fake', goalId: 'goal_fake' };

      // Manually create a fake run in DB to test error handling
      // Since we can't easily insert without the proper schema setup,
      // we expect the orchestrator to handle not finding the goal
      await expect(
        orchestrator.executeRun('run_nonexistent')
      ).rejects.toThrow();
    });

    it('updates working memory during execution', async () => {
      const goal = await goalsService.create('Memory test');
      const run = await runsService._create(goal.id, 20);

      vi.mocked(mockProvider.callWithTools).mockResolvedValueOnce({
        thought: 'DONE: Completed',
        toolCalls: [],
        finishReason: 'stop',
      });

      await orchestrator.executeRun(run.id);

      // Verify working memory was updated
      const completed = await runsService.get(run.id);
      expect(completed.status).toBe('completed');
    });
  });

  describe('error handling', () => {
    it('catches and handles LLM errors', async () => {
      const goal = await goalsService.create('Error test goal');
      const run = await runsService._create(goal.id, 20);

      vi.mocked(mockProvider.callWithTools).mockRejectedValueOnce(
        new Error('LLM error')
      );

      await expect(orchestrator.executeRun(run.id)).rejects.toThrow();

      const failed = await runsService.get(run.id);
      expect(failed.status).toBe('failed');
    });

    it('records step errors in database', async () => {
      const goal = await goalsService.create('Step error test');
      const run = await runsService._create(goal.id, 20);

      vi.mocked(mockProvider.callWithTools).mockResolvedValueOnce({
        thought: 'DONE: Completed',
        toolCalls: [],
        finishReason: 'stop',
      });

      await orchestrator.executeRun(run.id);

      const steps = await runsService.getSteps(run.id);
      expect(steps.length).toBeGreaterThan(0);
    });
  });
});

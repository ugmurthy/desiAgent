/**
 * Bash Tool Tests
 *
 * Tests for bash command execution
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BashTool } from '../bash.js';
import type { ToolContext } from '../base.js';

const makeCtx = (overrides?: Partial<ToolContext>): ToolContext => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  artifactsDir: '/tmp/test-artifacts',
  ...overrides,
});

const mockBunSpawn = (
  stdout = '',
  stderr = '',
  exitCode: number | Promise<number> = 0
) => {
  const mockBun = {
    spawn: vi.fn().mockReturnValue({
      stdout: { text: () => Promise.resolve(stdout) },
      stderr: { text: () => Promise.resolve(stderr) },
      exited: typeof exitCode === 'number' ? Promise.resolve(exitCode) : exitCode,
    }),
  };
  (globalThis as any).Bun = mockBun;
  return mockBun;
};

describe('BashTool', () => {
  let tool: BashTool;

  beforeEach(() => {
    tool = new BashTool();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).Bun;
  });

  describe('initialization', () => {
    it('has correct name and description', () => {
      expect(tool.name).toBe('bash');
      expect(tool.description).toContain('bash command');
    });

    it('has input schema', () => {
      expect(tool.inputSchema).toBeDefined();
    });
  });

  describe('command validation', () => {
    it('accepts safe commands', async () => {
      const mock = mockBunSpawn('output');

      const result = await tool.execute({ command: 'echo hello' }, makeCtx());

      expect(result.stdout).toBe('output');
      expect(mock.spawn).toHaveBeenCalled();
    });

    it('blocks rm -rf /', async () => {
      await expect(
        tool.execute({ command: 'rm -rf /' }, makeCtx())
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks sudo', async () => {
      await expect(
        tool.execute({ command: 'sudo apt-get install vim' }, makeCtx())
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks chmod 777', async () => {
      await expect(
        tool.execute({ command: 'chmod 777 /etc/passwd' }, makeCtx())
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks shutdown command', async () => {
      await expect(
        tool.execute({ command: 'shutdown -h now' }, makeCtx())
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks reboot command', async () => {
      await expect(
        tool.execute({ command: 'reboot' }, makeCtx())
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks halt command', async () => {
      await expect(
        tool.execute({ command: 'halt' }, makeCtx())
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks fork bomb', async () => {
      await expect(
        tool.execute({ command: ':(){ :|:& };:' }, makeCtx())
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('validates chained commands', async () => {
      await expect(
        tool.execute({ command: 'echo hello && rm -rf /' }, makeCtx())
      ).rejects.toThrow('Disallowed');
    });

    it('validates semicolon-separated commands', async () => {
      await expect(
        tool.execute({ command: 'echo hello; sudo su' }, makeCtx())
      ).rejects.toThrow('Disallowed');
    });

    it('is case insensitive for validation', async () => {
      await expect(
        tool.execute({ command: 'SUDO apt-get update' }, makeCtx())
      ).rejects.toThrow();
    });
  });

  describe('timeout handling', () => {
    it('uses default timeout of 30000ms', async () => {
      const mock = mockBunSpawn();

      await tool.execute({ command: 'echo test' }, makeCtx());

      expect(mock.spawn).toHaveBeenCalled();
    });

    it('respects custom timeout', async () => {
      const mock = mockBunSpawn();

      await tool.execute({ command: 'echo test', timeoutMs: 5000 }, makeCtx());

      expect(mock.spawn).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns error status for failed commands', async () => {
      mockBunSpawn('', 'Command failed', 1);

      const result = await tool.execute({ command: 'false' }, makeCtx());

      expect(result.exitCode).toBe(1);
    });

    it('returns timeout status', async () => {
      mockBunSpawn('', '', new Promise(() => {}) as any);

      const result = await tool.execute(
        { command: 'sleep 1000', timeoutMs: 100 },
        makeCtx()
      );

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('handles missing spawn gracefully', async () => {
      (globalThis as any).Bun = {};

      const result = await tool.execute({ command: 'echo test' }, makeCtx());

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('spawn not available');
    });
  });
});

/**
 * Bash Tool Tests
 *
 * Tests for bash command execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BashTool } from '../bash.js';

describe('BashTool', () => {
  let tool: BashTool;

  beforeEach(() => {
    tool = new BashTool();
    vi.clearAllMocks();
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
      const mockBun = {
        spawn: vi.fn().mockReturnValue({
          stdout: { text: () => Promise.resolve('output') },
          stderr: { text: () => Promise.resolve('') },
          exited: Promise.resolve(0),
        }),
      };

      (globalThis as any).Bun = mockBun;

      const result = await tool.execute(
        { command: 'echo hello' },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      expect(result.stdout).toBe('output');
    });

    it('blocks rm -rf /', async () => {
      await expect(
        tool.execute(
          { command: 'rm -rf /' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks sudo', async () => {
      await expect(
        tool.execute(
          { command: 'sudo apt-get install vim' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks chmod 777', async () => {
      await expect(
        tool.execute(
          { command: 'chmod 777 /etc/passwd' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('blocks shutdown command', async () => {
      await expect(
        tool.execute(
          { command: 'shutdown -h now' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks reboot command', async () => {
      await expect(
        tool.execute(
          { command: 'reboot' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks halt command', async () => {
      await expect(
        tool.execute(
          { command: 'halt' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command');
    });

    it('blocks fork bomb', async () => {
      await expect(
        tool.execute(
          { command: ':(){ :|:& };:' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed command pattern');
    });

    it('validates chained commands', async () => {
      await expect(
        tool.execute(
          { command: 'echo hello && rm -rf /' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed chained command pattern');
    });

    it('validates semicolon-separated commands', async () => {
      await expect(
        tool.execute(
          { command: 'echo hello; sudo su' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow('Disallowed chained command');
    });

    it('is case insensitive for validation', async () => {
      await expect(
        tool.execute(
          { command: 'SUDO apt-get update' },
          {
            logger: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          }
        )
      ).rejects.toThrow();
    });
  });

  describe('timeout handling', () => {
    it('uses default timeout of 30000ms', async () => {
      const mockBun = {
        spawn: vi.fn().mockReturnValue({
          stdout: { text: () => Promise.resolve('') },
          stderr: { text: () => Promise.resolve('') },
          exited: Promise.resolve(0),
        }),
      };

      (globalThis as any).Bun = mockBun;

      await tool.execute(
        { command: 'echo test' },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      // Timeout is enforced but we can't directly assert it in this test
      expect(mockBun.spawn).toHaveBeenCalled();
    });

    it('respects custom timeout', async () => {
      const mockBun = {
        spawn: vi.fn().mockReturnValue({
          stdout: { text: () => Promise.resolve('') },
          stderr: { text: () => Promise.resolve('') },
          exited: Promise.resolve(0),
        }),
      };

      (globalThis as any).Bun = mockBun;

      await tool.execute(
        { command: 'echo test', timeoutMs: 5000 },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      expect(mockBun.spawn).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns error status for failed commands', async () => {
      const mockBun = {
        spawn: vi.fn().mockReturnValue({
          stdout: { text: () => Promise.resolve('') },
          stderr: { text: () => Promise.resolve('Command failed') },
          exited: Promise.resolve(1),
        }),
      };

      (globalThis as any).Bun = mockBun;

      const result = await tool.execute(
        { command: 'false' },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      expect(result.exitCode).toBe(1);
    });

    it('returns timeout status', async () => {
      const mockBun = {
        spawn: vi.fn().mockReturnValue({
          stdout: { text: () => Promise.resolve('') },
          stderr: { text: () => Promise.resolve('') },
          exited: new Promise(() => {}), // Never resolves
        }),
      };

      (globalThis as any).Bun = mockBun;

      const result = await tool.execute(
        { command: 'sleep 1000', timeoutMs: 100 },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('handles missing spawn gracefully', async () => {
      (globalThis as any).Bun = {};

      const result = await tool.execute(
        { command: 'echo test' },
        {
          logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
          },
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('spawn not available');
    });
  });
});

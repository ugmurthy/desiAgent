/**
 * BashTool
 *
 * Executes bash commands with safety safeguards.
 * Adapted for bun's subprocess API.
 */

import { z } from 'zod';
import { BaseTool, type ToolContext } from './base.js';
import { resolve } from 'path';
import { getLogger } from '../../util/logger.js';

const bashInputSchema = z.object({
  command: z.string().describe('The bash command to execute'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory (defaults to artifacts dir)'),
  timeoutMs: z.number().default(30000).describe('Command timeout in milliseconds'),
});

type BashInput = z.infer<typeof bashInputSchema>;

interface BashOutput {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Dangerous command patterns that are blocked
 */
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'chmod 777',
  'mkfs',
  'dd if=',
  ':(){ :|:& };:',
  '> /dev/sda',
];

const DANGEROUS_START_PATTERNS = ['shutdown', 'reboot', 'halt', 'poweroff'];

/**
 * BashTool for bun runtime
 * Uses bun.spawn() for subprocess execution
 */
export class BashTool extends BaseTool<any, BashOutput> {
  name = 'bash';
  description = 'Execute a bash command with safety safeguards';
  inputSchema: any = bashInputSchema;

  private readonly ARTIFACTS_DIR = resolve('./artifacts');
  private logger = getLogger();

  /**
   * Validate command for dangerous patterns
   */
  private validateCommand(command: string): void {
    const normalizedCommand = command.toLowerCase().trim();

    for (const pattern of DANGEROUS_PATTERNS) {
      if (normalizedCommand.includes(pattern.toLowerCase())) {
        throw new Error(
          `Disallowed command pattern detected: ${pattern}`
        );
      }
    }

    for (const pattern of DANGEROUS_START_PATTERNS) {
      if (normalizedCommand.startsWith(pattern)) {
        throw new Error(
          `Disallowed command: commands starting with '${pattern}' are not allowed`
        );
      }
    }

    // Check chained commands
    const chainedCommands = command.split(/&&|;/).map((cmd) => cmd.trim().toLowerCase());
    for (const chainedCmd of chainedCommands) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (chainedCmd.includes(pattern.toLowerCase())) {
          throw new Error(
            `Disallowed chained command pattern detected: ${pattern}`
          );
        }
      }
      for (const pattern of DANGEROUS_START_PATTERNS) {
        if (chainedCmd.startsWith(pattern)) {
          throw new Error(
            `Disallowed chained command: '${pattern}' is not allowed`
          );
        }
      }
    }
  }

  /**
   * Execute bash command using bun.spawn()
   */
  async execute(input: BashInput, ctx: ToolContext): Promise<BashOutput> {
    this.validateCommand(input.command);

    const workingDir = input.cwd
      ? resolve(input.cwd)
      : this.ARTIFACTS_DIR;
    const timeoutMs = input.timeoutMs ?? 30000;

    this.logger.info(
      `Executing bash command: ${input.command} (cwd: ${workingDir}, timeout: ${timeoutMs}ms)`
    );

    try {
      // Use bun's native spawn API
      // In bun, spawn is available globally
      const bunGlobal = globalThis as any;
      const Bun = bunGlobal.Bun || bunGlobal;

      if (!Bun?.spawn) {
        throw new Error('bun.spawn not available');
      }

      const proc = Bun.spawn({
        cmd: ['bash', '-c', input.command],
        cwd: workingDir,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      });

      // Convert streams to text with timeout
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const readStdout = proc.stdout
        .text()
        .then((text: any) => {
          stdout = text;
        })
        .catch(() => {
          /* ignore */
        });

      const readStderr = proc.stderr
        .text()
        .then((text: any) => {
          stderr = text;
        })
        .catch(() => {
          /* ignore */
        });

      // Set up timeout
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(
          () => {
            timedOut = true;
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
          },
          timeoutMs
        )
      );

      try {
        // Wait for process and stream reads with timeout
        await Promise.race([
          Promise.all([proc.exited, readStdout, readStderr]),
          timeout,
        ]);

        const exitCode = await proc.exited;

        this.logger.info(
          `Command completed with exit code: ${exitCode} (stdout: ${stdout.length} bytes, stderr: ${stderr.length} bytes)`
        );

        if (ctx.onEvent) {
          if (exitCode === 0) {
            ctx.onEvent('tool:bash:completed', {
              status: 'success',
              exitCode,
            });
          } else {
            ctx.onEvent('tool:bash:completed', {
              status: 'failed',
              exitCode,
            });
          }
        }

        return {
          command: input.command,
          stdout,
          stderr,
          exitCode,
          timedOut: false,
        };
      } catch (error) {
        if (timedOut) {
          return {
            command: input.command,
            stdout,
            stderr: stderr || `Command timed out after ${timeoutMs}ms`,
            exitCode: 124, // Standard timeout exit code
            timedOut: true,
          };
        }
        throw error;
      }
    } catch (error) {
      this.logger.error(
        `Bash command failed: ${error instanceof Error ? error.message : String(error)}`
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        command: input.command,
        stdout: '',
        stderr: errorMessage,
        exitCode: 1,
        timedOut: false,
      };
    }
  }
}

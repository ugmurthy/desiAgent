import { Sandbox } from '@e2b/code-interpreter';

const E2B_API_KEY = process.env.E2B_API_KEY;

if (!E2B_API_KEY) {
  console.error('Error: E2B_API_KEY environment variable is not set');
  process.exit(1);
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  error?: string;
  logs: string[];
  results: unknown[];
  metrics?: {
    cpuUsedPct: number;
    memUsed: number;
    diskUsed: number;
  };
  sandboxId?: string;
}

async function main() {
  const code = 'print("Hello from E2B sandbox!")';
  const language: 'python' | 'javascript' | 'typescript' | 'bash' = 'python';
  const timeout = 60;
  const envs: Record<string, string> = {};
  const streaming = false;

  let sandbox;
  try {
    sandbox = await Sandbox.create({
      apiKey: E2B_API_KEY,
      timeoutMs: timeout * 1000,
    });

    const result: ExecutionResult = {
      stdout: '',
      stderr: '',
      logs: [],
      results: [],
    };

    if (streaming) {
      const isBash = language === 'bash';
      const cmd = isBash
        ? await sandbox.commands.run(code)
        : await sandbox.commands.run(undefined, { cmd: code, language });

      for await (const chunk of cmd.stdout) {
        result.stdout += chunk;
        result.logs.push(chunk);
      }
      for await (const chunk of cmd.stderr) {
        result.stderr += chunk;
      }
    } else {
      const execResult = await sandbox.runCode(code, { language, envs });

      if (execResult.logs) {
        result.stdout = execResult.logs.stdout?.join('\n') ?? '';
        result.stderr = execResult.logs.stderr?.join('\n') ?? '';
        result.logs = [
          ...(execResult.logs.stdout ?? []),
          ...(execResult.logs.stderr ?? []),
        ];
      }

      if (execResult.results) {
        result.results = execResult.results.map(r => {
          if (r.html) return { type: 'html', content: r.html };
          if (r.png) return { type: 'png', content: '[binary data]' };
          if (r.jpeg) return { type: 'jpeg', content: '[binary data]' };
          if (r.text !== undefined) return { type: 'text', content: r.text };
          return r;
        });
      }

      if (execResult.error) {
        result.error = execResult.error.name === 'RuntimeError'
          ? execResult.error.traceback ?? execResult.error.value ?? String(execResult.error)
          : String(execResult.error);
      }
    }

    try {
      const metrics = await sandbox.getMetrics();
      if (metrics.length > 0) {
        const last = metrics[metrics.length - 1];
        result.metrics = {
          cpuUsedPct: last.cpuUsedPct,
          memUsed: last.memUsed,
          diskUsed: last.diskUsed,
        };
      }
    } catch {
      // Metrics are optional
    }

    result.sandboxId = sandbox.sandboxId;

    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Sandbox execution failed:', errorMessage);
    process.exit(1);
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {});
    }
  }
}

main();

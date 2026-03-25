import { ExecutionPlanCompiler } from '../src/core/execution/planCompiler.js';

interface BenchmarkCase {
  name: string;
  taskCount: number;
  fanOut: number;
  runs: number;
}

function buildSyntheticDag(taskCount: number, fanOut: number): Array<{ id: string; dependencies: string[] }> {
  const tasks: Array<{ id: string; dependencies: string[] }> = [];

  for (let i = 0; i < taskCount; i++) {
    const id = String(i + 1).padStart(4, '0');
    const dependencies: string[] = [];

    for (let j = 1; j <= fanOut; j++) {
      const depIndex = i - j;
      if (depIndex >= 0) {
        dependencies.push(String(depIndex + 1).padStart(4, '0'));
      }
    }

    tasks.push({ id, dependencies });
  }

  return tasks;
}

function runCase(input: BenchmarkCase): { avgMs: number; p95Ms: number } {
  const tasks = buildSyntheticDag(input.taskCount, input.fanOut);
  const durations: number[] = [];

  for (let i = 0; i < input.runs; i++) {
    const start = performance.now();
    ExecutionPlanCompiler.compile(tasks);
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const avgMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
  const p95Ms = durations[p95Index];

  return { avgMs, p95Ms };
}

const suite: BenchmarkCase[] = [
  { name: 'small', taskCount: 50, fanOut: 2, runs: 100 },
  { name: 'medium', taskCount: 200, fanOut: 3, runs: 80 },
  { name: 'large', taskCount: 1000, fanOut: 4, runs: 30 },
];

for (const testCase of suite) {
  const result = runCase(testCase);
  console.log(
    `${testCase.name.padEnd(6)} tasks=${String(testCase.taskCount).padStart(4)} fanOut=${testCase.fanOut} runs=${String(testCase.runs).padStart(3)} avgMs=${result.avgMs.toFixed(3)} p95Ms=${result.p95Ms.toFixed(3)}`
  );
}

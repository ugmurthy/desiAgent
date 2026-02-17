/**
 * Example: Analyze inference prompt complexity per execution
 *
 * Run with:
 * bun run examples/list-inference-complexity.ts [execId] [--json] [--complex]
 */

import { setupDesiAgent } from '../src/index.js';
import { EnhancedInputAnalyzer } from './enhanced-input-analyzer.js';

const DEFAULT_LIMIT = 100;

type ComplexitySummary = {
  score: number | null;
  isComplex: boolean | null;
  estimatedSubTasks: number | null;
  requiresDecomposition: boolean | null;
};

type SubStepReport = {
  id: string;
  taskId: string;
  toolOrPromptName: string;
  prompt: string | null;
  complexity: ComplexitySummary;
};

type ExecutionReport = {
  executionId: string;
  status: string;
  dagId: string | null;
  inferenceSubSteps: SubStepReport[];
};

function parseArgs(args: string[]) {
  const json = args.includes('--json');
  const complexOnly = args.includes('--complex');
  const execId = args.find((arg) => !arg.startsWith('-')) ?? null;
  return { execId, json, complexOnly };
}

async function listCompletedExecutions(client: Awaited<ReturnType<typeof setupDesiAgent>>) {
  const executions = [] as Array<{ id: string; status: string; dagId?: string | null }>;
  let offset = 0;

  while (true) {
    const batch = await client.executions.list({
      status: 'completed',
      limit: DEFAULT_LIMIT,
      offset,
    });

    if (batch.length === 0) {
      break;
    }

    executions.push(...batch);
    offset += batch.length;

    if (batch.length < DEFAULT_LIMIT) {
      break;
    }
  }

  return executions;
}

async function main() {
  const { execId, json, complexOnly } = parseArgs(process.argv.slice(2));
  const analyzer = new EnhancedInputAnalyzer();

  const client = await setupDesiAgent({
    llmProvider: 'openrouter',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    modelName: 'openai/gpt-4o',
    logLevel: 'silent',
    databasePath: process.env.DATABASE_PATH,
  });

  try {
    const executionRecords = execId
      ? [await client.executions.get(execId)]
      : await listCompletedExecutions(client);

    const completedExecutions = executionRecords.filter(
      (execution) => execution.status === 'completed'
    );

    if (execId && completedExecutions.length === 0) {
      console.error(`Execution ${execId} is not completed or does not exist.`);
      return;
    }

    const reports: ExecutionReport[] = [];

    for (const execution of completedExecutions) {
      const subSteps = await client.executions.getSubSteps(execution.id);
      const inferenceSteps = subSteps.filter((step) => step.actionType === 'inference');

      const inferenceSubSteps: SubStepReport[] = [];

      for (const step of inferenceSteps) {
        const promptValue =
          typeof step.toolOrPromptParams?.prompt === 'string'
            ? step.toolOrPromptParams.prompt
            : null;

        let complexity: ComplexitySummary = {
          score: null,
          isComplex: null,
          estimatedSubTasks: null,
          requiresDecomposition: null,
        };

        if (promptValue) {
          const analysis = await analyzer.analyzeComplexity(promptValue);
          complexity = {
            score: analysis.confidence,
            isComplex: analysis.isComplex,
            estimatedSubTasks: analysis.estimatedSubTasks,
            requiresDecomposition: analysis.requiresDecomposition,
          };
        }

        inferenceSubSteps.push({
          id: step.id,
          taskId: step.taskId,
          toolOrPromptName: step.toolOrPromptName,
          prompt: promptValue,
          complexity,
        });
      }

      const filteredSubSteps = complexOnly
        ? inferenceSubSteps.filter((step) => step.complexity.isComplex === true)
        : inferenceSubSteps;

      if (complexOnly && filteredSubSteps.length === 0) {
        continue;
      }

      reports.push({
        executionId: execution.id,
        status: execution.status,
        dagId: execution.dagId ?? null,
        inferenceSubSteps: filteredSubSteps,
      });
    }

    if (json) {
      console.log(JSON.stringify({ executions: reports }, null, 2));
      return;
    }

    if (reports.length === 0) {
      const message = complexOnly
        ? 'No complex inference substeps found.'
        : 'No completed executions found.';
      console.log(message);
      return;
    }

    for (const report of reports) {
      console.log(`Execution ${report.executionId} (status: ${report.status})`);
      if (report.dagId) {
        console.log(`DAG: ${report.dagId}`);
      }

      if (report.inferenceSubSteps.length === 0) {
        console.log('No inference substeps found.');
        console.log('');
        continue;
      }

      for (const step of report.inferenceSubSteps) {
        console.log(`- Task ${step.taskId} (subStep: ${step.id})`);
        console.log(`  Tool/Prompt: ${step.toolOrPromptName}`);
        console.log(`  Prompt: ${step.prompt ?? '<missing>'}`);
        if (step.complexity.score === null) {
          console.log('  Complexity: <not available>');
        } else {
          console.log(
            `  Complexity score: ${step.complexity.score.toFixed(2)} | ` +
              `isComplex: ${step.complexity.isComplex} | ` +
              `estimatedSubTasks: ${step.complexity.estimatedSubTasks} | ` +
              `requiresDecomposition: ${step.complexity.requiresDecomposition}`
          );
        }
      }

      console.log('');
    }
  } catch (error) {
    console.error('Error analyzing inference prompts:', error);
  } finally {
    await client.shutdown();
  }
}

main();

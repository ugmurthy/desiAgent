import type { GlobalContext, SubTask } from './dagExecutor.js';

const MAX_DEP_LENGTH = 2000;

export interface ContextJob {
  original_request: string;
  intent: {
    primary: string;
    sub_intents: string[];
  };
  entities: Array<{
    entity: string;
    type: string;
    grounded_value: string;
  }>;
  sub_tasks: SubTask[];
  synthesis_plan: string;
}

export function buildGlobalContext(job: ContextJob): GlobalContext {
  const entitiesStr = job.entities.length > 0
    ? job.entities.map((e) => `• ${e.entity} (${e.type}): ${e.grounded_value}`).join('\n')
    : 'None';

  const formatted = `# Global Context
**Request:** ${job.original_request}
**Primary Intent:** ${job.intent.primary}
**Sub-intents:** ${job.intent.sub_intents.join('; ') || 'None'}
**Entities:**
${entitiesStr}
**Synthesis Goal:** ${job.synthesis_plan}`;

  return { formatted, totalTasks: job.sub_tasks.length };
}

export function buildInferencePrompt(
  task: SubTask,
  globalContext: GlobalContext,
  taskResults: Map<string, any>
): string {
  const depsStr = task.dependencies
    .filter((id) => id !== 'none' && taskResults.has(id))
    .map((id) => {
      const result = taskResults.get(id);
      const str = typeof result === 'string' ? result : JSON.stringify(result);
      return `[Task ${id}]: ${str.length > MAX_DEP_LENGTH ? str.slice(0, MAX_DEP_LENGTH) + '...' : str}`;
    })
    .join('\n\n') || 'None';

  return `You are an expert assistant executing a sub-task within a larger workflow.

${globalContext.formatted}

# Current Task [${task.id}/${globalContext.totalTasks}]
**Description:** ${task.description}
**Reasoning:** ${task.thought}
**Expected Output:** ${task.expected_output}

# Dependencies
${depsStr}

# Instruction
${task.tool_or_prompt.params?.prompt || task.description}

Respond with ONLY the expected output format. Build upon dependencies for coherence and align with the global context.
`;
}

/**
 * DAG-specific type definitions for decomposed tasks
 */
import { z } from 'zod';

export const SubTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  thought: z.string(),
  action_type: z.enum(['tool', 'inference']),
  tool_or_prompt: z.object({
    name: z.string(),
    params: z.record(z.any()).optional(),
  }),
  expected_output: z.string(),
  dependencies: z.array(z.string()),
});

export const DecomposerJobSchema = z.object({
  original_request: z.string(),
  intent: z.object({
    primary: z.string(),
    sub_intents: z.array(z.string()),
  }),
  entities: z.array(z.object({
    entity: z.string(),
    type: z.string(),
    grounded_value: z.string(),
  })),
  sub_tasks: z.array(SubTaskSchema),
  synthesis_plan: z.string().default(""),
  validation: z.object({
    coverage: z.string().default(""),
    gaps: z.array(z.string()).default([]),
    iteration_triggers: z.array(z.string()).default([]),
  }).default({}),
  clarification_needed: z.boolean().default(false),
  clarification_query: z.string().nullable().optional().transform(v => v ?? ""),
}).refine(
  (data) => {
    if (data.clarification_needed) {
      return typeof data.clarification_query === 'string' && data.clarification_query.length > 0;
    }
    return true;
  },
  {
    message: 'clarification_query is required when clarification_needed is true',
    path: ['clarification_query'],
  }
);

export type SubTask = z.infer<typeof SubTaskSchema>;
export type DecomposerJob = z.infer<typeof DecomposerJobSchema>;

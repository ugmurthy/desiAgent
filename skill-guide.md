## Synthesis Result

# Comprehensive Guide to Implementing AI Skills Management

This guide details the architecture, implementation of the `SkillManager`, example skill definitions, and the integration loop required to enable an AI agent to utilize specialized knowledge (`context` skills) and external functions (`executable` skills).

This implementation leverages **Bun** for fast execution and native file system access, **Zod** for robust schema validation, and **Gray-Matter** for parsing Markdown frontmatter.

---

## 1. Architecture Overview

The system is designed around a modular, file-based skill definition structure residing in a dedicated `./skills` directory.

| Component | Description | Source Task |
| :--- | :--- | :--- |
| **Skill Structure** | Each skill lives in its own subdirectory (e.g., `./skills/calculator/`). It requires a `SKILL.md` file for metadata and instructions. Executable skills require a `handler.ts`. | Task 003 |
| **Metadata Schema** | Defined by `SkillSchema` (Zod), ensuring `SKILL.md` frontmatter conforms to expected structure (`name`, `description`, `type`, optional `parameters`). | Task 001, 002 |
| **Parser (`parseSkill`)** | Reads `SKILL.md`, validates the frontmatter, extracts content, checks for `handler.ts`, and returns a standardized `ParsedSkill` object. | Task 001, 002 |
| **`SkillManager`** | The core orchestrator. Loads all skills, generates context prompts, creates OpenAI tool definitions, and handles dynamic execution of handlers. | Task 002 |
| **Integration Loop** | Manages the multi-turn conversation with the OpenAI API, injecting context, handling tool calls, and executing local code via the `SkillManager`. | Task 004 |

---

## 2. SkillManager Implementation (`SkillManager.ts`)

The `SkillManager` class encapsulates all logic for discovering, parsing, and utilizing skills.

### Core Components from Task 002

```typescript
import { z } from 'zod';
import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';

// --- Zod Schema and Interfaces (from Task 001/002) ---

export const SkillSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: z.enum(['context', 'executable'], {
    errorMap: () => ({ message: 'Type must be "context" or "executable"' }),
  }),
  parameters: z
    .object({
      type: z.literal('object'),
      properties: z.record(
        z.object({
          type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
          description: z.string().optional(),
        }),
      ),
      required: z.array(z.string()).optional(),
    })
    .optional()
    .refine(
      (params) => !params || params.type === 'object',
      { message: 'Parameters must conform to OpenAI JSON Schema (object type)' },
    ),
});

export interface ParsedSkill {
  name: string;
  description: string;
  type: 'context' | 'executable';
  parameters?: z.infer<typeof SkillSchema.shape.parameters>;
  content: string; // Markdown instructions after frontmatter
  hasHandler: boolean; // True if handler.ts exists
  skillDir: string; // Full path to skill folder
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: NonNullable<ParsedSkill['parameters']>;
  };
}

// --- Parser Function (from Task 001/002) ---

async function parseSkill(skillDir: string): Promise<ParsedSkill | null> {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const skillFile = Bun.file(skillMdPath);
    if (!(await skillFile.exists())) {
      console.warn(`SKILL.md not found in ${skillDir}`);
      return null;
    }

    const content = await skillFile.text();
    const parsed = matter(content);

    const data = SkillSchema.parse(parsed.data);

    const handlerPath = path.join(skillDir, 'handler.ts');
    const handlerFile = Bun.file(handlerPath);
    const hasHandler = await handlerFile.exists();

    // Basic validation check (optional but recommended)
    if (data.type === 'executable' && !hasHandler) {
        console.warn(`Executable skill ${data.name} is missing handler.ts and will be ignored as a tool.`);
    }
    if (data.type === 'context' && hasHandler) {
      console.warn(`Context skill ${data.name} has an unused handler.ts`);
    }

    return {
      name: data.name,
      description: data.description,
      type: data.type,
      parameters: data.parameters,
      content: parsed.content.trim(),
      hasHandler,
      skillDir,
    };
  } catch (error) {
    console.warn(`Failed to parse skill in ${skillDir}:`, error);
    return null;
  }
}


// --- SkillManager Class (from Task 002) ---

export class SkillManager {
  private skillsDir: string;
  public parsedSkills: ParsedSkill[] = [];

  constructor(skillsDir: string = './skills') {
    this.skillsDir = path.resolve(skillsDir);
  }

  /**
   * Scans the skills directory for skill folders and parses SKILL.md files.
   * Populates this.parsedSkills.
   */
  async loadSkills(): Promise<void> {
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      const skillDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.skillsDir, entry.name));
      this.parsedSkills = (
        await Promise.all(skillDirs.map((dir) => parseSkill(dir)))
      ).filter((skill): skill is ParsedSkill => skill !== null);
    } catch (error) {
      console.error(`Failed to load skills from ${this.skillsDir}:`, error);
      this.parsedSkills = [];
    }
  }

  /**
   * Generates a prompt string by concatenating all 'context' skills.
   */
  getContextInstructions(): string {
    const contextSkills = this.parsedSkills.filter((skill) => skill.type === 'context');
    return contextSkills
      .map(
        (skill) =>
          `## Skill: ${skill.name}\n\n**Description:** ${skill.description}\n\n${skill.content}`,
      )
      .join('\n\n---\n\n');
  }

  /**
   * Generates OpenAI-compatible tool definitions for all 'executable' skills that have a handler.
   */
  getTools(): OpenAITool[] {
    return this.parsedSkills
      .filter((skill) => skill.type === 'executable' && skill.hasHandler && skill.parameters)
      .map((skill) => ({
        type: 'function',
        function: {
          name: skill.name,
          description: skill.description,
          parameters: skill.parameters!,
        },
      }));
  }

  /**
   * Executes an 'executable' skill by dynamically importing and calling its handler.ts.
   */
  async executeSkill(skillName: string, args: Record<string, unknown>): Promise<unknown> {
    const skill = this.parsedSkills.find((s) => s.name === skillName);
    if (!skill) {
      throw new Error(`Skill "${skillName}" not found.`);
    }
    if (skill.type !== 'executable' || !skill.hasHandler) {
      throw new Error(`Skill "${skillName}" is not executable or missing handler.`);
    }

    const handlerPath = path.resolve(skill.skillDir, 'handler.ts');
    try {
      // Use Bun's dynamic import capability with file protocol
      const module = await import(`file://${handlerPath}`);
      
      // Look for default export or named 'handler' export
      const handlerFn = (module.default ?? module.handler) as ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
      
      if (typeof handlerFn !== 'function') {
        throw new Error('Handler must export a default function or a named "handler" function.');
      }
      return await handlerFn(args);
    } catch (error) {
      console.error(`Error executing skill "${skillName}":`, error);
      throw new Error(
        `Failed to execute skill "${skillName}": ${
          error instanceof Error ? error.message : 'Unknown error during import/execution'
        }`,
      );
    }
  }
}
```

---

## 3. Example Skill Files Structure

Skills must be organized in subdirectories within the main skills path (defaulting to `./skills/`).

### Example 1: Context Skill (`./skills/git-expert/SKILL.md`)

This skill provides static knowledge injected directly into the system prompt.

```markdown
---
name: git-expert
description: You are an expert in Git version control. Use this knowledge to advise on commands, best practices, branching strategies, and troubleshooting.
type: context
---

You are a Git expert. Respond to Git-related queries using these guidelines:

1. **Always recommend safe practices**: Use `git status`, `git diff`, and `git log` before destructive operations.
2. **Branching workflow**: Prefer Git Flow or GitHub Flow. Main branches: `main` (production), `develop` (integration).
3. **Common commands**:
   - Clone: `git clone <repo>`
   - Status: `git status`
   - Commit: `git add . && git commit -m "message"`
   - Push: `git push origin <branch>`
   - Merge: `git checkout main && git merge develop`
4. **Troubleshooting**:
   - Merge conflicts: Edit files, `git add`, `git commit`.
   - Rebase: `git rebase -i HEAD~3` for interactive.
5. **Advanced**: Use `git bisect` for bugs, `git stash` for temporary saves.

Prioritize safety and explain **why** each command is used.
```

### Example 2: Executable Skill (`./skills/calculator/`)

This skill requires both metadata and executable logic.

#### `./skills/calculator/SKILL.md`

```markdown
---
name: calculator
description: Safely evaluate simple mathematical expressions (addition, subtraction, multiplication, division, parentheses). Supports numbers, basic operators. No variables or advanced functions.
type: executable
parameters:
  type: object
  properties:
    expression:
      type: string
      description: Mathematical expression, e.g., "(2 + 3) * 4 / 2"
  required: ["expression"]
---

When using this tool:
- Input is a string expression using +, -, *, /, (), numbers (integers/decimals).
- Returns the computed result as a number or error message.
- Example: "2 + 3 * (4 - 1)" → 11
```

#### `./skills/calculator/handler.ts`

This handler uses Bun's native capabilities to execute the logic.

```typescript
// WARNING: Using Function constructor is generally unsafe for untrusted input. 
// This is simplified for demonstration purposes.

export default async function handler(args: { expression: string }): Promise<{ result?: number; error?: string }> {
  try {
    // Basic sanitization to prevent injection of non-math keywords
    const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
    if (sanitized !== args.expression) {
      throw new Error('Invalid characters detected in expression.');
    }

    // Evaluate safely with Function (sandboxed from local scope)
    const evaluate = new Function(`return (${sanitized});`);
    const result = evaluate();
    
    if (typeof result !== 'number') {
      throw new Error('Evaluation did not yield a valid number.');
    }

    return { result: Math.round(result * 1000) / 1000 }; // Round to 3 decimals
  } catch (error) {
    return { error: (error as Error).message };
  }
}
```

---

## 4. The Integration Loop (`main.ts`)

The integration loop manages the conversation flow, dynamically calling the OpenAI API and executing local code when necessary.

### Integration Logic from Task 004

```typescript
// main.ts (Bun-compatible integration script)

import { SkillManager } from './SkillManager.js'; 
import path from 'path';

// --- Type Definitions ---
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

// --- API Call Function ---
async function callOpenAI(
  messages: OpenAIChatMessage[],
  tools: OpenAITool[],
): Promise<OpenAIChatMessage> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // Recommended model for function calling
      messages,
      tools,
      tool_choice: 'auto',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message as OpenAIChatMessage;
}

// --- Agent Execution Loop ---
async function runAgentLoop(
  initialUserMessage: string,
  manager: SkillManager,
): Promise<string> {
  const tools = manager.getTools();
  const contextInstructions = manager.getContextInstructions();
  
  // Construct the system prompt, combining instructions and tool context
  let systemPrompt = `You are a helpful assistant with access to specialized skills.

${contextInstructions}

Use executable tools only when necessary to perform computations or actions. Follow context instructions for guidance.`;
  
  let messages: OpenAIChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialUserMessage },
  ];

  while (true) {
    console.log(`\n[Turn] Calling OpenAI with ${tools.length} tools...`);
    const assistantMessage = await callOpenAI(messages, tools);
    messages.push(assistantMessage);

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Handle Tool Execution
      for (const toolCall of assistantMessage.tool_calls) {
        const { name, arguments: argsStr } = toolCall.function;
        let args: Record<string, unknown>;
        
        try {
          args = JSON.parse(argsStr);
        } catch (e) {
          console.error(`Tool call ${name} failed parsing arguments: ${argsStr}`);
          args = { error: 'Invalid JSON arguments provided by model' };
        }

        let toolResult: unknown;
        try {
          // Execute the local handler via SkillManager
          toolResult = await manager.executeSkill(name, args);
        } catch (error) {
          toolResult = { error: (error as Error).message };
        }

        // Send result back to OpenAI
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    } else {
      // Final response received
      return assistantMessage.content || 'No response generated.';
    }
  }
}

// --- Main Execution ---
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: Set OPENAI_API_KEY environment variable.');
    process.exit(1);
  }

  const skillsDir = './skills';
  const manager = new SkillManager(skillsDir);
  
  console.log('Loading skills...');
  await manager.loadSkills();
  console.log(`Successfully loaded ${manager.parsedSkills.length} skills.`);

  const userQuery = process.argv[2] || 'Calculate (2 + 3) * 4 / 2 and explain Git branching strategies.';
  
  console.log('\n--- START AGENT RUN ---');
  console.log('User Query:', userQuery);
  
  const response = await runAgentLoop(userQuery, manager);
  
  console.log('\n--- FINAL AGENT RESPONSE ---');
  console.log(response);
}

main().catch(console.error);
```

## Final Result


```json
{}
```


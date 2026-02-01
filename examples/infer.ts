#!/usr/bin/env bun
/**
 * Custom Inference Script
 * 
 * Execute inference using a named agent with optional file attachments.
 * 
 * Usage: 
 *   bun run scripts/infer.ts --agent <name> --prompt <promptfile> [--files f1,f2,f3]
 *   bun run scripts/infer.ts -a summarizer -p prompt.txt -f doc1.pdf,doc2.txt
 */

import { parseArgs } from 'util';
import { readFileSync, existsSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { customInference } from '../src/core/execution/inference.js';
import { getDatabase } from '../src/db/client.js';
import { initializeLogger } from '../src/util/logger.js';
import { lookup } from 'mime-types';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    agent: {
      type: 'string',
      short: 'a',
    },
    prompt: {
      type: 'string',
      short: 'p',
    },
    files: {
      type: 'string',
      short: 'f',
    },
    db: {
      type: 'string',
      short: 'd',
      default: './data/desiagent.db',
    },
    temperature: {
      type: 'string',
      short: 't',
    },
    'max-tokens': {
      type: 'string',
      short: 'm',
    },
    output: {
      type: 'string',
      short: 'o',
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  },
  allowPositionals: false,
});

if (values.help || !values.agent || !values.prompt) {
  console.log(`
Custom Inference Script

Execute inference using a named agent with optional file attachments.

Usage:
  bun run scripts/infer.ts --agent <name> --prompt <promptfile> [options]

Required:
  -a, --agent <name>       Name of the agent to use (must be active)
  -p, --prompt <file>      Path to prompt file (text content)

Options:
  -f, --files <f1,f2,...>  Comma-separated list of attachment files
  -d, --db <path>          Database path (default: ./data/desiagent.db)
  -t, --temperature <n>    Temperature (0-2, default: 0.7)
  -m, --max-tokens <n>     Max tokens in response
  -o, --output <file>      Write response to file instead of stdout
  -h, --help               Show this help message

Examples:
  bun run scripts/infer.ts -a summarizer -p prompt.txt
  bun run scripts/infer.ts -a analyst -p query.txt -f report.pdf,data.csv
  bun run scripts/infer.ts -a writer -p instructions.txt -t 0.9 -o output.md
`);
  process.exit(values.help ? 0 : 1);
}

initializeLogger('info');

const promptPath = resolve(values.prompt);
if (!existsSync(promptPath)) {
  console.error(`Error: Prompt file not found: ${promptPath}`);
  process.exit(1);
}

const prompt = readFileSync(promptPath, 'utf-8');

const attachments: Array<{ filename: string; content: string; mimeType?: string }> = [];

if (values.files) {
  const fileList = values.files.split(',').map(f => f.trim()).filter(Boolean);
  
  for (const filePath of fileList) {
    const resolvedPath = resolve(filePath);
    
    if (!existsSync(resolvedPath)) {
      console.error(`Error: Attachment file not found: ${resolvedPath}`);
      process.exit(1);
    }
    
    const content = readFileSync(resolvedPath);
    const ext = extname(resolvedPath).toLowerCase();
    const mimeType = lookup(ext) || 'application/octet-stream';
    
    const isText = mimeType.startsWith('text/') || 
      ['application/json', 'application/javascript', 'application/xml'].includes(mimeType);
    
    attachments.push({
      filename: basename(resolvedPath),
      content: isText ? content.toString('utf-8') : content.toString('base64'),
      mimeType,
    });
  }
}

//const dbPath = resolve(values.db);
const dbPath = process.env.DATABASE_PATH
const db = getDatabase(dbPath);

const params: { temperature?: number; max_tokens?: number } = {};

if (values.temperature) {
  params.temperature = parseFloat(values.temperature);
  if (isNaN(params.temperature) || params.temperature < 0 || params.temperature > 2) {
    console.error('Error: Temperature must be a number between 0 and 2');
    process.exit(1);
  }
}

if (values['max-tokens']) {
  params.max_tokens = parseInt(values['max-tokens'], 10);
  if (isNaN(params.max_tokens) || params.max_tokens <= 0) {
    console.error('Error: max-tokens must be a positive integer');
    process.exit(1);
  }
}

console.error(`Agent: ${values.agent}`);
console.error(`Prompt file: ${values.prompt}`);
if (attachments.length > 0) {
  console.error(`Attachments (${attachments.length}):`);
  for (const att of attachments) {
    console.error(`  - ${att.filename} (${att.mimeType}, ${att.content.length} chars)`);
  }
}
console.error('---');

try {
  const result = await customInference(
    {
      agentName: values.agent,
      prompt,
      attachments: attachments.length > 0 ? attachments : undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
      overrides: {provider:"openrouter"}
    },
    { db }
  );

  if (values.output) {
    const outputPath = resolve(values.output);
    Bun.write(outputPath, result.response);
    console.error(`Response written to: ${outputPath}`);
  } else {
    console.log(result.response);
  }

  console.error('---');
  console.error(`Agent: ${result.agentName}@${result.agentVersion}`);
  console.error(`Provider: ${result.params.provider} / ${result.params.model}`);
  if (result.usage) {
    console.error(`Tokens: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens} total`);
  }
  if (result.costUsd !== undefined) {
    console.error(`Cost: $${result.costUsd.toFixed(6)}`);
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

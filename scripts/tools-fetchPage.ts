/**
 * Example: Using ToolsService.execute() to fetch a page
 *
 * Demonstrates how to use the ToolsService facade to execute tools.
 *
 * Run with: bun run examples/tools-fetchPage.ts
 */

import { ToolRegistry } from '../src/core/tools/registry.js';
import { ToolsService } from '../src/core/execution/tools.js';
import { getLogger } from '../src/util/logger.js';
import type { ToolContext } from '../src/core/tools/base.js';

async function main() {
  const logger = getLogger();

  // Create registry and service
  const registry = new ToolRegistry();
  const toolsService = new ToolsService(registry, [
    'bash',
    'webSearch',
    'fetchURLs',
    'glob',
    'grep',
    'edit',
    'sendWebhook',
  ]);

  // Build tool context
  const ctx: ToolContext = {
    logger: {
      debug: (msg, data) => logger.debug(msg, data),
      info: (msg, data) => logger.info(msg, data),
      warn: (msg, data) => logger.warn(msg, data),
      error: (msg, data) => logger.error(msg, data),
    },
  };

  console.log('Fetching page via ToolsService.execute()...\n');

  const result = await toolsService.execute(
    'fetchPage',
    {
      url: 'https://blog.cloudflare.com/markdown-for-agents/',
      timeout: 60000,
    },
    ctx
  );

  if (!result) {
    console.error('Failed to fetch page: tool execution returned null.');
    process.exit(1);
  }

  if (!result.success) {
    console.error('Failed to fetch page:');
    process.exit(1);
  }

  console.log('Page fetched successfully!');
  console.log(`  Status: ${result.status}`);
  console.log(`  Content-Type: ${result.contentType}`);
  console.log(`  Content-Length: ${result.contentLength}`);
  console.log(`  Truncated: ${result.truncated}`);
  console.log('\n--- Content (first 500 chars) ---');
  console.log(result.content.slice(0, 500));
}

main().catch(console.error);

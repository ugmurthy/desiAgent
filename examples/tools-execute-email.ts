/**
 * Example: Using ToolsService.execute() to send email
 *
 * Demonstrates how to use the ToolsService facade to execute tools.
 *
 * Run with: bun run examples/tools-execute-email.ts
 */

import { ToolRegistry } from '../src/core/tools/registry.js';
import { ToolsService } from '../src/core/execution/tools.js';
import { getLogger } from '../src/util/logger.js';
import type { ToolContext } from '../src/core/tools/base.js';

async function main() {
  const logger = getLogger();

  // Create registry and service
  const registry = new ToolRegistry();
  const toolsService = new ToolsService(registry);

  // Build tool context
  const ctx: ToolContext = {
    logger: {
      debug: (msg, data) => logger.debug(msg, data),
      info: (msg, data) => logger.info(msg, data),
      warn: (msg, data) => logger.warn(msg, data),
      error: (msg, data) => logger.error(msg, data),
    },
  };

  console.log('Sending email via ToolsService.execute()...\n');

  const result = await toolsService.execute(
    'sendEmail',
    {
      to: 'ugmurthy@gmail.com',
      subject: 'Testing tools',
      body: 'This is a test of sendEmail tool',
    },
    ctx
  );

  if (!result.success) {
    console.error('Failed to send email:');
    process.exit(1);
  }

  console.log('Email sent successfully!');
  console.log(`  Message ID: ${result.messageId}`);
  console.log(`  To: ${result.to}`);
  console.log(`  Subject: ${result.subject}`);
}

main().catch(console.error);

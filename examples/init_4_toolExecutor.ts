#!/usr/bin/env bun
/**
 * init_4_toolExecutor.ts — ToolExecutor constructor requires artifactsDir.
 *
 * Old: new ToolExecutor(registry)                    — defaulted to env / './artifacts'
 * New: new ToolExecutor(registry, artifactsDir)      — required
 *      new ToolExecutor(registry, artifactsDir, smtp, imap)  — optional smtp/imap
 *
 * Usage: bun run examples/init_4_toolExecutor.ts
 */

import { createToolRegistry, ToolExecutor } from '../src/core/tools/index.js';
import { initializeLogger } from '../src/util/logger.js';

initializeLogger('info');

const registry = createToolRegistry();

// ✅ artifactsDir is now required
const ARTIFACTS = '/tmp/my-artifacts';
const executor = new ToolExecutor(registry, ARTIFACTS);

console.log('Tools available:', executor.listTools().length);

// Helper to print tool results
function printResult(toolName: string, result: any) {
  const icon = result.status === 'success' ? '✅' : '❌';
  console.log(`\n${icon} ${toolName}:`);
  if (result.status === 'success') {
    console.log(JSON.stringify(result.output, null, 2));
  } else {
    console.log('Error:', result.error?.message);
  }
}

// ── 1. bash — run a shell command ──────────────────────────────────────
const bashResult = await executor.execute('bash', {
  command: 'echo "Hello from bash tool!" && date',
});
printResult('bash', bashResult);

// ── 2. writeFile — write content to artifacts dir ──────────────────────
const writeResult = await executor.execute('writeFile', {
  path: 'demo.txt',
  content: 'Line 1: Hello from writeFile tool\nLine 2: desiAgent demo\n',
  mode: 'overwrite',
});
printResult('writeFile', writeResult);

// ── 3. readFile — read the file we just wrote ──────────────────────────
const readResult = await executor.execute('readFile', {
  path: 'demo.txt',
});
printResult('readFile', readResult);

// ── 4. edit — replace text in an existing file ─────────────────────────
const editResult = await executor.execute('edit', {
  path: 'demo.txt',
  oldText: 'Line 2: desiAgent demo',
  newText: 'Line 2: desiAgent demo (edited!)',
});
printResult('edit', editResult);

// ── 5. glob — find files by pattern ────────────────────────────────────
const globResult = await executor.execute('glob', {
  pattern: '**/*.txt',
  ignore: ['node_modules/**', '.git/**'],
  limit: 10,
});
printResult('glob', globResult);

// ── 6. grep — search file contents ────────────────────────────────────
const grepResult = await executor.execute('grep', {
  pattern: 'desiAgent',
  path: 'demo.txt',
  caseSensitive: true,
  maxResults: 10,
});
printResult('grep', grepResult);

// ── 7. fetchPage — fetch a web page ───────────────────────────────────
const fetchResult = await executor.execute('fetchPage', {
  url: 'https://httpbin.org/get',
  maxLength: 2000,
  timeout: 10000,
});
printResult('fetchPage', fetchResult);

// ── 8. fetchURLs — fetch multiple URLs ────────────────────────────────
const fetchURLsResult = await executor.execute('fetchURLs', {
  urls: [
    'https://httpbin.org/ip',
    { url: 'https://httpbin.org/user-agent' },
  ],
});
printResult('fetchURLs', fetchURLsResult);

// ── 9. webSearch — search the web via DuckDuckGo ──────────────────────
const searchResult = await executor.execute('webSearch', {
  query: 'bun javascript runtime',
  limit: 3,
});
printResult('webSearch', searchResult);

// ── 10. sendWebhook — POST JSON to a webhook endpoint ─────────────────
const webhookResult = await executor.execute('sendWebhook', {
  url: 'https://httpbin.org/post',
  payload: { event: 'test', source: 'desiAgent' },
});
printResult('sendWebhook', webhookResult);

// ── 11. sendEmail — requires SMTP config (skipped without creds) ──────
// Uncomment after providing smtp config to ToolExecutor:
//
// const executor2 = new ToolExecutor(registry, ARTIFACTS, {
//   host: 'smtp.gmail.com', port: 587,
//   user: 'me@gmail.com', pass: 'app-password', from: 'me@gmail.com',
// }, {
//   host: 'imap.gmail.com', port: 993,
//   user: 'me@gmail.com', pass: 'app-password',
// });
//
// const emailResult = await executor2.execute('sendEmail', {
//   to: 'recipient@example.com',
//   subject: 'Test from desiAgent',
//   body: 'Hello from the sendEmail tool!',
// });
// printResult('sendEmail', emailResult);

// ── 12. readEmail — requires IMAP config (skipped without creds) ──────
// const readEmailResult = await executor2.execute('readEmail', {
//   maxResults: 5,
//   unreadOnly: true,
//   mailbox: 'Inbox',
//   snippets: true,
// });
// printResult('readEmail', readEmailResult);

console.log('\n🎉 All tool demos complete!');

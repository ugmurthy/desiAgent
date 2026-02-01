/**
 * Example: Read Emails from Gmail
 *
 * Reads the last 10 unread emails from a specific sender using IMAP.
 *
 * Run with: bun run examples/read-emails.ts
 */

import { ReadEmailTool } from '../src/core/tools/readEmail.js';
import { getLogger } from '../src/util/logger.js';

async function main() {
  const logger = getLogger();
  const readEmail = new ReadEmailTool();

  const ctx = {
    logger: {
      debug: (msg: any, data?: any) => logger.debug(msg, data),
      info: (msg: any, data?: any) => logger.info(msg, data),
      warn: (msg: any, data?: any) => logger.warn(msg, data),
      error: (msg: any, data?: any) => logger.error(msg, data),
    },
    emitEvent: {
      completed: (msg: string) => console.log(msg),
    },
  };

  console.log('Reading emails from james@jamesclear.com...\n');

  const result = await readEmail.execute(
    {
      sender: 'james@jamesclear.com',
      maxResults: 5,
      unreadOnly: true,
      
    },
    ctx
  );

  if (!result.success) {
    console.error('Failed to read emails:', result.error);
    process.exit(1);
  }

  console.log(`Found ${result.count} email(s):\n`);

  for (const email of result.emails) {
    console.log('─'.repeat(60));
    console.log(`email keys: ${Object.keys(email)}`)
    console.log(`From:    ${email.from}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Date:    ${email.date}`);
    console.log(`Read:    ${email.isRead ? 'Yes' : 'No'}`);
    if (email.snippet) {
      console.log(`Preview: ${email.snippet}`);
    }
    if (email.body) {
      console.log(`Body: ${email.body.length}`);
    }
    console.log('─'.repeat(60))
  }

  console.log('─'.repeat(60));
}

main().catch(console.error);

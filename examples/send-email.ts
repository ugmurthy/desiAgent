/**
 * Example: Send Email via SMTP
 *
 * Sends an email with optional CC and attachments.
 *
 * Run with: bun run examples/send-email.ts --to email1@example.com,email2@example.com --subject "Hello" --body body.txt --cc cc@example.com --attachments file1.pdf,file2.png
 */

import { parseArgs } from 'util';
import { readFileSync } from 'fs';
import { SendEmailTool } from '../src/core/tools/sendEmail.js';
import { getLogger } from '../src/util/logger.js';

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const { values } = parseArgs({
    options: {
      to: { type: 'string', short: 't' },
      subject: { type: 'string', short: 's' },
      body: { type: 'string', short: 'b' },
      cc: { type: 'string', short: 'c' },
      attachments: { type: 'string', short: 'a' },
      html: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (!values.to) {
    console.error('Usage: bun run examples/send-email.ts --to emails --subject "Subject" --body bodyfile.txt [--cc emails] [--attachments files]');
    console.error('\nRequired:');
    console.error('  --to, -t         Comma-separated recipient emails');
    console.error('  --subject, -s    Email subject');
    console.error('  --body, -b       Path to body file (text or HTML)');
    console.error('\nOptional:');
    console.error('  --cc, -c         Comma-separated CC emails');
    console.error('  --attachments, -a Comma-separated attachment file paths');
    console.error('  --html           Treat body as HTML');
    process.exit(1);
  }

  const toEmails = parseCommaSeparated(values.to);
  const ccEmails = parseCommaSeparated(values.cc);
  const attachmentPaths = parseCommaSeparated(values.attachments);

  if (toEmails.length === 0) {
    console.error('Error: At least one recipient email is required');
    process.exit(1);
  }

  if (!values.subject) {
    console.error('Error: Subject is required (--subject)');
    process.exit(1);
  }

  if (!values.body) {
    console.error('Error: Body file is required (--body)');
    process.exit(1);
  }

  let bodyContent: string;
  try {
    bodyContent = readFileSync(values.body, 'utf-8');
  } catch (err) {
    console.error(`Error reading body file: ${values.body}`);
    process.exit(1);
  }

  const attachments = attachmentPaths.map((filePath) => ({
    filename: filePath.split('/').pop() || filePath,
    path: filePath,
  }));

  const logger = getLogger();
  const sendEmail = new SendEmailTool();

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

  console.log('Sending email...');
  console.log(`  To: ${toEmails.join(', ')}`);
  if (ccEmails.length > 0) console.log(`  CC: ${ccEmails.join(', ')}`);
  console.log(`  Subject: ${values.subject}`);
  if (attachments.length > 0) console.log(`  Attachments: ${attachments.map((a) => a.filename).join(', ')}`);
  console.log('');

  // Send to first recipient, CC the rest if multiple recipients
  const primaryTo = toEmails[0];
  const additionalTo = toEmails.slice(1);
  const allCc = [...additionalTo, ...ccEmails];

  const result = await sendEmail.execute(
    {
      to: primaryTo,
      subject: values.subject,
      body: bodyContent,
      html: values.html,
      cc: allCc.length > 0 ? allCc : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    ctx
  );

  if (!result.success) {
    console.error('Failed to send email:', result.error);
    process.exit(1);
  }

  console.log('─'.repeat(60));
  console.log('Email sent successfully!');
  console.log(`  Message ID: ${result.messageId}`);
  console.log(`  To: ${result.to}`);
  console.log(`  Subject: ${result.subject}`);
  if (result.attachmentCount) {
    console.log(`  Attachments: ${result.attachmentCount}`);
  }
  console.log('─'.repeat(60));
}

main().catch(console.error);

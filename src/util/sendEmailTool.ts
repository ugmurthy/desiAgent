/**
 * sendEmailTool - Standalone function to send emails
 *
 * Wraps the sendEmail tool for direct usage without full desiAgent setup.
 */

import { z } from 'zod';
import { ToolRegistry } from '../core/tools/registry.js';
import { ToolsService } from '../core/execution/tools.js';
import { getLogger } from './logger.js';
import type { ToolContext } from '../core/tools/base.js';

const attachmentSchema = z.object({
  filename: z.string().describe('Display name for the attachment'),
  path: z.string().optional().describe('File path to attach (use this OR content, not both)'),
  content: z.string().optional().describe('Base64-encoded content or plain text (use this OR path, not both)'),
  contentType: z.string().optional().describe('MIME type (e.g., "application/pdf", "image/png")'),
  encoding: z.enum(['base64', 'utf-8']).optional().describe('Content encoding if using content field'),
});

export const SendEmailInputSchema = z.object({
  to: z.union([
    z.string().email(),
    z.array(z.string().email()),
  ]).describe('Recipient email address(es) - single email or array of emails'),
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Email body content (plain text or HTML)'),
  cc: z.union([
    z.string().email(),
    z.array(z.string().email()),
  ]).optional().describe('CC email address(es) - single email or array of emails'),
  bcc: z.union([
    z.string().email(),
    z.array(z.string().email()),
  ]).optional().describe('BCC email address(es) - single email or array of emails'),
  html: z.boolean().optional().default(false).describe('Whether body is HTML (default: false)'),
  attachments: z.array(attachmentSchema).optional().describe('File attachments'),
});

export type SendEmailInput = z.infer<typeof SendEmailInputSchema>;

export interface SendEmailOutput {
  success: boolean;
  messageId?: string;
  to: string | string[];
  subject: string;
  attachmentCount?: number;
  error?: string;
}

/**
 * Send an email using the sendEmail tool
 *
 * @param input - Email parameters (to, subject, body, cc, bcc, html, attachments)
 * @returns SendEmailOutput with success status and message details
 *
 * @example
 * ```typescript
 * import { sendEmailTool } from 'desiagent';
 *
 * const result = await sendEmailTool({
 *   to: 'recipient@example.com',
 *   subject: 'Hello',
 *   body: 'This is a test email',
 * });
 *
 * if (result.success) {
 *   console.log(`Email sent: ${result.messageId}`);
 * }
 * ```
 */
export async function sendEmailTool(input: SendEmailInput): Promise<SendEmailOutput> {
  const logger = getLogger();

  const registry = new ToolRegistry();
  const toolsService = new ToolsService(registry);

  const ctx: ToolContext = {
    logger: {
      debug: (msg, data) => logger.debug(data, msg),
      info: (msg, data) => logger.info(data, msg),
      warn: (msg, data) => logger.warn(data, msg),
      error: (msg, data) => logger.error(data, msg),
    },
  };

  const result = await toolsService.execute('sendEmail', input, ctx);

  return result as SendEmailOutput;
}

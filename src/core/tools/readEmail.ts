/**
 * Read Email Tool
 *
 * Read emails from Gmail via IMAP with filtering capabilities.
 * Uses the same credentials as sendEmail (app password).
 */

import { z } from 'zod';
import { ImapFlow } from 'imapflow';
import { BaseTool, type ToolContext } from './base.js';
import { simpleParser, type ParsedMail } from 'mailparser';

const readEmailInputSchema = z.object({
  maxResults: z.number().default(10).describe('Maximum number of emails to return'),
  unreadOnly: z.boolean().default(false).describe('Only fetch unread emails'),
  sender: z.string().optional().describe('Filter by sender email address'),
  search: z.string().optional().describe('Search string to match in subject or body'),
  mailbox: z.string().default('Inbox').describe('Mailbox to read from (default: INBOX)'),
  markAsRead: z.boolean().default(false).describe('Mark fetched emails as read'),
  snippets: z.boolean().default(false).describe('If true, include snippet instead of body'),
  remove_urls: z.boolean().default(true).describe('If true, strip URLs from body (only when snippets is false)'),
});

type ReadEmailInput = z.infer<typeof readEmailInputSchema>;

interface EmailMessage {
  uid: number;
  messageId?: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
  isRead: boolean;
  hasAttachments: boolean;
}

interface ReadEmailOutput {
  success: boolean;
  emails: EmailMessage[];
  count: number;
  mailbox: string;
  error?: string;
}

export class ReadEmailTool extends BaseTool<any, ReadEmailOutput> {
  name = 'readEmail';
  description = 'Read emails from Gmail via IMAP. Supports filtering by sender, unread status, and search terms.';
  inputSchema: any = readEmailInputSchema;

  private getImapConfig() {
    const host = process.env.IMAP_HOST || 'imap.gmail.com';
    const port = process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT, 10) : 993;
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;

    if (!user || !pass) {
      throw new Error(
        'Email configuration missing. Required env vars: IMAP_USER/SMTP_USER and IMAP_PASS/SMTP_PASS'
      );
    }

    return { host, port, user, pass };
  }

  private buildSearchCriteria(input: ReadEmailInput): any {
    const criteria: Record<string, any> = {};

    if (input.unreadOnly) {
      criteria.seen = false;
    }

    if (input.sender) {
      criteria.from = input.sender;
    }

    if (input.search) {
      criteria.or = [{ subject: input.search }, { body: input.search }];
    }

    if (Object.keys(criteria).length === 0) {
      return { all: true };
    }

    return criteria;
  }

  private truncateBody(text: string | undefined, maxLength = 200): string {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  }

  private stripUrls(text: string | undefined): string {
    if (!text) return '';
    return text.replace(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi, '');
  }

  async execute(rawInput: ReadEmailInput, ctx: ToolContext): Promise<ReadEmailOutput> {
    const input = readEmailInputSchema.parse(rawInput);
    ctx.logger.info(`Reading emails from ${input.mailbox} (max: ${input.maxResults})`);

    let client: ImapFlow | null = null;

    try {
      const config = this.getImapConfig();

      client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: true,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        logger: false,
      });

      await this.withTimeout(client.connect(), 30000, 'IMAP connection timed out');

      const lock = await client.getMailboxLock(input.mailbox);
      const emails: EmailMessage[] = [];

      try {
        const searchCriteria = this.buildSearchCriteria(input);
        ctx.logger.debug({ searchCriteria }, 'Search criteria');

        const searchResult = await client.search(searchCriteria, { uid: true });
        const messages: number[] = Array.isArray(searchResult) ? searchResult : [];

        if (messages.length === 0) {
          ctx.logger.info('No emails found matching criteria');
          return {
            success: true,
            emails: [],
            count: 0,
            mailbox: input.mailbox,
          };
        }

        const recentMessages = messages.slice(-input.maxResults).reverse();
        ctx.logger.info(`Found ${messages.length} emails, fetching ${recentMessages.length}`);
        ctx.logger.info(`snippets : ${input.snippets}, remove_urls: ${input.remove_urls}`)
        for (const uid of recentMessages) {
          const message = await client.fetchOne(
            uid,
            {
              uid: true,
              flags: true,
              envelope: true,
              source: true,
            },
            { uid: true }
          );

          if (!message) continue;

          let parsed: ParsedMail | null = null;
          if (message.source) {
            try {
              parsed = await simpleParser(message.source);
            } catch {
              ctx.logger.warn(`Failed to parse message ${uid}`);
            }
          }

          const fromAddress = message.envelope?.from?.[0];
          const toAddress = message.envelope?.to?.[0];

          const baseEmail: EmailMessage = {
            uid: message.uid,
            messageId: message.envelope?.messageId,
            from: fromAddress
              ? `${fromAddress.name || ''} <${fromAddress.address}>`.trim()
              : undefined,
            to: toAddress
              ? `${toAddress.name || ''} <${toAddress.address}>`.trim()
              : undefined,
            subject: message.envelope?.subject,
            date: message.envelope?.date?.toISOString(),
            isRead: message.flags?.has('\\Seen') ?? false,
            hasAttachments: (parsed?.attachments?.length ?? 0) > 0,
          };

          if (input.snippets) {
            baseEmail.snippet = this.truncateBody(parsed?.text);
          } else {
            const bodyText = parsed?.text;
            baseEmail.body = input.remove_urls ? this.stripUrls(bodyText) : bodyText;
          }

          emails.push(baseEmail);

          if (input.markAsRead && !message.flags?.has('\\Seen')) {
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      ctx.logger.info(`Successfully fetched ${emails.length} emails`);
      ctx.emitEvent?.completed?.(`📧 Read ${emails.length} email(s)`);

      return {
        success: true,
        emails,
        count: emails.length,
        mailbox: input.mailbox,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.logger.error({ err: error }, 'Failed to read emails');
      ctx.emitEvent?.completed?.(`❌ Failed to read emails: ${errorMessage}`);

      if (client) {
        try {
          await client.logout();
        } catch {
          // Ignore logout errors
        }
      }

      return {
        success: false,
        emails: [],
        count: 0,
        mailbox: input.mailbox,
        error: errorMessage,
      };
    }
  }
}

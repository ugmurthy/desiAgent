/**
 * Send Email Tool
 *
 * Send emails via SMTP with optional CC, BCC, and attachments
 */

import { z } from 'zod';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { BaseTool, type ToolContext } from './base.js';
import path from 'node:path';

const attachmentSchema = z.object({
  filename: z.string().describe('Display name for the attachment'),
  path: z.string().optional().describe('File path to attach (use this OR content, not both)'),
  content: z.string().optional().describe('Base64-encoded content or plain text (use this OR path, not both)'),
  contentType: z.string().optional().describe('MIME type (e.g., "application/pdf", "image/png")'),
  encoding: z.enum(['base64', 'utf-8']).optional().describe('Content encoding if using content field'),
});

const sendEmailInputSchema = z.object({
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

type SendEmailInput = z.infer<typeof sendEmailInputSchema>;

interface SendEmailOutput {
  success: boolean;
  messageId?: string;
  to: string | string[];
  subject: string;
  attachmentCount?: number;
  error?: string;
}

export class SendEmailTool extends BaseTool<any, SendEmailOutput> {
  name = 'sendEmail';
  description = 'Send an email via SMTP with optional CC, BCC, and attachments. Requires SMTP configuration in environment variables.';
  inputSchema: any = sendEmailInputSchema;

  private transporter: Transporter | null = null;
  
  private resolveAttachmentPath(filePath: string, ctx: ToolContext): string {
    return path.resolve(ctx.artifactsDir, path.basename(filePath));
  }

  private getTransporter(ctx: ToolContext): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const smtp = ctx.smtp;
    if (!smtp?.host || !smtp?.user || !smtp?.pass || !smtp?.from) {
      throw new Error(
        'SMTP configuration missing. Provide smtp config via setupDesiAgent.'
      );
    }

    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    return this.transporter;
  }

  private normalizeEmailList(emails: string | string[] | undefined): string | undefined {
    if (!emails) return undefined;
    if (Array.isArray(emails)) {
      return emails.join(', ');
    }
    return emails;
  }

  async execute(input: SendEmailInput, ctx: ToolContext): Promise<SendEmailOutput> {
    ctx.logger.info(`Sending email to: ${input.to}`);

    try {
      const transporter = this.getTransporter(ctx);
      const from = ctx.smtp?.from;

      const mailOptions: nodemailer.SendMailOptions = {
        from,
        to: this.normalizeEmailList(input.to),
        subject: input.subject,
      };

      if (input.html) {
        mailOptions.html = input.body;
      } else {
        mailOptions.text = input.body;
      }

      const cc = this.normalizeEmailList(input.cc);
      if (cc) {
        mailOptions.cc = cc;
      }

      const bcc = this.normalizeEmailList(input.bcc);
      if (bcc) {
        mailOptions.bcc = bcc;
      }

      if (input.attachments && input.attachments.length > 0) {
        mailOptions.attachments = input.attachments.map((att) => ({
          filename: att.filename,
          path: att.path ? this.resolveAttachmentPath(att.path, ctx) : undefined,
          content: att.content,
          contentType: att.contentType,
          encoding: att.encoding as 'base64' | undefined,
        }));
        ctx.logger.info(`Adding ${input.attachments.length} attachment(s)`);
      }

      const result: any = await this.retry(
        async () => {
          return await this.withTimeout(
            transporter.sendMail(mailOptions),
            30000,
            'Email send timed out'
          );
        },
        3,
        2000
      );

      ctx.logger.info(`Email sent successfully. Message ID: ${result.messageId}`);
      ctx.emitEvent?.completed?.(`✉️ Email sent`);
      
      return {
        success: true,
        messageId: result.messageId,
        to: input.to,
        subject: input.subject,
        attachmentCount: input.attachments?.length ?? 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.logger.error({ err: error }, 'Email send failed');
      ctx.emitEvent?.completed?.(`❌ Failed to send email: ${errorMessage}`);
      
      return {
        success: false,
        to: input.to,
        subject: input.subject,
        error: errorMessage,
      };
    }
  }
}

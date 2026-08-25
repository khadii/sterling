import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import SMTPPool from 'nodemailer/lib/smtp-pool';

export type SendMailOptions = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
};

export interface MailProvider {
  send(options: SendMailOptions): Promise<{ messageId: string }>;
}

@Injectable()
export class MailService implements MailProvider {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter<SMTPPool.SentMessageInfo>;
  private readonly maxRetries: number;

  constructor(private readonly config: ConfigService) {
    this.maxRetries = config.get<number>('MAIL_MAX_RETRIES', 2);
    const host = config.get<string>('SMTP_HOST');
    if (host) {
      const user = config.get<string>('SMTP_USER');
      this.transporter = nodemailer.createTransport({
        host,
        port: config.get<number>('SMTP_PORT', 587),
        secure: config.get<boolean>('SMTP_SECURE', false),
        auth: user
          ? { user, pass: config.get<string>('SMTP_PASSWORD') }
          : undefined,
        pool: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
  }

  async send(options: SendMailOptions): Promise<{ messageId: string }> {
    if (!this.transporter)
      throw new ServiceUnavailableException(
        'Application mail provider is not configured',
      );
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const result = await this.transporter.sendMail({
          from: this.config.getOrThrow<string>('MAIL_FROM'),
          ...options,
        });
        return { messageId: String(result.messageId) };
      } catch (error) {
        lastError = error;
        this.logger.warn(`Mail delivery attempt ${attempt + 1} failed`);
        if (attempt < this.maxRetries)
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** attempt),
          );
      }
    }
    this.logger.error(
      'Mail delivery failed after all retry attempts',
      lastError instanceof Error ? lastError.stack : undefined,
    );
    throw new ServiceUnavailableException(
      'Application mail provider is temporarily unavailable',
    );
  }
}

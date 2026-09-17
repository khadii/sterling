import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { MailService } from '../mail/mail.service';
import {
  NotificationPreferencesDto,
  OrganizationInvitationDto,
} from './notification.dto';

type Delivery = {
  id: string;
  lease_id: string;
  organization_id: string;
  recipient_id: string | null;
  recipient_email: string | null;
  subject: string;
  body: string;
  kind: string;
  category: string;
  payload: { token?: string; delivery?: string };
};
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}
  async rpc<T = unknown>(name: string, args: object = {}): Promise<T> {
    const { data, error } = await this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(10000));
    if (error?.code === 'P0002')
      throw new NotFoundException('Resource not found');
    if (error) throw mapDatabaseError(error, 'process notification request');
    return data;
  }
  async preferences(userId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('notification_preferences')
      .select('activity_email,reminders')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load notification preferences');
    return {
      activityEmail:
        (data as { activity_email: string } | null)?.activity_email ??
        'immediate',
      reminders: (data as { reminders: boolean } | null)?.reminders ?? true,
    };
  }
  async updatePreferences(userId: string, dto: NotificationPreferencesDto) {
    await this.rpc('set_notification_preferences', {
      p_user: userId,
      p_activity: dto.activityEmail ?? null,
      p_reminders: dto.reminders ?? null,
    });
    return this.preferences(userId);
  }
  async invite(actor: string, org: string, dto: OrganizationInvitationDto) {
    this.frontendUrl(); // Fail before creating unusable invitations when deployment config is missing.
    const token = randomBytes(32).toString('hex');
    return this.rpc('create_organization_invitation', {
      p_actor: actor,
      p_org: org,
      p_email: dto.email,
      p_roles: dto.roleIds,
      p_department: dto.departmentId ?? null,
      p_hash: this.hash(token),
      p_token: token,
    });
  }
  accept(actor: string, token: string) {
    return this.rpc('accept_organization_invitation', {
      p_actor: actor,
      p_hash: this.hash(token),
    });
  }
  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private frontendUrl() {
    const value = this.config.get<string>('NOTIFICATION_FRONTEND_URL');
    if (!value)
      throw new ServiceUnavailableException(
        'Notification frontend URL is not configured',
      );
    return new URL(value);
  }
  async changeMember(args: object) {
    const row = await this.rpc<Record<string, unknown>>(
      'change_workspace_member',
      args,
    );
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_match, c: string) => c.toUpperCase()),
        value,
      ]),
    );
  }
  async health() {
    const counts = await this.rpc<Record<string, unknown>>(
      'notification_health',
    );
    return {
      ...counts,
      smtpConfigured: Boolean(this.config.get('SMTP_HOST')),
      frontendConfigured: Boolean(this.config.get('NOTIFICATION_FRONTEND_URL')),
    };
  }
  async process() {
    const frontend = this.frontendUrl();
    if (!this.config.get<string>('SMTP_HOST'))
      throw new ServiceUnavailableException(
        'Application SMTP is not configured',
      );
    await this.rpc('queue_notification_reminders');
    await this.rpc('prune_notification_history');
    const jobs = await this.rpc<Delivery[]>('claim_notification_emails', {
      p_limit: 5,
    });
    // A fixed-size batch bounds each serverless invocation. SMTP retries belong to the durable outbox.
    const groups = new Map<string, Delivery[]>();
    for (const job of jobs) {
      const key =
        job.category === 'activity' && job.payload.delivery === 'daily'
          ? `${job.organization_id}:${job.recipient_id}`
          : job.id;
      groups.set(key, [...(groups.get(key) ?? []), job]);
    }
    const results = await Promise.all(
      [...groups.values()].map(async (batch) => {
        const job = batch[0];
        try {
          let to = job.recipient_email;
          if (job.recipient_id) {
            const { data, error } =
              await this.supabase.adminClient.auth.admin.getUserById(
                job.recipient_id,
              );
            if (error || !data.user?.email || !data.user.email_confirmed_at)
              throw new Error('Verified recipient unavailable');
            to = data.user.email;
          }
          if (!to) throw new Error('Recipient unavailable');
          const url = new URL(frontend);
          url.searchParams.set('organizationId', job.organization_id);
          if (job.kind === 'organization.invited') {
            if (!job.payload.token)
              throw new Error('Invitation token unavailable');
            // Fragment avoids tokens appearing in web-server access logs. The frontend consumes it after login.
            url.hash = new URLSearchParams({
              invitationToken: job.payload.token,
            }).toString();
          }
          const { data: org, error } = await this.supabase.adminClient
            .from('organizations')
            .select('name')
            .eq('id', job.organization_id)
            .single();
          if (error) throw new Error('Workspace unavailable');
          const text = `${(org as unknown as { name: string }).name}\n\n${batch.map((item) => item.body).join('\n\n')}\n\nOpen workspace: ${url.toString()}\n\nManage routine email preferences in your account.`;
          await this.mail.send(
            {
              to,
              subject:
                batch.length > 1
                  ? 'Your workspace activity summary'
                  : job.subject,
              text,
            },
            0,
          );
          for (const item of batch) {
            const recorded = await this.rpc<boolean>(
              'finish_notification_email',
              { p_id: item.id, p_lease: item.lease_id, p_success: true },
            );
            if (!recorded) throw new Error('Delivery lease expired');
          }
          return { sent: batch.length, retryOrFailed: 0 };
        } catch {
          // Never log addresses, invitation tokens, message bodies or SMTP credentials.
          this.logger.warn(`Notification delivery failed: ${job.id}`);
          for (const item of batch)
            await this.rpc('finish_notification_email', {
              p_id: item.id,
              p_lease: item.lease_id,
              p_success: false,
            });
          return { sent: 0, retryOrFailed: batch.length };
        }
      }),
    );
    return {
      processed: jobs.length,
      sent: results.reduce((sum, result) => sum + result.sent, 0),
      retryOrFailed: results.reduce(
        (sum, result) => sum + result.retryOrFailed,
        0,
      ),
    };
  }
}

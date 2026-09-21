import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HrService } from './hr.service';

interface ZoomConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostUserId: string;
}
@Injectable()
export class ZoomService {
  constructor(
    private readonly config: ConfigService,
    private readonly hr: HrService,
  ) {}
  private settings(org: string): ZoomConfig {
    try {
      const settings = JSON.parse(
        this.config.get<string>('ZOOM_WORKSPACES_JSON') ?? '{}',
      ) as Record<string, ZoomConfig>;
      const value = settings[org];
      if (
        value &&
        ['accountId', 'clientId', 'clientSecret', 'hostUserId'].every(
          (k) =>
            typeof value[k as keyof ZoomConfig] === 'string' &&
            value[k as keyof ZoomConfig].length > 0,
        )
      )
        return value;
    } catch {
      /* Return the same safe configuration error without exposing credentials. */
    }
    throw new ServiceUnavailableException(
      'Zoom is not configured for this workspace',
    );
  }
  async create(actor: string, org: string, eventId: string) {
    await this.hr.rpc('hr_require', {
      p_actor: actor,
      p_org: org,
      p_permission: 'calendar.manage',
    });
    const cfg = this.settings(org);
    // Get a token before claiming; an authentication failure cannot create a meeting.
    let token: string;
    try {
      const response = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'account_credentials',
          account_id: cfg.accountId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Zoom authentication failed');
      const data = (await response.json()) as { access_token?: string };
      if (!data.access_token) throw new Error('Missing access token');
      token = data.access_token;
    } catch {
      throw new ServiceUnavailableException('Unable to authenticate with Zoom');
    }
    const event = await this.hr.rpc<{
      existingUrl?: string;
      title: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
    }>('hr_claim_zoom', { p_actor: actor, p_org: org, p_event: eventId });
    if (event.existingUrl) return { eventId, meetingUrl: event.existingUrl };
    // The claim remains on an ambiguous failure. Blind retries could create duplicate meetings.
    try {
      const response = await fetch(
        `https://api.zoom.us/v2/users/${encodeURIComponent(cfg.hostUserId)}/meetings`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic: event.title,
            type: 2,
            start_time: event.startsAt,
            duration: Math.ceil(
              (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60000,
            ),
            timezone: event.timezone,
            settings: { waiting_room: true, join_before_host: false },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error('Zoom meeting request failed');
      const meeting = (await response.json()) as {
        id?: number;
        join_url?: string;
      };
      if (
        !meeting.id ||
        !meeting.join_url ||
        new URL(meeting.join_url).protocol !== 'https:'
      )
        throw new Error('Invalid Zoom response');
      return await this.hr.rpc('hr_finish_zoom', {
        p_actor: actor,
        p_org: org,
        p_event: eventId,
        p_meeting: String(meeting.id),
        p_url: meeting.join_url,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Meeting creation could not be confirmed. Check Zoom and the event before retrying; the request is retained to prevent duplicates.',
      );
    }
  }
}

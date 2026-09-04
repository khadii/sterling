import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import {
  ActivityQueryDto,
  CalendarQueryDto,
  CalendarSummaryQueryDto,
  CreateCalendarEventDto,
  CreateDepartmentDto,
  DepartmentQueryDto,
  UpdateCalendarEventDto,
} from './dto/employer-workspace.dto';

type Row = Record<string, unknown>;

@Injectable()
export class EmployerWorkspaceService {
  constructor(private readonly supabase: SupabaseService) {}

  async dashboard(userId: string, organizationId: string) {
    const membership = await this.requireAccess(
      userId,
      organizationId,
      'workspace.view',
    );
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 86_400_000);
    const [activities, events, departments] = await Promise.all([
      this.activities(userId, { organizationId, limit: 5 }),
      this.calendarEvents(userId, {
        organizationId,
        from: now.toISOString(),
        to: inSevenDays.toISOString(),
      }),
      this.departments(userId, { organizationId } as DepartmentQueryDto),
    ]);
    return {
      organization: membership.organization,
      timezone: membership.timezone,
      asOf: now.toISOString(),
      summary: {
        departments: departments.summary.totalDepartments,
        headcount: null,
        openRoles: null,
        onLeaveToday: null,
      },
      todaysActivity: activities,
      upcomingEvents: events,
      departmentOverview: departments,
      unavailableMetrics: ['headcount', 'openRoles', 'onLeaveToday'],
    };
  }

  async activities(userId: string, query: ActivityQueryDto) {
    await this.requireAccess(userId, query.organizationId, 'activity.view');
    let request = this.supabase.adminClient
      .from('organization_activities')
      .select('*')
      .eq('organization_id', query.organizationId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(query.limit + 1);
    if (query.from) request = request.gte('occurred_at', query.from);
    if (query.to) request = request.lt('occurred_at', query.to);
    if (query.category) request = request.eq('category', query.category);
    if (query.search) {
      const safeSearch = query.search.replace(/[\\%_]/g, '\\$&');
      request = request.ilike('title', `%${safeSearch}%`);
    }
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    if (cursor) {
      request = request.or(
        `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await request;
    if (error) throw mapDatabaseError(error, 'load organization activities');
    const rows = (data ?? []) as Row[];
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => this.activityResponse(row)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor(String(last.occurred_at), String(last.id))
          : null,
    };
  }

  async calendarSummary(userId: string, query: CalendarSummaryQueryDto) {
    const membership = await this.requireAccess(
      userId,
      query.organizationId,
      'calendar.view',
    );
    const localDate =
      query.date?.slice(0, 10) ??
      this.localDate(new Date(), membership.timezone);
    const from = this.localMidnightUtc(localDate, membership.timezone);
    const tomorrow = new Date(`${localDate}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const toDate = tomorrow.toISOString().slice(0, 10);
    const to = this.localMidnightUtc(toDate, membership.timezone);
    const { data, error } = await this.supabase.adminClient
      .from('calendar_events')
      .select('kind')
      .eq('organization_id', query.organizationId)
      .lt('starts_at', to)
      .gt('ends_at', from);
    if (error) throw mapDatabaseError(error, 'load calendar summary');
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Row[]) {
      const kind = String(row.kind);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return { date: localDate, timezone: membership.timezone, counts };
  }

  async calendarEvents(userId: string, query: CalendarQueryDto) {
    await this.requireAccess(userId, query.organizationId, 'calendar.view');
    this.assertDateRange(query.from, query.to, 370);
    let request = this.supabase.adminClient
      .from('calendar_events')
      .select('*')
      .eq('organization_id', query.organizationId)
      .lt('starts_at', query.to)
      .gt('ends_at', query.from)
      .order('starts_at');
    if (query.kinds?.length) request = request.in('kind', query.kinds);
    const { data, error } = await request;
    if (error) throw mapDatabaseError(error, 'load calendar events');
    return {
      items: ((data ?? []) as Row[]).map((row) => this.eventResponse(row)),
    };
  }

  async calendarEvent(userId: string, eventId: string, organizationId: string) {
    await this.requireAccess(userId, organizationId, 'calendar.view');
    const row = await this.getEvent(eventId, organizationId);
    return this.eventResponse(row);
  }

  async createCalendarEvent(userId: string, dto: CreateCalendarEventDto) {
    await this.requireAccess(userId, dto.organizationId, 'calendar.manage');
    this.assertDateRange(dto.startsAt, dto.endsAt, 366);
    await this.requireAttendeeMembership(
      dto.organizationId,
      dto.attendees.map((item) => item.userId),
    );
    const { data, error } = await this.supabase.adminClient
      .from('calendar_events')
      .insert({
        organization_id: dto.organizationId,
        kind: dto.kind,
        source: 'manual',
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        starts_at: dto.startsAt,
        ends_at: dto.endsAt,
        timezone: dto.timezone,
        all_day: dto.allDay,
        location: dto.location?.trim() || null,
        meeting_url: dto.meetingUrl ?? null,
        organizer_id: userId,
        attendees: dto.attendees,
        created_by: userId,
      } as never)
      .select('*')
      .single();
    if (error) throw mapDatabaseError(error, 'create calendar event');
    return this.eventResponse(data);
  }

  async updateCalendarEvent(
    userId: string,
    eventId: string,
    dto: UpdateCalendarEventDto,
  ) {
    await this.requireAccess(userId, dto.organizationId, 'calendar.manage');
    const existing = await this.getEvent(eventId, dto.organizationId);
    if (existing.source !== 'manual') {
      throw new ForbiddenException(
        'Source-generated events must be updated in their source workflow',
      );
    }
    const startsAt = dto.startsAt ?? String(existing.starts_at);
    const endsAt = dto.endsAt ?? String(existing.ends_at);
    this.assertDateRange(startsAt, endsAt, 366);
    if (dto.attendees) {
      await this.requireAttendeeMembership(
        dto.organizationId,
        dto.attendees.map((item) => item.userId),
      );
    }
    const values: Row = {};
    if (dto.kind !== undefined) values.kind = dto.kind;
    if (dto.title !== undefined) values.title = dto.title.trim();
    if (dto.description !== undefined)
      values.description = dto.description.trim() || null;
    if (dto.startsAt !== undefined) values.starts_at = dto.startsAt;
    if (dto.endsAt !== undefined) values.ends_at = dto.endsAt;
    if (dto.timezone !== undefined) values.timezone = dto.timezone;
    if (dto.allDay !== undefined) values.all_day = dto.allDay;
    if (dto.location !== undefined)
      values.location = dto.location.trim() || null;
    if (dto.meetingUrl !== undefined) values.meeting_url = dto.meetingUrl;
    if (dto.attendees !== undefined) values.attendees = dto.attendees;
    if (!Object.keys(values).length) return this.eventResponse(existing);
    const { data, error } = await this.supabase.adminClient
      .from('calendar_events')
      .update(values as never)
      .eq('id', eventId)
      .eq('organization_id', dto.organizationId)
      .select('*')
      .single();
    if (error) throw mapDatabaseError(error, 'update calendar event');
    return this.eventResponse(data);
  }

  async deleteCalendarEvent(
    userId: string,
    eventId: string,
    organizationId: string,
  ) {
    await this.requireAccess(userId, organizationId, 'calendar.manage');
    const existing = await this.getEvent(eventId, organizationId);
    if (existing.source !== 'manual') {
      throw new ForbiddenException(
        'Source-generated events must be deleted in their source workflow',
      );
    }
    const { error } = await this.supabase.adminClient
      .from('calendar_events')
      .delete()
      .eq('id', eventId)
      .eq('organization_id', organizationId);
    if (error) throw mapDatabaseError(error, 'delete calendar event');
  }

  async departments(userId: string, query: DepartmentQueryDto) {
    await this.requireAccess(userId, query.organizationId, 'workspace.view');
    let request = this.supabase.adminClient
      .from('departments')
      .select('*, icon:department_icons(id,name,builtin_key,storage_path)')
      .eq('organization_id', query.organizationId)
      .order('display_order')
      .order('name');
    if (!query.includeArchived) request = request.eq('is_archived', false);
    if (query.search) {
      const safeSearch = query.search.replace(/[\\%_]/g, '\\$&');
      request = request.ilike('name', `%${safeSearch}%`);
    }
    const { data, error } = await request;
    if (error) throw mapDatabaseError(error, 'load departments');
    const items = ((data ?? []) as Row[]).map((row) =>
      this.departmentResponse(row),
    );
    return {
      summary: {
        totalDepartments: items.length,
        totalHeadcount: null,
        totalSubteams: null,
      },
      items,
      unavailableMetrics: [
        'headcount',
        'subteams',
        'health',
        'capacity',
        'attendance',
      ],
    };
  }

  async department(
    userId: string,
    departmentId: string,
    organizationId: string,
  ) {
    await this.requireAccess(userId, organizationId, 'workspace.view');
    const { data, error } = await this.supabase.adminClient
      .from('departments')
      .select('*, icon:department_icons(id,name,builtin_key,storage_path)')
      .eq('id', departmentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load department');
    if (!data) throw new NotFoundException('Department not found');
    return {
      ...this.departmentResponse(data),
      metrics: { headcount: null, openRoles: null, subteams: null },
      unavailableMetrics: ['headcount', 'openRoles', 'subteams', 'capacity'],
    };
  }

  async createDepartment(userId: string, dto: CreateDepartmentDto) {
    await this.requireAccess(userId, dto.organizationId, 'departments.manage');
    let iconId = dto.iconId;
    if (iconId) {
      const { data } = await this.supabase.adminClient
        .from('department_icons')
        .select('id')
        .eq('id', iconId)
        .eq('is_active', true)
        .maybeSingle();
      if (!data)
        throw new BadRequestException('Department icon is not available');
    } else {
      const { data, error } = await this.supabase.adminClient
        .from('department_icons')
        .select('id')
        .eq('is_default', true)
        .single();
      if (error) throw mapDatabaseError(error, 'load default department icon');
      iconId = String((data as Row).id);
    }
    const { data, error } = await this.supabase.adminClient
      .from('departments')
      .insert({
        organization_id: dto.organizationId,
        name: dto.name,
        description: dto.description?.trim() || null,
        icon_id: iconId,
      } as never)
      .select('*, icon:department_icons(id,name,builtin_key,storage_path)')
      .single();
    if (error) throw mapDatabaseError(error, 'create department');
    return this.departmentResponse(data);
  }

  private async requireAccess(
    userId: string,
    organizationId: string,
    permission: string,
  ) {
    const { data: member, error } = await this.supabase.adminClient
      .from('organization_members')
      .select(
        'organization:organizations(id,name), settings:organization_settings(timezone)',
      )
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'verify organization membership');
    if (!member)
      throw new ForbiddenException('Organization access is not permitted');
    const { data: memberRoles, error: memberRolesError } =
      await this.supabase.adminClient
        .from('organization_member_roles')
        .select('organization_role_id')
        .eq('organization_id', organizationId)
        .eq('user_id', userId);
    if (memberRolesError)
      throw mapDatabaseError(
        memberRolesError,
        'verify organization permission',
      );
    const roleIds = (
      (memberRoles ?? []) as unknown as { organization_role_id: string }[]
    ).map((role) => role.organization_role_id);
    if (!roleIds.length)
      throw new ForbiddenException(
        `Organization permission required: ${permission}`,
      );
    const { data: grants, error: grantsError } = await this.supabase.adminClient
      .from('organization_role_permissions')
      .select('permission_id')
      .in('organization_role_id', roleIds)
      .eq('permission_id', permission)
      .limit(1);
    if (grantsError)
      throw mapDatabaseError(grantsError, 'verify organization permission');
    if (!grants?.length)
      throw new ForbiddenException(
        `Organization permission required: ${permission}`,
      );
    const row = member as unknown as {
      organization: Row;
      settings: Row | Row[];
    };
    const settings = Array.isArray(row.settings)
      ? row.settings[0]
      : row.settings;
    const timezone = settings?.timezone;
    return {
      organization: row.organization,
      timezone: typeof timezone === 'string' ? timezone : 'UTC',
    };
  }

  private async requireAttendeeMembership(
    organizationId: string,
    ids: string[],
  ) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const { data, error } = await this.supabase.adminClient
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('user_id', unique);
    if (error) throw mapDatabaseError(error, 'validate event attendees');
    if ((data?.length ?? 0) !== unique.length) {
      throw new BadRequestException(
        'Every attendee must be an organization member',
      );
    }
  }

  private async getEvent(
    eventId: string,
    organizationId: string,
  ): Promise<Row> {
    const { data, error } = await this.supabase.adminClient
      .from('calendar_events')
      .select('*')
      .eq('id', eventId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load calendar event');
    if (!data) throw new NotFoundException('Calendar event not found');
    return data;
  }

  private assertDateRange(from: string, to: string, maxDays: number) {
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new BadRequestException(
        'The end date must be after the start date',
      );
    }
    if (end - start > maxDays * 86_400_000) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days`);
    }
  }

  private encodeCursor(occurredAt: string, id: string) {
    return Buffer.from(JSON.stringify({ occurredAt, id })).toString(
      'base64url',
    );
  }

  private decodeCursor(value: string): { occurredAt: string; id: string } {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString(),
      ) as Record<string, unknown>;
      if (
        typeof parsed.occurredAt !== 'string' ||
        !Number.isFinite(Date.parse(parsed.occurredAt)) ||
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.id)
      )
        throw new Error('invalid');
      return { occurredAt: parsed.occurredAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid activity cursor');
    }
  }

  private localDate(date: Date, timezone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private localMidnightUtc(date: string, timezone: string) {
    const candidate = new Date(`${date}T00:00:00.000Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(candidate);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      +values.year,
      +values.month - 1,
      +values.day,
      +values.hour % 24,
      +values.minute,
      +values.second,
    );
    return new Date(
      candidate.getTime() - (represented - candidate.getTime()),
    ).toISOString();
  }

  private eventResponse(row: Row) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      kind: row.kind,
      source: row.source,
      sourceId: row.source_id,
      title: row.title,
      description: row.description,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      allDay: row.all_day,
      location: row.location,
      meetingUrl: row.meeting_url,
      organizerId: row.organizer_id,
      attendees: row.attendees,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private activityResponse(row: Row) {
    return {
      id: row.id,
      category: row.category,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
      subject: row.subject_type
        ? { type: row.subject_type, id: row.subject_id }
        : null,
      urgency: row.urgency,
      availableActions: row.available_actions,
    };
  }

  private departmentResponse(row: Row) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      displayOrder: row.display_order,
      archived: row.is_archived,
      icon: row.icon,
      createdAt: row.created_at,
    };
  }
}

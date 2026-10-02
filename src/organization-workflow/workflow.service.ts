import { enrichReadRows } from '../common/read-relations';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { withRequestDeadline } from '../supabase/request-timeout';
import { WorkflowQueryDto } from './workflow.dto';

type Row = Record<string, unknown>;
export type Entity = 'roles' | 'teams' | 'projects' | 'tasks';
const tables: Record<Entity, string> = {
  roles: 'organization_roles',
  teams: 'organization_teams',
  projects: 'organization_projects',
  tasks: 'organization_tasks',
};
const ownerOnlyPermissions = new Set([
  'workspace.delete',
  'workspace.transfer',
  'billing.manage',
]);
const permissionGroupOf = (id: string): string => {
  const [domain] = id.split('.');
  switch (domain) {
    case 'workspace':
    case 'activity':
    case 'audit_log':
      return 'Workspace';
    case 'billing':
      return 'Billing';
    case 'members':
    case 'roles':
      return 'Members & Access';
    case 'departments':
    case 'department_icons':
      return 'Organisation';
    case 'employees':
    case 'documents':
      return 'People';
    case 'teams':
    case 'projects':
    case 'tasks':
    case 'calendar':
      return 'Teams & Work';
    case 'attendance':
    case 'leave':
      return 'Attendance & Leave';
    case 'payroll':
    case 'expenses':
      return 'Payroll & Expenses';
    case 'performance':
      return 'Performance';
    default:
      return 'Recruitment';
  }
};
const permissionNameOf = (id: string): string => {
  const [domain = '', verb = '', ...rest] = id.split('.');
  const [action, ...details] = [verb, ...rest].join('.').split('_');
  const subject = [details.join(' '), domain.replace(/_/g, ' ')]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!action) return subject;
  const actionWord = action.charAt(0).toUpperCase() + action.slice(1);
  return action === 'participate'
    ? `Participate in ${subject}`
    : `${actionWord} ${subject}`;
};

@Injectable()
export class WorkflowService {
  constructor(private readonly supabase: SupabaseService) {}

  organization(userId: string, requested?: string, legacy?: string) {
    return resolveOrganization(this.supabase, userId, requested, legacy);
  }

  async access(userId: string, org: string, permission: string) {
    const { data, error } = await this.supabase.adminClient
      .rpc('workflow_has_permission', {
        p_actor: userId,
        p_org: org,
        p_permission: permission,
      } as never)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'verify workflow permission');
    if (!data)
      throw new ForbiddenException(`Permission required: ${permission}`);
  }

  async mutate(
    userId: string,
    org: string,
    action: string,
    id: string | null,
    data: object,
  ) {
    // Transformed DTOs can own optional fields whose value is undefined.
    // Match JSON semantics before deciding which fields the caller supplied.
    data = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    this.validateNulls(data);
    const roleWrite = action === 'role.save' || action === 'role.permissions';

    if (action === 'role.save' && Object.hasOwn(data, 'iconId')) {
      const iconId = (data as Row).iconId;
      if (iconId !== null) {
        if (typeof iconId !== 'string')
          throw new BadRequestException('Invalid role icon ID');
        await this.validateRoleIcon(iconId);
      }
    }
    const { data: result, error } = await this.supabase.adminClient
      .rpc('workflow_mutate', {
        p_actor: userId,
        p_org: org,
        p_action: action,
        p_id: id,
        p_data: data,
      } as never)
      .abortSignal(AbortSignal.timeout(15000));
    if (error && ['PT409', '40001'].includes(error.code) && roleWrite) {
      if (!id) {
        // Creation has no existing revision. Do not mislabel a transaction conflict.
        throw new ConflictException({
          message:
            'Role creation conflicted with another operation. Reload the role list to check whether it was created before submitting again.',
          error: 'Conflict',
          code: 'ROLE_CREATION_CONFLICT',
        });
      }
      let currentRevision: number | null = null;
      // This specific guard runs only after the RPC authorizes roles.manage.
      if (
        error.code === 'PT409' &&
        error.message ===
          'Membership or permissions changed; reload before saving'
      ) {
        try {
          const current = await withRequestDeadline(
            this.supabase.adminClient
              .from('organization_roles')
              .select('revision')
              .eq('organization_id', org)
              .eq('id', id)
              .abortSignal(AbortSignal.timeout(3000))
              .maybeSingle(),
            3000,
          );
          const row = current.data as { revision?: number } | null;
          if (!current.error && Number.isInteger(row?.revision))
            currentRevision = row!.revision!;
        } catch {
          // Preserve the original conflict if the optional revision lookup fails.
        }
      }
      throw new ConflictException({
        message:
          'Role changed since this form was loaded. Reload the role for its latest state and retry; expectedRevision is optional and can be omitted to save directly.',
        error: 'Conflict',
        code: 'ROLE_REVISION_CONFLICT',
        details: {
          roleId: id,
          expectedRevision: (data as Row).expectedRevision ?? null,
          currentRevision,
          reloadUrl: '/api/v1/organization/roles/' + id,
        },
      });
    }
    if (error?.code === 'P0002')
      throw new NotFoundException('Resource not found in this workspace');
    if (error && error.code === '22023') {
      // Preserve the specific validation reason the SQL function raised,
      // e.g. which required fields block activating a department role.
      throw new BadRequestException(
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Invalid workflow data: check required fields, ranges, references and role status',
      );
    }
    if (
      error &&
      ['23514', '23502', '22P02', '22007', '22008'].includes(error.code)
    )
      throw new BadRequestException(
        'Invalid workflow data: check required fields, ranges, references and role status',
      );
    if (error) throw mapDatabaseError(error, action);
    return this.response(result);
  }

  async list(
    userId: string,
    org: string,
    entity: Entity,
    query: WorkflowQueryDto,
  ) {
    await this.access(userId, org, `${entity}.view`);
    if (entity === 'teams') {
      const { data, error } = await this.supabase.adminClient
        .rpc('hr_team_directory', {
          p_actor: userId,
          p_org: org,
          p_department: query.departmentId ?? null,
          p_sort: query.sort ?? 'size_desc',
          p_search: query.search ?? '',
          p_page: query.page,
          p_limit: query.limit,
        } as never)
        .abortSignal(AbortSignal.timeout(10000));
      if (error) throw mapDatabaseError(error, 'load team directory');
      const directory = data as { items: Row[] };
      return {
        ...directory,
        items: await enrichReadRows(this.supabase, org, directory.items ?? []),
      };
    }
    let request = this.supabase.adminClient
      .from(tables[entity])
      .select('*', { count: 'exact' })
      .eq('organization_id', org);
    if (query.departmentId && entity !== 'tasks')
      request = request.eq('department_id', query.departmentId);
    if (query.teamId && entity === 'projects')
      request = request.eq('team_id', query.teamId);
    if (query.projectId && entity === 'tasks')
      request = request.eq('project_id', query.projectId);
    if (query.search)
      request = request.ilike(
        'name',
        `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
      );
    const { data, error, count } = await request
      .order('created_at', { ascending: false })
      .order('id')
      .range((query.page - 1) * query.limit, query.page * query.limit - 1)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, `load ${entity}`);
    const rows = (data ?? []) as Row[];
    if (entity === 'roles' && rows.length) {
      const grants = await this.supabase.adminClient
        .from('organization_role_permissions')
        .select('organization_role_id,permission_id')
        .in(
          'organization_role_id',
          rows.map((r) => String(r.id)),
        )
        .abortSignal(AbortSignal.timeout(10000));
      if (grants.error)
        throw mapDatabaseError(grants.error, 'load role permissions');
      const stats = await this.supabase.adminClient
        .rpc('hr_role_stats_batch', {
          p_actor: userId,
          p_org: org,
          p_ids: rows.map((r) => String(r.id)),
        } as never)
        .abortSignal(AbortSignal.timeout(10000));
      if (stats.error)
        throw mapDatabaseError(stats.error, 'load role statistics');
      for (const row of rows) row.metrics = (stats.data as Row)[String(row.id)];
      for (const row of rows)
        row.permissionIds = (grants.data as Row[])
          .filter((g) => g.organization_role_id === row.id)
          .map((g) => g.permission_id);
    }
    return {
      items: await enrichReadRows(
        this.supabase,
        org,
        rows.map((r) => this.response(r)),
      ),
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async detail(userId: string, org: string, entity: Entity, id: string) {
    if (entity === 'roles' || entity === 'teams') {
      const { data, error } = await this.supabase.adminClient.rpc(
        'workspace_membership_snapshot',
        {
          p_actor: userId,
          p_org: org,
          p_kind: entity === 'roles' ? 'role' : 'team',
          p_entity: id,
        } as never,
      );
      if (error?.code === 'P0002')
        throw new NotFoundException('Resource not found');
      if (error) throw mapDatabaseError(error, 'load workspace resource');
      const detail = this.response(data);
      const { data: stats, error: statsError } = await this.supabase.adminClient
        .rpc(entity === 'roles' ? 'hr_role_stats' : 'hr_metrics', {
          p_actor: userId,
          p_org: org,
          ...(entity === 'roles' ? { p_role: id } : {}),
        } as never)
        .abortSignal(AbortSignal.timeout(10000));
      if (statsError)
        throw mapDatabaseError(statsError, 'load resource statistics');
      detail.metrics =
        entity === 'roles'
          ? stats
          : ((stats as Row).teams as Row[]).find((t) => t.id === id);
      const [enriched] = await enrichReadRows(this.supabase, org, [detail]);
      return enriched;
    }
    await this.access(userId, org, `${entity}.view`);
    const { data, error } = await this.supabase.adminClient
      .from(tables[entity])
      .select('*')
      .eq('id', id)
      .eq('organization_id', org)
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error) throw mapDatabaseError(error, `load ${entity}`);
    if (!data)
      throw new NotFoundException('Resource not found in this workspace');
    const result = this.response(data);
    if (entity === 'projects') {
      // Count all tasks server-side; progress must not be computed from one preview page.
      const counts = await Promise.all(
        [undefined, 'done'].map((status) => {
          let q = this.supabase.adminClient
            .from('organization_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', org)
            .eq('project_id', id);
          if (status) q = q.eq('status', status);
          return q.abortSignal(AbortSignal.timeout(10000));
        }),
      );
      for (const c of counts)
        if (c.error) throw mapDatabaseError(c.error, 'load project progress');
      const total = counts[0].count ?? 0,
        done = counts[1].count ?? 0;
      result.progress = {
        totalTasks: total,
        completedTasks: done,
        percent: total ? Math.round((done / total) * 100) : 0,
      };
    }
    const [enriched] = await enrichReadRows(this.supabase, org, [result]);
    return enriched;
  }

  async members(
    userId: string,
    org: string,
    query: WorkflowQueryDto,
    teamId?: string,
  ) {
    if (teamId) {
      const snapshot = await this.detail(userId, org, 'teams', teamId);
      const all = (snapshot.members ?? []) as Row[];
      const selected = query.search
        ? all.filter(
            (member) =>
              String(member.email)
                .toLowerCase()
                .includes(query.search!.toLowerCase()) ||
              (typeof member.displayName === 'string' ? member.displayName : '')
                .toLowerCase()
                .includes(query.search!.toLowerCase()),
          )
        : all;
      return {
        items: selected.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
        total: selected.length,
        page: query.page,
        limit: query.limit,
        memberIds: snapshot.memberIds,
        membershipRevision: snapshot.membershipRevision,
      };
    }
    const { data, error } = await this.supabase.adminClient
      .rpc('hr_member_directory', {
        p_actor: userId,
        p_org: org,
        p_search: query.search ?? '',
        p_page: query.page,
        p_limit: query.limit,
      } as never)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load member directory');
    return data;
  }

  async permissions(userId: string, org: string) {
    await this.access(userId, org, 'roles.view');
    const { data, error } = await this.supabase.adminClient
      .from('permissions')
      .select('id,description')
      .order('id')
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load permissions');
    const memberRoles = await this.supabase.adminClient
      .from('organization_member_roles')
      .select('organization_role_id')
      .eq('organization_id', org)
      .eq('user_id', userId)
      .abortSignal(AbortSignal.timeout(10000));
    if (memberRoles.error)
      throw mapDatabaseError(memberRoles.error, 'load member roles');
    const roleIds = ((memberRoles.data ?? []) as Row[]).map((row) =>
      String(row.organization_role_id),
    );
    let held = new Set<string>();
    let isOwner = false;
    if (roleIds.length) {
      const [grants, ownerRole] = await Promise.all([
        this.supabase.adminClient
          .from('organization_role_permissions')
          .select('permission_id')
          .in('organization_role_id', roleIds)
          .abortSignal(AbortSignal.timeout(10000)),
        this.supabase.adminClient
          .from('organization_roles')
          .select('id')
          .in('id', roleIds)
          .eq('key', 'organisation_owner')
          .eq('status', 'active')
          .limit(1)
          .abortSignal(AbortSignal.timeout(10000)),
      ]);
      if (grants.error)
        throw mapDatabaseError(grants.error, 'load held permissions');
      if (ownerRole.error)
        throw mapDatabaseError(ownerRole.error, 'verify owner role');
      held = new Set(
        ((grants.data ?? []) as Row[]).map((grant) =>
          String(grant.permission_id),
        ),
      );
      isOwner = ((ownerRole.data ?? []) as Row[]).length > 0;
    }
    return {
      items: ((data as Row[]) ?? []).map((row) => {
        const id = String(row.id);
        const ownerOnly = ownerOnlyPermissions.has(id);
        return {
          id,
          name: permissionNameOf(id),
          description: String(row.description ?? ''),
          group: permissionGroupOf(id),
          type: (id.split('.')[1] ?? 'action').split('_')[0],
          ownerOnly,
          assignable: !ownerOnly,
          grantable: isOwner || held.has(id),
        };
      }),
    };
  }

  async roleHistory(userId: string, org: string, roleId: string) {
    await this.access(userId, org, 'roles.view');
    const { data, error } = await this.supabase.adminClient
      .from('organization_role_history')
      .select('*')
      .eq('organization_id', org)
      .eq('role_id', roleId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(100)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load role history');
    return {
      items: await enrichReadRows(
        this.supabase,
        org,
        ((data as Row[]) ?? []).map((r) => this.response(r)),
      ),
    };
  }

  async taskChildren(
    userId: string,
    org: string,
    id: string,
    kind: 'notes' | 'history',
    query: WorkflowQueryDto,
  ) {
    await this.detail(userId, org, 'tasks', id);
    const { data, error, count } = await this.supabase.adminClient
      .from(`organization_task_${kind}`)
      .select('*', { count: 'exact' })
      .eq('organization_id', org)
      .eq('task_id', id)
      .order('created_at', { ascending: false })
      .order('id')
      .range((query.page - 1) * query.limit, query.page * query.limit - 1)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, `load task ${kind}`);
    return {
      items: await enrichReadRows(
        this.supabase,
        org,
        (data as Row[]).map((r) => this.response(r)),
      ),
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  private async validateRoleIcon(iconId: string) {
    const { data, error } = await withRequestDeadline(
      this.supabase.adminClient
        .from('department_icons')
        .select('id')
        .eq('id', iconId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle(),
    );
    if (error) throw mapDatabaseError(error, 'verify role icon');
    if (!data) throw new BadRequestException('Active role icon required');
  }

  private validateNulls(value: object) {
    for (const [key, item] of Object.entries(value)) {
      if (
        item === null &&
        !['assigneeId', 'reportsToUserId', 'iconId'].includes(key)
      )
        throw new BadRequestException(`${key} cannot be null`);
      if (item && typeof item === 'object') this.validateNulls(item as object);
    }
  }

  private response(row: Row): Row {
    const { definition, ...columns } = row;
    const result: Row =
      definition && typeof definition === 'object'
        ? { ...(definition as Row) }
        : {};
    for (const [key, value] of Object.entries(columns))
      result[key.replace(/_([a-z])/g, (_match, c: string) => c.toUpperCase())] =
        value;
    return result;
  }
}

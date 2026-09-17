import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { WorkflowQueryDto } from './workflow.dto';

type Row = Record<string, unknown>;
export type Entity = 'roles' | 'teams' | 'projects' | 'tasks';
const tables: Record<Entity, string> = {
  roles: 'organization_roles',
  teams: 'organization_teams',
  projects: 'organization_projects',
  tasks: 'organization_tasks',
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
    this.validateNulls(data);
    const { data: result, error } = await this.supabase.adminClient
      .rpc('workflow_mutate', {
        p_actor: userId,
        p_org: org,
        p_action: action,
        p_id: id,
        p_data: data,
      } as never)
      .abortSignal(AbortSignal.timeout(15000));
    if (error?.code === 'P0002')
      throw new NotFoundException('Resource not found in this workspace');
    if (
      error &&
      ['22023', '23514', '23502', '22P02', '22007', '22008'].includes(
        error.code,
      )
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
      for (const row of rows)
        row.permissionIds = (grants.data as Row[])
          .filter((g) => g.organization_role_id === row.id)
          .map((g) => g.permission_id);
    }
    return {
      items: rows.map((r) => this.response(r)),
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
      return this.response(data);
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
    return result;
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
    // Pickers are needed by role/team/project/task editors, without exposing private profile fields.
    const { data: allowed, error: checkError } = await this.supabase.adminClient
      .rpc('workflow_has_permission', {
        p_actor: userId,
        p_org: org,
        p_permission: teamId ? 'teams.view' : 'workspace.view',
      } as never)
      .abortSignal(AbortSignal.timeout(10000));
    if (checkError)
      throw mapDatabaseError(checkError, 'verify member directory access');
    if (!allowed)
      throw new ForbiddenException('Member directory access required');
    let request = this.supabase.adminClient
      .from(teamId ? 'organization_team_members' : 'organization_members')
      .select(
        teamId
          ? 'user_id,member:organization_members!inner(profile:profiles!inner(id,email,display_name,avatar_url))'
          : 'user_id,profile:profiles!inner(id,email,display_name,avatar_url)',
        { count: 'exact' },
      )
      .eq('organization_id', org);
    if (teamId) request = request.eq('team_id', teamId);
    if (query.search)
      request = request.ilike(
        teamId ? 'member.profile.email' : 'profile.email',
        `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
      );
    const { data, error, count } = await request
      .order('user_id')
      .range((query.page - 1) * query.limit, query.page * query.limit - 1)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load members');
    const profiles = ((data ?? []) as Row[])
      .map((row) => {
        const member = teamId
          ? ((Array.isArray(row.member) ? row.member[0] : row.member) as Row)
          : row;
        return (
          Array.isArray(member.profile) ? member.profile[0] : member.profile
        ) as Row;
      })
      .filter(Boolean);
    return {
      items: profiles.map((p) => this.response(p)),
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async permissions(userId: string, org: string) {
    await this.access(userId, org, 'roles.view');
    const { data, error } = await this.supabase.adminClient
      .from('permissions')
      .select('id,description')
      .order('id')
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load permissions');
    return {
      items: (data as Row[]).filter(
        (p) =>
          ![
            'workspace.delete',
            'workspace.transfer',
            'billing.manage',
          ].includes(String(p.id)),
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
      items: (data as Row[]).map((r) => this.response(r)),
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  private validateNulls(value: object) {
    for (const [key, item] of Object.entries(value)) {
      if (item === null && !['assigneeId', 'reportsToUserId'].includes(key))
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

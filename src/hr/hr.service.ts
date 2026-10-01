import {
  enrichReadRows,
  enrichReadTree,
  ReadRow,
} from '../common/read-relations';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { HrQueryDto } from './hr.dto';
import { withRequestDeadline } from '../supabase/request-timeout';
const resources: Record<string, { table: string; permission: string }> = {
  employees: { table: 'hr_employees', permission: 'employees.view' },
  onboarding: { table: 'hr_onboarding', permission: 'employees.manage' },
  leave: { table: 'hr_leave', permission: 'leave.approve' },
  attendance: { table: 'hr_attendance', permission: 'attendance.approve' },
  reviews: { table: 'hr_reviews', permission: 'performance.approve' },
  expenses: { table: 'hr_expenses', permission: 'expenses.approve' },
  documents: { table: 'hr_documents', permission: 'documents.manage' },
  interviews: { table: 'hr_interviews', permission: 'interviews.manage' },
  requisitions: { table: 'hr_requisitions', permission: 'roles.view' },
  payroll: { table: 'hr_payroll', permission: 'payroll.view' },
  'department-plans': {
    table: 'hr_department_plans',
    permission: 'departments.manage',
  },
  'team-plans': { table: 'hr_team_plans', permission: 'teams.view' },
  entitlements: {
    table: 'hr_leave_entitlements',
    permission: 'employees.view',
  },
  'payroll-lines': { table: 'hr_payroll_lines', permission: 'payroll.view' },
  celebrations: { table: 'hr_celebrations', permission: 'employees.view' },
};
export function camel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camel);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camel(v),
      ]),
    );
  return value;
}
function snake(data: object) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
      v,
    ]),
  );
}
@Injectable()
export class HrService {
  constructor(private readonly supabase: SupabaseService) {}
  organization(user: string, header?: string) {
    return resolveOrganization(this.supabase, user, header);
  }
  async rpc<T = Record<string, unknown>>(
    name: string,
    args: object,
  ): Promise<T> {
    const { data, error } = await this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(15000));
    if (error?.code === '22023') throw new BadRequestException(error.message);
    if (error?.code === 'P0002')
      throw new NotFoundException('HR record not found');
    if (
      error &&
      ['22023', '23514', '23502', '22P02', '22007', '22008'].includes(
        error.code,
      )
    )
      throw new BadRequestException(
        'Invalid HR data or transition: check dates, employee assignment, entitlement, status and required fields',
      );
    if (error) throw mapDatabaseError(error, 'process HR request');
    return camel(data) as T;
  }
  async readRpc(name: string, args: { p_org: string; [key: string]: unknown }) {
    const result = await this.rpc(name, args);
    return enrichReadTree(this.supabase, args.p_org, result);
  }

  async list(actor: string, org: string, kind: string, q: HrQueryDto) {
    const resource = resources[kind];
    if (!resource) throw new NotFoundException('Unknown HR resource');
    await this.rpc('hr_require', {
      p_actor: actor,
      p_org: org,
      p_permission: resource.permission,
    });
    const hideSalary =
      kind === 'employees' &&
      !(await this.rpc<boolean>('workflow_has_permission', {
        p_actor: actor,
        p_org: org,
        p_permission: 'payroll.view',
      }));
    const paginated = q.page !== undefined || q.limit !== undefined;
    const page = q.page ?? 1;
    const pageSize = paginated ? (q.limit ?? 50) : 500;
    const signal = AbortSignal.timeout(30000);
    const loadPage = (from: number, to: number) => {
      let request = this.supabase.adminClient
        .from(resource.table)
        .select('*', { count: 'exact' })
        .eq('organization_id', org);
      if (
        q.employeeId &&
        ![
          'employees',
          'payroll',
          'interviews',
          'requisitions',
          'department-plans',
          'team-plans',
        ].includes(kind)
      )
        request = request.eq('employee_id', q.employeeId);
      if (q.departmentId && kind === 'employees')
        request = request.eq('department_id', q.departmentId);
      if (q.payrollId && kind === 'payroll-lines')
        request = request.eq('payroll_id', q.payrollId);
      if (q.date && kind === 'attendance') request = request.eq('date', q.date);
      if (
        q.status &&
        [
          'leave',
          'attendance',
          'reviews',
          'expenses',
          'payroll',
          'requisitions',
        ].includes(kind)
      )
        request = request.eq('status', q.status);
      if (q.search) {
        const column =
          kind === 'documents'
            ? 'name'
            : kind === 'interviews'
              ? 'candidate_name'
              : null;
        if (column)
          request = request.ilike(
            column,
            `%${q.search.replace(/[\\%_]/g, '\\$&')}%`,
          );
        else
          throw new BadRequestException(
            'Search is available for documents and interviews; use the workspace member picker to find employees by name or role',
          );
      }

      return withRequestDeadline(
        request.order('id').range(from, to).abortSignal(signal),
      );
    };
    const rows: Record<string, unknown>[] = [];
    let offset = paginated ? (page - 1) * pageSize : 0;
    let total = 0;
    do {
      if (signal.aborted)
        throw new ServiceUnavailableException(
          'List request timed out; please retry',
        );
      const { data, error, count } = await loadPage(
        offset,
        offset + pageSize - 1,
      );
      if (error) throw mapDatabaseError(error, 'list HR records');
      if (!paginated && count === null) {
        throw new ServiceUnavailableException(
          'Unable to determine the complete list size; please retry',
        );
      }
      const batch = (data ?? []) as Record<string, unknown>[];
      total = count ?? offset + batch.length;
      if (!batch.length && offset < total) {
        throw new ServiceUnavailableException(
          'Unable to load the complete list; please retry',
        );
      }
      rows.push(...batch);
      // Advance by received rows, even if the Data API cap is smaller than our batch.
      offset += batch.length;
      if (paginated || !batch.length) break;
    } while (offset < total);
    return {
      items: await enrichReadRows(
        this.supabase,
        org,
        camel(
          hideSalary
            ? rows.map((row) => ({
                ...row,
                annual_salary: null,
              }))
            : rows,
        ) as ReadRow[],
      ),
      total: paginated ? total : rows.length,
      page,
      limit: paginated ? pageSize : rows.length,
    };
  }
  mutate(
    actor: string,
    org: string,
    kind: string,
    id: string | null,
    data: object,
  ) {
    return this.rpc('hr_mutate', {
      p_actor: actor,
      p_org: org,
      p_kind: kind,
      p_id: id,
      p_data: snake(data),
    });
  }
  decide(
    actor: string,
    org: string,
    kind: string,
    ids: string[],
    data: { status: string; reason?: string },
  ) {
    return this.rpc('hr_decide', {
      p_actor: actor,
      p_org: org,
      p_kind: kind,
      p_ids: ids,
      p_status: data.status,
      p_reason: data.reason ?? null,
    });
  }
  action(
    actor: string,
    org: string,
    kind: string,
    id: string,
    action: string,
    data: object = {},
  ) {
    return this.rpc('hr_action', {
      p_actor: actor,
      p_org: org,
      p_kind: kind,
      p_id: id,
      p_action: action,
      p_data: data,
    });
  }
  metrics(actor: string, org: string, date?: string) {
    return this.rpc<{
      summary: Record<string, number | null>;
      departments: Record<string, unknown>[];
      teams: Record<string, unknown>[];
      attendance: Record<string, number>;
      leaveOverview: Record<string, number>;
    }>('hr_metrics', {
      p_actor: actor,
      p_org: org,
      p_date: date ?? null,
    });
  }
  async employee(actor: string, org: string, id: string, date?: string) {
    const result = await this.rpc('hr_employee_stats', {
      p_actor: actor,
      p_org: org,
      p_employee: id,
      ...(date ? { p_date: date } : {}),
    });
    const [employee, onboarding] = await enrichReadRows(this.supabase, org, [
      result.employee as ReadRow,
      result.onboarding as ReadRow,
    ]);
    return { ...result, employee, onboarding };
  }
  async role(actor: string, org: string, id: string, date?: string) {
    const result = await this.rpc('hr_role_stats', {
      p_actor: actor,
      p_org: org,
      p_role: id,
      ...(date ? { p_date: date } : {}),
    });
    const [summary] = await enrichReadRows(this.supabase, org, [
      { roleId: id },
    ]);
    return { ...result, ...summary };
  }
  async payroll(actor: string, org: string, id: string) {
    const result = await this.rpc('hr_payroll_stats', {
      p_actor: actor,
      p_org: org,
      p_id: id,
    });
    const [payroll, ...lines] = await enrichReadRows(this.supabase, org, [
      result,
      ...((result.lines ?? []) as ReadRow[]),
    ]);
    return { ...payroll, lines };
  }
  async detail(actor: string, org: string, kind: string, id: string) {
    if (kind === 'employees') return this.employee(actor, org, id);
    const resource = resources[kind];
    if (!resource) throw new NotFoundException();
    await this.rpc('hr_require', {
      p_actor: actor,
      p_org: org,
      p_permission: resource.permission,
    });
    const { data, error } = await this.supabase.adminClient
      .from(resource.table)
      .select('*')
      .eq('organization_id', org)
      .eq('id', id)
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load HR detail');
    if (!data) throw new NotFoundException('HR record not found');
    const [result] = await enrichReadRows(this.supabase, org, [
      camel(data) as ReadRow,
    ]);
    return result;
  }
  async chains(actor: string, org: string) {
    await this.rpc('hr_require', {
      p_actor: actor,
      p_org: org,
      p_permission: 'employees.manage',
    });
    const { data, error } = await this.supabase.adminClient
      .from('hr_approval_chains')
      .select('kind,approver_ids')
      .eq('organization_id', org)
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw mapDatabaseError(error, 'load approval chains');
    return {
      items: await enrichReadRows(
        this.supabase,
        org,
        camel(data ?? []) as ReadRow[],
      ),
    };
  }
}

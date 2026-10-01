import { enrichReadRows, enrichReadTree } from './read-relations';
import { SupabaseService } from '../supabase/supabase.service';
import { HrService } from '../hr/hr.service';
import { HrQueryDto } from '../hr/hr.dto';

function setup(payroll = false) {
  const tables: Record<string, Record<string, unknown>[]> = {
    hr_employees: [
      {
        id: 'employee',
        organization_id: 'org',
        user_id: 'person',
        department_id: 'department',
        role_id: 'role',
        starts_on: '2026-09-01',
        annual_salary: 0,
        birth_date: '1990-01-01',
      },
    ],
    organization_members: [
      {
        organization_id: 'org',
        user_id: 'person',
        profile: {
          id: 'person',
          display_name: 'Ada',
          avatar_url: 'https://example.test/avatar.png',
          email: 'ada@example.test',
          secret: 'do-not-return',
        },
      },
    ],
    departments: [
      { organization_id: 'org', id: 'department', name: 'Engineering' },
      { organization_id: 'other', id: 'foreign-department', name: 'Private' },
    ],
    organization_roles: [
      { organization_id: 'org', id: 'role', name: 'Engineer' },
    ],
    organization_teams: [
      { organization_id: 'org', id: 'team', name: 'Platform' },
    ],
    organization_projects: [
      { organization_id: 'org', id: 'project', name: 'Launch' },
    ],
    hr_leave: [
      {
        id: 'leave',
        organization_id: 'org',
        employee_id: 'employee',
        status: 'pending',
      },
    ],
  };
  const calls: {
    table: string;
    filters: [string, unknown][];
    ids?: unknown[];
  }[] = [];
  const from = jest.fn((table: string) => {
    const call = {
      table,
      filters: [] as [string, unknown][],
      ids: undefined as unknown[] | undefined,
    };
    calls.push(call);
    let selected = tables[table] ?? [];
    const node: Record<string, unknown> = {
      select: jest.fn(() => node),
      eq: jest.fn((key: string, value: unknown) => {
        call.filters.push([key, value]);
        selected = selected.filter((row) => row[key] === value);
        return node;
      }),
      in: jest.fn((key: string, values: unknown[]) => {
        call.ids = values;
        selected = selected.filter((row) => values.includes(row[key]));
        return node;
      }),
      order: jest.fn(() => node),
      range: jest.fn(() => node),
      abortSignal: jest.fn(() => node),
      maybeSingle: jest.fn(() =>
        Promise.resolve({ data: selected[0] ?? null, error: null }),
      ),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: selected,
          count: selected.length,
          error: null,
        }).then(resolve),
    };
    return node;
  });
  const rpc = jest.fn((name: string) => ({
    abortSignal: () =>
      Promise.resolve({
        data: name === 'workflow_has_permission' ? payroll : null,
        error: null,
      }),
  }));
  const supabase = { adminClient: { from, rpc } } as unknown as SupabaseService;
  return { supabase, calls, from, rpc };
}

describe('GET related record summaries', () => {
  it('adds names to employee lists while preserving IDs, zero values and salary restrictions', async () => {
    const { supabase } = setup();
    const result = await new HrService(supabase).list(
      'actor',
      'org',
      'employees',
      new HrQueryDto(),
    );
    expect(result.items).toMatchObject([
      {
        id: 'employee',
        userId: 'person',
        departmentId: 'department',
        roleId: 'role',
        displayName: 'Ada',
        departmentName: 'Engineering',
        roleName: 'Engineer',
        annualSalary: null,
        user: { id: 'person', displayName: 'Ada' },
        department: { id: 'department', name: 'Engineering' },
      },
    ]);
    const allowed = setup(true);
    const visible = await new HrService(allowed.supabase).list(
      'actor',
      'org',
      'employees',
      new HrQueryDto(),
    );
    expect(visible.items[0].annualSalary).toBe(0);
  });

  it('hydrates a single HR source record with a safe employee summary', async () => {
    const { supabase } = setup();
    const row = await new HrService(supabase).detail(
      'actor',
      'org',
      'leave',
      'leave',
    );
    expect(row).toMatchObject({
      id: 'leave',
      employeeId: 'employee',
      employee: {
        id: 'employee',
        displayName: 'Ada',
        departmentName: 'Engineering',
        roleName: 'Engineer',
      },
    });
    expect(row.employee).not.toHaveProperty('annualSalary');
    expect(row.employee).not.toHaveProperty('birthDate');
    expect(JSON.stringify(row)).not.toContain('do-not-return');
  });

  it('batches repeated references and never resolves another workspace’s records', async () => {
    const { supabase, calls } = setup();
    const rows = await enrichReadRows(
      supabase,
      'org',
      Array.from({ length: 50 }, () => ({
        employeeId: 'employee',
        assigneeId: 'person',
        departmentId: 'foreign-department',
        teamId: 'team',
        projectId: 'project',
        amount: 0,
      })),
    );
    expect(rows[0]).toMatchObject({
      department: null,
      amount: 0,
      assignee: { displayName: 'Ada' },
      team: { name: 'Platform' },
      project: { name: 'Launch' },
    });
    expect(calls).toHaveLength(6);
    expect(
      calls.every((call) =>
        call.filters.some(
          ([key, value]) => key === 'organization_id' && value === 'org',
        ),
      ),
    ).toBe(true);
    expect(calls.find((call) => call.table === 'hr_employees')?.ids).toEqual([
      'employee',
    ]);
  });

  it('keeps missing relations null and keeps empty lists empty', async () => {
    const { supabase, from } = setup();
    expect(await enrichReadRows(supabase, 'org', [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
    expect(
      await enrichReadRows(supabase, 'org', [
        { userId: null, roleId: 'missing' },
      ]),
    ).toEqual([{ userId: null, roleId: 'missing', user: null, role: null }]);
  });

  it('does not perform lookups when resource authorization fails', async () => {
    const { supabase, rpc, from } = setup();
    rpc.mockImplementation(() => ({
      abortSignal: () => Promise.reject(new Error('denied')),
    }));
    await expect(
      new HrService(supabase).list(
        'actor',
        'org',
        'employees',
        new HrQueryDto(),
      ),
    ).rejects.toThrow('denied');
    expect(from).not.toHaveBeenCalled();
  });
});

it('keeps nested employee statistics and redaction when enriching calendar detail', async () => {
  const { supabase } = setup();
  const result = await enrichReadTree(supabase, 'org', {
    employeeId: 'employee',
    employee: {
      employee: {
        id: 'employee',
        userId: 'person',
        departmentId: 'department',
        roleId: 'role',
        startsOn: '2026-09-01',
        annualSalary: null,
      },
      attendance: { approvedHours: 0 },
      onboarding: { buddyUserId: 'person', progressPercent: 0, hrNotes: null },
    },
  });
  expect(result).toMatchObject({
    employee: {
      employee: { displayName: 'Ada', annualSalary: null },
      attendance: { approvedHours: 0 },
      onboarding: {
        buddy: { displayName: 'Ada' },
        progressPercent: 0,
        hrNotes: null,
      },
    },
  });
});

it('enriches activity source details and ordered approval steps', async () => {
  const { supabase } = setup();
  const result = await enrichReadTree(supabase, 'org', {
    details: { id: 'leave', employeeId: 'employee' },
    approvalSteps: [{ approverId: 'person', position: 1, status: 'pending' }],
  });
  expect(result).toMatchObject({
    details: { employee: { displayName: 'Ada' } },
    approvalSteps: [
      { approverId: 'person', approver: { displayName: 'Ada' }, position: 1 },
    ],
  });
});

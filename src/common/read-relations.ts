import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';

export type ReadRow = Record<string, unknown>;
const personFields: Record<string, string> = {
  userId: 'user',
  buddyUserId: 'buddy',
  reviewerUserId: 'reviewer',
  leadUserId: 'lead',
  reportsToUserId: 'reportsTo',
  resourceManagerId: 'resourceManager',
  assigneeId: 'assignee',
  organizerId: 'organizer',
  actorId: 'actor',
  createdBy: 'creator',
  decidedBy: 'decisionMaker',
  finalizedBy: 'finalizer',
  authorId: 'author',
  approverId: 'approver',
};
const namedTables: Record<string, string> = {
  department: 'departments',
  role: 'organization_roles',
  team: 'organization_teams',
  project: 'organization_projects',
};
const ids = (values: unknown[]) => [
  ...new Set(
    values.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  ),
];

/**
 * Call only after authorizing the parent resource. Adds display summaries, never
 * full related HR records. Every lookup is scoped to the resolved workspace.
 * Queries are batched by relation, not performed once per returned row.
 */
export async function enrichReadRows(
  supabase: SupabaseService,
  organizationId: string,
  input: ReadRow[],
): Promise<ReadRow[]> {
  if (!input.length) return [];
  const rows = input.map((row) => ({ ...row }));
  async function lookup(
    table: string,
    columns: string,
    key: string,
    values: string[],
  ) {
    const found: ReadRow[] = [];
    for (let start = 0; start < values.length; start += 100) {
      const { data, error } = await supabase.adminClient
        .from(table)
        .select(columns)
        .eq('organization_id', organizationId)
        .in(key, values.slice(start, start + 100))
        .abortSignal(AbortSignal.timeout(10000));
      if (error) throw mapDatabaseError(error, 'load related record details');
      found.push(...((data ?? []) as unknown as ReadRow[]));
    }
    return found;
  }
  const employees = await lookup(
    'hr_employees',
    'id,user_id,department_id,role_id',
    'id',
    ids(rows.map((row) => row.employeeId)),
  );
  const employeeRows = employees.map((employee) => ({
    id: employee.id,
    userId: employee.user_id,
    departmentId: employee.department_id,
    roleId: employee.role_id,
  }));
  const subjects: ReadRow[] = [...rows, ...employeeRows];
  const peopleIds = ids(
    subjects.flatMap((row) => [
      ...Object.keys(personFields).map((key) => row[key]),
      ...(Array.isArray(row.approverIds) ? (row.approverIds as unknown[]) : []),
    ]),
  );
  const relationEntries = Object.entries(namedTables);
  const [people, ...related] = await Promise.all([
    lookup(
      'organization_members',
      'user_id,profile:profiles!organization_members_user_id_fkey(id,display_name,avatar_url,email)',
      'user_id',
      peopleIds,
    ),
    ...relationEntries.map(([relation, table]) =>
      lookup(
        table,
        'id,name',
        'id',
        ids(subjects.map((row) => row[relation + 'Id'])),
      ),
    ),
  ]);
  const personMap = new Map(
    people.map((member) => {
      const profile = member.profile as ReadRow | null;
      return [
        member.user_id,
        profile
          ? {
              id: profile.id,
              displayName: profile.display_name ?? null,
              avatarUrl: profile.avatar_url ?? null,
              email: profile.email ?? null,
            }
          : null,
      ];
    }),
  );
  const names: Record<string, Map<unknown, ReadRow>> = {};
  relationEntries.forEach(([relation], index) => {
    names[relation] = new Map(
      related[index].map((record) => [
        record.id,
        { id: record.id, name: record.name },
      ]),
    );
  });
  function decorate(row: ReadRow): ReadRow {
    const result = { ...row };
    for (const [key, label] of Object.entries(personFields)) {
      if (Object.hasOwn(row, key) && !Object.hasOwn(row, label))
        result[label] = personMap.get(row[key]) ?? null;
    }
    for (const relation of Object.keys(namedTables)) {
      if (
        Object.hasOwn(row, relation + 'Id') &&
        !Object.hasOwn(row, relation)
      ) {
        result[relation] = names[relation].get(row[relation + 'Id']) ?? null;
      }
    }
    if (Array.isArray(row.approverIds)) {
      result.approvers = row.approverIds.map((id) => personMap.get(id) ?? null);
    }
    return result;
  }
  const employeeMap = new Map(
    employeeRows.map((row) => {
      const employee = decorate(row);
      const user = employee.user as ReadRow | null;
      return [
        row.id,
        {
          ...employee,
          displayName: user?.displayName ?? null,
          avatarUrl: user?.avatarUrl ?? null,
          departmentName: names.department.get(row.departmentId)?.name ?? null,
          roleName: names.role.get(row.roleId)?.name ?? null,
        },
      ];
    }),
  );
  return rows.map((row) => {
    const result = decorate(row);
    if (Object.hasOwn(row, 'employeeId') && !Object.hasOwn(row, 'employee'))
      result.employee = employeeMap.get(row.employeeId) ?? null;
    // Keep employee list labels consistent with the existing employee detail RPC.
    if (Object.hasOwn(row, 'userId') && Object.hasOwn(row, 'startsOn')) {
      const user = result.user as ReadRow | null;
      result.displayName = user?.displayName ?? null;
      result.email = user?.email ?? null;
      result.avatarUrl = user?.avatarUrl ?? null;
      result.departmentName =
        names.department.get(row.departmentId)?.name ?? null;
      result.roleName = names.role.get(row.roleId)?.name ?? null;
    }
    return result;
  });
}

// Only traverse known response containers, never user-authored metadata or notes.
export async function enrichReadTree(
  supabase: SupabaseService,
  organizationId: string,
  value: unknown,
): Promise<unknown> {
  const containers = new Set([
    'items',
    'lines',
    'employee',
    'onboarding',
    'activity',
    'record',
    'details',
    'approvalSteps',
    'attendees',
    'approvals',
    'members',
  ]);
  const rows: ReadRow[] = [];
  function collect(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) collect(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const row = node as ReadRow;
    rows.push(row);
    for (const [key, child] of Object.entries(row))
      if (containers.has(key)) collect(child);
  }
  collect(value);
  const enriched = await enrichReadRows(supabase, organizationId, rows);
  const mapped = new Map(rows.map((row, index) => [row, enriched[index]]));
  function rebuild(node: unknown): unknown {
    if (Array.isArray(node)) return (node as unknown[]).map(rebuild);
    if (!node || typeof node !== 'object') return node;
    const row = node as ReadRow;
    const result = { ...(mapped.get(row) ?? row) };
    for (const [key, child] of Object.entries(row))
      if (containers.has(key)) result[key] = rebuild(child);
    return result;
  }
  return rebuild(value);
}

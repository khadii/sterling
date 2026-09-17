import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { withRequestDeadline } from '../supabase/request-timeout';

/** A selector chooses among memberships; it never grants membership. */
export async function resolveOrganization(
  supabase: SupabaseService,
  userId: string,
  ...selectors: (string | undefined | null)[]
): Promise<string> {
  const supplied = selectors.filter(
    (value): value is string => value !== undefined && value !== null,
  );
  if (supplied.some((value) => !isUUID(value)))
    throw new BadRequestException('Invalid organization selector');
  const unique = [...new Set(supplied.map((value) => value.toLowerCase()))];
  if (unique.length > 1)
    throw new BadRequestException('Conflicting organization selectors');
  let query = supabase.adminClient
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId);
  if (unique[0]) query = query.eq('organization_id', unique[0]);
  const { data, error } = await withRequestDeadline(
    query.limit(2).abortSignal(AbortSignal.timeout(10000)),
  );
  if (error) throw mapDatabaseError(error, 'resolve workspace');
  const rows = (data ?? []) as { organization_id: string }[];
  if (!rows.length)
    throw new ForbiddenException('Organization membership required');
  if (rows.length > 1)
    throw new BadRequestException({
      code: 'WORKSPACE_SELECTION_REQUIRED',
      message: 'Select a workspace using X-Organization-Id',
    });
  return rows[0].organization_id;
}

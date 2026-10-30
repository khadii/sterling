import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { camel, snake } from '../common/serialize';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import {
  LeavePolicyListQueryDto,
  LeaveSettingsDto,
  LeavePolicyDto,
  UpdateLeavePolicyDto,
} from './leave.dto';

const UNPAGINATED_PAGE = 200;
const UNPAGINATED_MAX_PAGES = 50;

@Injectable()
export class LeaveService {
  constructor(private readonly supabase: SupabaseService) {}

  organization(user: string, header?: string) {
    return resolveOrganization(this.supabase, user, header);
  }

  private call(name: string, args: object) {
    return this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(15000));
  }

  private raise(error: PostgrestError | null, action: string): void {
    if (!error) return;
    if (error.code === '22023')
      throw new BadRequestException(error.message || 'Invalid leave data');
    if (error.code === 'P0002')
      throw new NotFoundException('Leave policy or settings not found');
    if (error.code === '23505')
      throw new BadRequestException(
        'A leave policy with this name already exists',
      );
    if (
      ['23514', '23502', '23503', '22P02', '22007', '22008'].includes(
        error.code,
      )
    )
      throw new BadRequestException(
        'Invalid leave data: check field ranges, references and dates',
      );
    throw mapDatabaseError(error, action);
  }

  async rpc<T = Record<string, unknown>>(
    name: string,
    args: object,
  ): Promise<T> {
    const { data, error } = await this.call(name, args);
    this.raise(error, 'process leave request');
    return camel(data) as T;
  }

  async listPolicies(actor: string, org: string, q: LeavePolicyListQueryDto) {
    const filters = {
      p_actor: actor,
      p_org: org,
      p_status: q.status ?? null,
      p_search: q.search ?? null,
    };
    if (q.page !== undefined || q.limit !== undefined) {
      const limit = q.limit ?? 50;
      return this.rpc('leave_policy_list', {
        ...filters,
        p_limit: limit,
        p_offset: ((q.page ?? 1) - 1) * limit,
      });
    }
    const items: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 0; page < UNPAGINATED_MAX_PAGES; page += 1) {
      const batch = await this.rpc<{
        items: Record<string, unknown>[];
        total: number;
      }>('leave_policy_list', {
        ...filters,
        p_limit: UNPAGINATED_PAGE,
        p_offset: page * UNPAGINATED_PAGE,
      });
      total = batch.total;
      items.push(...batch.items);
      if (batch.items.length < UNPAGINATED_PAGE || items.length >= total) break;
    }
    return { items, total, limit: items.length, offset: 0 };
  }

  savePolicy(
    actor: string,
    org: string,
    id: string | null,
    dto: LeavePolicyDto | UpdateLeavePolicyDto,
  ) {
    return this.rpc('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'policy.save',
      p_id: id,
      p_data: snake(dto),
    });
  }

  deletePolicy(actor: string, org: string, id: string) {
    return this.rpc('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'policy.delete',
      p_id: id,
      p_data: {},
    });
  }

  saveSettings(actor: string, org: string, dto: LeaveSettingsDto) {
    return this.rpc('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'settings.save',
      p_id: null,
      p_data: snake(dto),
    });
  }

  async settings(actor: string, org: string) {
    const { data, error } = await this.supabase.adminClient
      .from('leave_settings')
      .select('*')
      .eq('organization_id', org)
      .abortSignal(AbortSignal.timeout(10000))
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load leave settings');
    return camel(data ?? {}) as Record<string, unknown>;
  }

  reports(actor: string, org: string) {
    return this.rpc('leave_reports', { p_actor: actor, p_org: org });
  }
}

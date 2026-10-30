import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { camel } from '../common/serialize';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationService } from '../notifications/notification.service';
import {
  AdvanceCandidateDto,
  CandidateListQueryDto,
  CreateCandidateDto,
  CreateJobDto,
  JobListQueryDto,
  UpdateCandidateDto,
  UpdateJobDto,
} from './recruitment.dto';

/** Sentence case for the pages a client should reload after a conflict. */
const JOB_RELOAD_URL = (id: string) => `/api/v1/employer/jobs/${id}`;
const UNPAGINATED_PAGE = 200;
const UNPAGINATED_MAX_PAGES = 50;

export interface PagedItems {
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class RecruitmentService {
  private readonly logger = new Logger(RecruitmentService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications?: NotificationService,
  ) {}

  organization(user: string, header?: string) {
    return resolveOrganization(this.supabase, user, header);
  }

  private call(name: string, args: object) {
    return this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(15000));
  }

  /** Maps the SQL error contract onto the API error contract. */
  private raise(error: PostgrestError | null, action: string): void {
    if (!error) return;
    if (error.code === '22023')
      throw new BadRequestException(
        error.message || 'Invalid recruitment data',
      );
    if (error.code === 'P0002')
      throw new NotFoundException('Recruitment record not found');
    if (error.code === '23505')
      throw new ConflictException(
        'This record already exists: check the job reference and the candidate email',
      );
    if (
      ['23514', '23502', '23503', '22P02', '22007', '22008'].includes(
        error.code,
      )
    )
      throw new BadRequestException(
        'Invalid recruitment data: check field ranges, references and dates',
      );
    throw mapDatabaseError(error, action);
  }

  async rpc<T = Record<string, unknown>>(
    name: string,
    args: object,
  ): Promise<T> {
    const { data, error } = await this.call(name, args);
    this.raise(error, 'process recruitment request');
    return camel(data) as T;
  }

  metrics(actor: string, org: string, date?: string) {
    return this.rpc('recruitment_metrics', {
      p_actor: actor,
      p_org: org,
      p_date: date ?? null,
    });
  }

  jobDetail(actor: string, org: string, id: string) {
    return this.rpc('recruitment_job_detail', {
      p_actor: actor,
      p_org: org,
      p_job: id,
    });
  }

  jobStats(actor: string, org: string, id: string) {
    return this.rpc('recruitment_job_stats', {
      p_actor: actor,
      p_org: org,
      p_job: id,
    });
  }

  pipeline(actor: string, org: string, id: string, limit = 50) {
    return this.rpc('recruitment_pipeline', {
      p_actor: actor,
      p_org: org,
      p_job: id,
      p_limit: limit,
    });
  }

  /**
   * Omit page and limit to receive every matching job. Large result sets are
   * accumulated in bounded batches rather than one oversized response.
   */
  async listJobs(actor: string, org: string, q: JobListQueryDto) {
    const filters = {
      p_actor: actor,
      p_org: org,
      p_status: q.status ?? null,
      p_department: q.departmentId ?? null,
      p_search: q.search ?? null,
    };
    if (q.page !== undefined || q.limit !== undefined) {
      const limit = q.limit ?? 50;
      return this.rpc<PagedItems>('recruitment_job_list', {
        ...filters,
        p_limit: limit,
        p_offset: ((q.page ?? 1) - 1) * limit,
      });
    }
    return this.collect('recruitment_job_list', filters);
  }

  async listCandidates(actor: string, org: string, q: CandidateListQueryDto) {
    const filters = {
      p_actor: actor,
      p_org: org,
      p_job: q.jobId ?? null,
      p_stage: q.stageId ?? null,
      p_status: q.status ?? null,
      p_search: q.search ?? null,
    };
    if (q.page !== undefined || q.limit !== undefined) {
      const limit = q.limit ?? 50;
      return this.rpc<PagedItems>('recruitment_candidate_list', {
        ...filters,
        p_limit: limit,
        p_offset: ((q.page ?? 1) - 1) * limit,
      });
    }
    return this.collect('recruitment_candidate_list', filters);
  }

  private async collect(name: string, filters: object): Promise<PagedItems> {
    const items: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 0; page < UNPAGINATED_MAX_PAGES; page += 1) {
      const batch = await this.rpc<PagedItems>(name, {
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

  private async mutate(
    actor: string,
    org: string,
    action: string,
    id: string | null,
    data: object,
  ) {
    const result = await this.rpc<Record<string, unknown>>(
      'recruitment_mutate',
      {
        p_actor: actor,
        p_org: org,
        p_action: action,
        p_id: id,
        p_data: data,
      },
    );
    await this.drainAutomationNotifications(result);
    return result;
  }

  private async drainAutomationNotifications(result: Record<string, unknown>) {
    if (!this.notifications || !Array.isArray(result.automations)) return;
    if (result.automations.length === 0) return;
    try {
      await this.notifications.process();
    } catch {
      this.logger.warn(
        'Stage automation messages remain queued for retry after delivery failed',
      );
    }
  }

  async saveJob(
    actor: string,
    org: string,
    id: string | null,
    dto: CreateJobDto | UpdateJobDto,
  ) {
    const { data, error } = await this.call('recruitment_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'job.save',
      p_id: id,
      p_data: dto,
    });
    if (error && ['PT409', '40001'].includes(error.code)) {
      throw new ConflictException({
        message:
          'This job changed since the form was loaded. Reload the job to review the current values, then save again; expectedRevision is optional and can be omitted to overwrite.',
        error: 'Conflict',
        code: 'JOB_REVISION_CONFLICT',
        details: {
          jobId: id,
          expectedRevision:
            (dto as { expectedRevision?: number }).expectedRevision ?? null,
          currentRevision: id ? await this.currentRevision(org, id) : null,
          reloadUrl: id ? JOB_RELOAD_URL(id) : null,
        },
      });
    }
    this.raise(error, 'save job');
    return camel(data);
  }

  private async currentRevision(
    org: string,
    id: string,
  ): Promise<number | null> {
    try {
      const { data, error } = await this.supabase.adminClient
        .from('jobs')
        .select('revision')
        .eq('organization_id', org)
        .eq('id', id)
        .abortSignal(AbortSignal.timeout(3000))
        .maybeSingle();
      if (error) return null;
      const row = data as { revision?: number } | null;
      return Number.isInteger(row?.revision) ? (row!.revision as number) : null;
    } catch {
      // Preserve the original conflict when the optional lookup fails.
      return null;
    }
  }

  publishJob(actor: string, org: string, id: string) {
    return this.mutate(actor, org, 'job.publish', id, {});
  }

  setStatus(actor: string, org: string, id: string, status: string) {
    return this.mutate(actor, org, 'job.status', id, { status });
  }

  saveCandidate(
    actor: string,
    org: string,
    id: string | null,
    dto: CreateCandidateDto | UpdateCandidateDto,
  ) {
    return this.mutate(actor, org, 'candidate.save', id, dto);
  }

  advanceCandidate(
    actor: string,
    org: string,
    id: string,
    dto: AdvanceCandidateDto,
  ) {
    return this.mutate(actor, org, 'candidate.advance', id, dto);
  }
}

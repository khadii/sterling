import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { camel } from '../common/serialize';
import { UploadedFile } from '../common/types/uploaded-file.type';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationService } from '../notifications/notification.service';
import { AUTOMATION_CATALOG } from './automation-catalog';
import {
  AdvanceCandidateDto,
  AutomationListQueryDto,
  CandidateListQueryDto,
  CreateCandidateDto,
  CreateJobDto,
  JobListQueryDto,
  UpdateCandidateDto,
  UpdateJobDto,
} from './recruitment.dto';
import {
  PublicJobApplicationDto,
  PublicJobListQueryDto,
} from './public-jobs.dto';

/** Sentence case for the pages a client should reload after a conflict. */
const JOB_RELOAD_URL = (id: string) => `/api/v1/employer/jobs/${id}`;
const UNPAGINATED_PAGE = 200;
const UNPAGINATED_MAX_PAGES = 50;
const RESUME_BUCKET = 'resumes';
const RESUME_MAX_SIZE = 5_242_880;
const RESUME_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

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
        'This record already exists: check the job reference, candidate email, stage name or automation label',
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

  managePipeline(
    actor: string,
    org: string,
    job: string,
    action: string,
    stage: string | null = null,
    automation: string | null = null,
    data: object = {},
  ) {
    return this.rpc('recruitment_pipeline_manage', {
      p_actor: actor,
      p_org: org,
      p_job: job,
      p_action: action,
      p_stage: stage,
      p_automation: automation,
      p_data: data,
    });
  }

  async automationCatalog(actor: string, org: string) {
    await this.rpc('recruitment_require', {
      p_actor: actor,
      p_org: org,
      p_permission: 'jobs.view',
    });
    return {
      schemaVersion: 1,
      items: AUTOMATION_CATALOG,
      total: AUTOMATION_CATALOG.length,
    };
  }

  listAutomations(actor: string, org: string, q: AutomationListQueryDto) {
    const paginated = q.page !== undefined || q.limit !== undefined;
    const limit = paginated ? (q.limit ?? 50) : null;
    return this.rpc('recruitment_automation_list', {
      p_actor: actor,
      p_org: org,
      p_enabled: q.enabled ?? null,
      p_job: q.jobId ?? null,
      p_stage: q.stageId ?? null,
      p_kind: q.kind ?? null,
      p_limit: limit,
      p_offset: limit === null ? 0 : ((q.page ?? 1) - 1) * limit,
    });
  }

  metrics(actor: string, org: string, date?: string) {
    return this.rpc('recruitment_metrics', {
      p_actor: actor,
      p_org: org,
      p_date: date ?? null,
    });
  }

  publicJobs(q: PublicJobListQueryDto) {
    return this.rpc<{
      items: Record<string, unknown>[];
      total: number;
      limit: number;
      offset: number;
    }>('recruitment_public_jobs', {
      p_org: q.organizationId ?? null,
      p_search: q.search ?? null,
      p_organization: q.organization ?? null,
      p_department: q.department ?? null,
      p_work_arrangement: q.workArrangement ?? null,
      p_employment_type: q.employmentType ?? null,
      p_location: q.location ?? null,
      p_posted_from: q.postedFrom ?? null,
      p_posted_to: q.postedTo ?? null,
      p_limit: q.limit ?? 50,
      p_offset: q.offset ?? 0,
    });
  }

  async publicJobDetail(id: string) {
    // Explicit projection avoids exposing internal hiring and workflow data.
    const { data, error } = await this.supabase.adminClient.from('jobs')
      .select(`id,public_slug,title,summary,organization_id,work_arrangement,employment_type,
        seniority_level,location_city,location_country,salary_min,salary_max,currency,posted_on,closes_on,
        experience_min_years,education_requirement,primary_tooling,
        organizations!inner(name),departments(name),
        job_responsibilities(body,display_order),job_qualifications(body,kind,display_order),
        job_skills(name,level,is_required,display_order),job_benefits(label,display_order)`)
      .eq('id', id).eq('status', 'open').not('published_at', 'is', null)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load public job');
    if (!data) throw new NotFoundException('Job not found or not publicly available');
    const row = data as unknown as Record<string, unknown>;
    const named = (value: unknown) => {
      const item = Array.isArray(value) ? value[0] : value;
      return item && typeof item === 'object' ? (item as { name?: string }).name ?? null : null;
    };
    const ordered = (value: unknown) => Array.isArray(value)
      ? [...value].sort((a, b) => a.display_order - b.display_order) : [];
    const { organizations, departments, job_responsibilities, job_qualifications, job_skills, job_benefits, ...job } = row;
    return camel({ ...job, organization_name: named(organizations), department_name: named(departments),
      responsibilities: ordered(job_responsibilities), qualifications: ordered(job_qualifications),
      skills: ordered(job_skills), benefits: ordered(job_benefits) });
  }

  async publicApply(
    jobId: string,
    dto: PublicJobApplicationDto,
    resume?: UploadedFile,
  ) {
    const resumeUrl = resume
      ? await this.uploadResume(jobId, resume)
      : dto.resumeUrl;
    return this.rpc<Record<string, unknown>>('recruitment_public_apply', {
      p_job: jobId,
      p_data: { ...dto, ...(resumeUrl !== undefined ? { resumeUrl } : {}) },
    });
  }

  private async uploadResume(jobId: string, resume: UploadedFile): Promise<string> {
    if (!resume.size || resume.size > RESUME_MAX_SIZE) {
      throw new BadRequestException('Resume must be between 1 byte and 5 MB');
    }
    if (!RESUME_CONTENT_TYPES.includes(resume.mimetype)) {
      throw new BadRequestException(
        'Resume must be a PDF, Word document or plain text file',
      );
    }
    const extension = resume.mimetype === 'application/pdf'
      ? 'pdf'
      : resume.mimetype.includes('wordprocessingml')
        ? 'docx'
        : resume.mimetype === 'application/msword'
          ? 'doc'
          : 'txt';
    const path = `${jobId}/${randomUUID()}/resume.${extension}`;
    const { error } = await this.supabase.adminClient.storage
      .from(RESUME_BUCKET)
      .upload(path, resume.buffer, {
        contentType: resume.mimetype,
        upsert: false,
      });
    if (error) {
      throw new ServiceUnavailableException('Unable to store resume upload');
    }
    return path;
  }

  async candidateResumeUrl(actor: string, org: string, candidateId: string) {
    await this.rpc('recruitment_require', {
      p_actor: actor,
      p_org: org,
      p_permission: 'jobs.view',
    });
    const { data, error } = await this.supabase.adminClient
      .from('candidates')
      .select('resume_url')
      .eq('id', candidateId)
      .eq('organization_id', org)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load candidate resume');
    const row = data as { resume_url: string | null } | null;
    if (!row?.resume_url) throw new NotFoundException('No resume attached');
    if (/^https?:\/\//i.test(row.resume_url)) {
      return { url: row.resume_url };
    }
    const { data: signed, error: signError } = await this.supabase.adminClient.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(row.resume_url, 3600);
    if (signError || !signed) {
      throw new ServiceUnavailableException('Unable to sign resume download');
    }
    return { url: signed.signedUrl };
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

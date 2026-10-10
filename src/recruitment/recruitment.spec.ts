import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';
import {
  AdvanceCandidateDto,
  CreateCandidateDto,
  CreateJobDto,
  JobListQueryDto,
  PipelineStageDto,
  ScreeningQuestionDto,
} from './recruitment.dto';

const actor = '8a53bff5-a952-4ad7-b466-730659020a8e';
const departmentId = '2cd538d0-441c-42f3-816c-92495ad508f5';
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const translate = (
  metatype: unknown,
  value: Record<string, unknown>,
  type: 'body' | 'query' = 'body',
) =>
  pipe.transform(value, {
    type,
    metatype: metatype as never,
  });

describe('Recruitment contract', () => {
  it('validates the create-job payload and its nested collections', async () => {
    await expect(
      translate(CreateJobDto, { title: 'Senior Product Designer' }),
    ).resolves.toMatchObject({ title: 'Senior Product Designer' });
    await expect(
      translate(CreateJobDto, { title: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        workArrangement: 'anywhere',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        locationCountry: 'Nigeria',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        departmentId,
        positions: 2,
        salaryMin: 120000,
        salaryMax: 150000,
        currency: 'USD',
        responsibilities: [{ body: 'Design token systems scaling' }],
        qualifications: [{ kind: 'preferred', body: 'WCAG AA familiarity' }],
        skills: [{ name: 'Figma', level: 'expert', isRequired: true }],
        benefits: [{ label: 'Comprehensive Health Insurance' }],
        hiringTeam: [{ userId: actor, roleLabel: 'Hiring Lead', isLead: true }],
        channels: [{ channel: 'careers_page', isEnabled: true }],
        stages: [{ name: 'Screening', category: 'screening' }],
      }),
    ).resolves.toMatchObject({
      departmentId,
      skills: [{ name: 'Figma', level: 'expert' }],
      stages: [{ name: 'Screening' }],
    });
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        stages: [{ name: 'Screening', category: 'sometime' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        channels: [{ channel: 'twitter' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(CreateJobDto, {
        title: 'Senior Product Designer',
        unexpected: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates stage assessments and screening questions', async () => {
    await expect(
      translate(PipelineStageDto, {
        name: 'Assessment',
        category: 'assessment',
        isAssessment: true,
        assessment: {
          durationMinutes: 45,
          format: '2 challenges',
          pointsTotal: 50,
          passingPercent: 80,
        },
        automations: [
          {
            kind: 'calendar',
            label: 'Schedule interview via Calendly',
            isEnabled: true,
          },
        ],
      }),
    ).resolves.toMatchObject({ name: 'Assessment', isAssessment: true });
    await expect(
      translate(PipelineStageDto, { name: 'Assessment', accent: 'blue' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(ScreeningQuestionDto, {
        prompt: 'How many years of SaaS product design experience?',
        kind: 'number',
        threshold: '5+ years',
        weight: 50,
        isRequired: true,
      }),
    ).resolves.toMatchObject({ kind: 'number', weight: 50 });
    await expect(
      translate(ScreeningQuestionDto, { prompt: 'Too short', weight: 140 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates candidates, stage moves and numeric pagination', async () => {
    await expect(
      translate(CreateCandidateDto, {
        jobId: actor,
        fullName: 'Sarah Johnson',
        email: 'sarah.johnson@example.com',
        source: 'linkedin',
        matchScore: 94,
      }),
    ).resolves.toMatchObject({ matchScore: 94 });
    await expect(
      translate(CreateCandidateDto, {
        jobId: actor,
        fullName: 'Sarah Johnson',
        email: 'not-an-email',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(AdvanceCandidateDto, { stageId: actor, status: 'ghosted' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate(JobListQueryDto, { page: '2', limit: '25' }, 'query'),
    ).resolves.toMatchObject({ page: 2, limit: 25 });
    await expect(
      translate(JobListQueryDto, { limit: '500' }, 'query'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps database errors onto the API error contract', async () => {
    const serviceFor = (code: string, message: string) =>
      new RecruitmentService({
        adminClient: {
          rpc: jest.fn(() => ({
            abortSignal: jest.fn().mockResolvedValue({
              data: null,
              error: { code, message },
            }),
          })),
        },
      } as unknown as SupabaseService);
    await expect(
      serviceFor(
        '57014',
        'canceling statement due to statement timeout',
      ).metrics(actor, actor),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      serviceFor('22023', 'Stage does not belong to this job').advanceCandidate(
        actor,
        actor,
        departmentId,
        { stageId: actor },
      ),
    ).rejects.toMatchObject({
      message: 'Stage does not belong to this job',
    });
    await expect(
      serviceFor('42501', 'Permission required: jobs.view').metrics(
        actor,
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns domain errors for unknown records and stale revisions', async () => {
    const notFound = new RecruitmentService({
      adminClient: {
        rpc: jest.fn(() => ({
          abortSignal: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'P0002', message: 'Job not found' },
          }),
        })),
      },
    } as unknown as SupabaseService);
    await expect(
      notFound.jobDetail(actor, actor, departmentId),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stale = new RecruitmentService({
      adminClient: {
        rpc: jest.fn(() => ({
          abortSignal: jest.fn().mockResolvedValue({
            data: null,
            error: {
              code: 'PT409',
              message: 'Job changed since this form was loaded',
            },
          }),
        })),
        from: jest.fn(() => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                abortSignal: () => ({
                  maybeSingle: () => Promise.resolve({ data: { revision: 7 } }),
                }),
              }),
            }),
          }),
        })),
      },
    } as unknown as SupabaseService);
    let conflict: ConflictException | undefined;
    try {
      await stale.saveJob(actor, actor, departmentId, {
        title: 'Senior Product Designer',
        expectedRevision: 2,
      });
    } catch (error) {
      conflict = error as ConflictException;
    }
    expect(conflict?.getResponse()).toMatchObject({
      code: 'JOB_REVISION_CONFLICT',
      details: { currentRevision: 7, expectedRevision: 2 },
    });
  });

  it('accumulates every page when no pagination is supplied', async () => {
    const responses = [
      { items: new Array(200).fill({ id: actor }), total: 250 },
      { items: new Array(50).fill({ id: actor }), total: 250 },
    ];
    const rpc = jest.fn(() => ({
      abortSignal: jest.fn().mockResolvedValue({
        data: responses.shift() ?? { items: [], total: 250 },
        error: null,
      }),
    }));
    const service = new RecruitmentService({
      adminClient: { rpc },
    } as unknown as SupabaseService);
    const result = await service.listJobs(actor, actor, {});
    expect(result.total).toBe(250);
    expect(result.items).toHaveLength(250);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('documents the jobs dashboard and job routes', async () => {
    const module = await Test.createTestingModule({
      controllers: [RecruitmentController],
      providers: [{ provide: RecruitmentService, useValue: {} }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths['/employer/jobs/metrics'].get).toBeDefined();
      expect(doc.paths['/employer/jobs'].get?.responses['200']).toBeDefined();
      expect(doc.paths['/employer/jobs'].post?.responses['201']).toBeDefined();
      expect(doc.paths['/employer/jobs/{id}'].patch).toBeDefined();
      expect(doc.paths['/employer/jobs/{id}/publish'].post).toBeDefined();
      expect(doc.paths['/employer/jobs/{id}/pipeline'].get).toBeDefined();
      expect(doc.paths['/employer/candidates/{id}/advance'].post).toBeDefined();
      expect(doc.components?.schemas?.RecruitmentSummaryDto).toMatchObject({
        properties: { openJobs: { type: 'number', example: 12 } },
      });
      expect(doc.components?.schemas?.ApplicationSourceDto).toMatchObject({
        properties: { percent: { type: 'number', nullable: true } },
      });
    } finally {
      await app.close();
    }
  });
});

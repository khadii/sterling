import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { PublicJobApplicationDto, PublicJobListQueryDto } from './public-jobs.dto';
import { PublicJobsController } from './public-jobs.controller';
import { RecruitmentService } from './recruitment.service';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

function serviceReturning(data: unknown) {
  const rpc = jest.fn(() => ({
    abortSignal: jest.fn().mockResolvedValue({ data, error: null }),
  }));
  const service = new RecruitmentService({
    adminClient: { rpc },
  } as unknown as SupabaseService);
  return { service, rpc };
}

describe('Public jobs board', () => {
  it('validates the public query filters', async () => {
    await expect(
      pipe.transform(
        {
          workArrangement: 'hybrid',
          employmentType: 'full_time',
          limit: '20',
          offset: '10',
          postedFrom: '2026-10-01',
          postedTo: '2026-11-22',
        },
        { type: 'query', metatype: PublicJobListQueryDto },
      ),
    ).resolves.toMatchObject({ workArrangement: 'hybrid', limit: 20, offset: 10 });
    await expect(
      pipe.transform(
        { workArrangement: 'anywhere' },
        { type: 'query', metatype: PublicJobListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { limit: '500' },
        { type: 'query', metatype: PublicJobListQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes filters through to the public list function', async () => {
    const { service, rpc } = serviceReturning({ items: [], total: 0, limit: 50, offset: 0 });
    await service.publicJobs({
      organizationId: '2cd538d0-441c-42f3-816c-92495ad508f5',
      search: 'designer',
      workArrangement: 'hybrid',
      postedFrom: '2026-10-01',
    });
    expect(rpc).toHaveBeenCalledWith('recruitment_public_jobs', {
      p_org: '2cd538d0-441c-42f3-816c-92495ad508f5',
      p_search: 'designer',
      p_organization: null,
      p_department: null,
      p_work_arrangement: 'hybrid',
      p_employment_type: null,
      p_location: null,
      p_posted_from: '2026-10-01',
      p_posted_to: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('camel-cases the public job rows', async () => {
    const { service } = serviceReturning({
      items: [
        {
          id: '2cd538d0-441c-42f3-816c-92495ad508f5',
          public_slug: 'senior-product-designer-ab12cd',
          title: 'Senior Product Designer',
          organization_id: '2cd538d0-441c-42f3-816c-92495ad508f5',
          organization_name: 'Sterling Tech',
          department_name: 'Product',
          work_arrangement: 'hybrid',
          employment_type: 'full_time',
          location_city: 'Lagos',
          salary_min: 120000,
          posted_on: '2026-11-22',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const result = await service.publicJobs({});
    expect(result.items[0]).toMatchObject({
      publicSlug: 'senior-product-designer-ab12cd',
      organizationName: 'Sterling Tech',
      departmentName: 'Product',
      workArrangement: 'hybrid',
      salaryMin: 120000,
      postedOn: '2026-11-22',
    });
  });

  it('validates the public application payload', async () => {
    await expect(
      pipe.transform(
        {
          fullName: 'Sarah Johnson',
          email: 'sarah.johnson@example.com',
          phone: '+2348012345678',
          resumeUrl: 'https://example.com/sarah.pdf',
          currentRole: 'UX Designer',
          currentCompany: 'Google',
        },
        { type: 'body', metatype: PublicJobApplicationDto },
      ),
    ).resolves.toMatchObject({ fullName: 'Sarah Johnson', email: 'sarah.johnson@example.com' });
    await expect(
      pipe.transform(
        { fullName: 'Sarah', email: 'not-an-email' },
        { type: 'body', metatype: PublicJobApplicationDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { fullName: '', email: 'sarah@example.com' },
        { type: 'body', metatype: PublicJobApplicationDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submits a public application through the jobs route', async () => {
    const publicApply = jest.fn().mockResolvedValue({
      id: '2cd538d0-441c-42f3-816c-92495ad508f5',
      jobId: '2cd538d0-441c-42f3-816c-92495ad508f5',
      jobTitle: 'Senior Product Designer',
      fullName: 'Sarah Johnson',
      email: 'sarah.johnson@example.com',
      status: 'new',
      appliedAt: '2026-11-22T12:00:00Z',
    });
    const module = await Test.createTestingModule({
      controllers: [PublicJobsController],
      providers: [{ provide: RecruitmentService, useValue: { publicApply } }],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(pipe);
    await app.init();
    try {
      await request(app.getHttpServer() as Server)
        .post('/jobs/2cd538d0-441c-42f3-816c-92495ad508f5/apply')
        .send({
          fullName: 'Sarah Johnson',
          email: 'sarah.johnson@example.com',
        })
        .expect(201);
      expect(publicApply).toHaveBeenCalledWith(
        '2cd538d0-441c-42f3-816c-92495ad508f5',
        expect.objectContaining({ fullName: 'Sarah Johnson' }),
        undefined,
      );

      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths['/jobs/{id}/apply'].post).toBeDefined();
      expect(doc.paths['/jobs/{id}/apply'].post?.security).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('passes the camelCase application payload expected by the database', async () => {
    const rpc = jest.fn(() => ({
      abortSignal: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }),
    }));
    const service = new RecruitmentService({
      adminClient: { rpc },
    } as unknown as SupabaseService);
    await service.publicApply('2cd538d0-441c-42f3-816c-92495ad508f5', {
      fullName: 'Sarah Johnson',
      email: 'sarah.johnson@example.com',
      currentRole: 'UX Designer',
      currentCompany: 'Google',
      resumeUrl: 'https://example.com/resume.pdf',
    });
    expect(rpc).toHaveBeenCalledWith('recruitment_public_apply', {
      p_job: '2cd538d0-441c-42f3-816c-92495ad508f5',
      p_data: {
        fullName: 'Sarah Johnson',
        email: 'sarah.johnson@example.com',
        currentRole: 'UX Designer',
        currentCompany: 'Google',
        resumeUrl: 'https://example.com/resume.pdf',
      },
    });
  });

  it('uploads a resume file privately and stores its storage path', async () => {
    const upload = jest.fn(() => ({ error: null }));
    const storage = { from: jest.fn(() => ({ upload })) };
    const rpc = jest.fn(() => ({
      abortSignal: jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null }),
    }));
    const service = new RecruitmentService({
      adminClient: { rpc, storage },
    } as unknown as SupabaseService);
    const file = {
      buffer: Buffer.from('pdf-bytes'),
      mimetype: 'application/pdf',
      originalname: 'resume.pdf',
      size: 10,
    };
    await service.publicApply(
      '2cd538d0-441c-42f3-816c-92495ad508f5',
      { fullName: 'Sarah Johnson', email: 'sarah.johnson@example.com' },
      file,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    const path = (upload.mock.calls[0] as unknown[])[0] as string;
    expect(path).toMatch(/^2cd538d0-441c-42f3-816c-92495ad508f5\/.+\/resume\.pdf$/);
    expect(rpc).toHaveBeenCalledWith('recruitment_public_apply', {
      p_job: '2cd538d0-441c-42f3-816c-92495ad508f5',
      p_data: expect.objectContaining({
        resumeUrl: expect.stringMatching(/^2cd538d0-441c-42f3-816c-92495ad508f5\//),
      }),
    });
  });

  it('rejects unsupported resume file types', async () => {
    const service = new RecruitmentService({
      adminClient: { rpc: jest.fn(), storage: { from: jest.fn() } },
    } as unknown as SupabaseService);
    await expect(
      service.publicApply(
        '2cd538d0-441c-42f3-816c-92495ad508f5',
        { fullName: 'Sarah', email: 'sarah@example.com' },
        {
          buffer: Buffer.from('x'),
          mimetype: 'application/zip',
          originalname: 'resume.zip',
          size: 10,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('signs an uploaded resume instead of exposing a public URL', async () => {
    const createSignedUrl = jest.fn(() => ({
      data: { signedUrl: 'https://signed.example.com/resume.pdf' },
      error: null,
    }));
    const storage = {
      from: jest.fn(() => ({ createSignedUrl })),
    };
    const rpc = jest.fn(() => ({
      abortSignal: jest.fn().mockResolvedValue({ data: {}, error: null }),
    }));
    const from = jest.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { resume_url: '2cd538d0-441c-42f3-816c-92495ad508f5/resume.pdf' },
                error: null,
              }),
          }),
        }),
      }),
    }));
    const service = new RecruitmentService({
      adminClient: { rpc, storage, from },
    } as unknown as SupabaseService);
    const result = await service.candidateResumeUrl(
      'actor-id',
      '2cd538d0-441c-42f3-816c-92495ad508f5',
      'candidate-id',
    );
    expect(result.url).toBe('https://signed.example.com/resume.pdf');
    expect(createSignedUrl).toHaveBeenCalledWith(
      '2cd538d0-441c-42f3-816c-92495ad508f5/resume.pdf',
      3600,
    );
  });

  it('serves the jobs route without an auth guard and documents it', async () => {
    const publicJobs = jest.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    const publicJobDetail = jest.fn().mockResolvedValue({ id: '2cd538d0-441c-42f3-816c-92495ad508f5', title: 'Designer' });
    const module = await Test.createTestingModule({
      controllers: [PublicJobsController],
      providers: [{ provide: RecruitmentService, useValue: { publicJobs, publicJobDetail } }],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(pipe);
    await app.init();
    try {
      await request(app.getHttpServer() as Server)
        .get('/jobs?workArrangement=remote')
        .expect(200);
      expect(publicJobs).toHaveBeenCalledWith(
        expect.objectContaining({ workArrangement: 'remote' }),
      );

      await request(app.getHttpServer() as Server).get('/jobs/2cd538d0-441c-42f3-816c-92495ad508f5').expect(200);
      expect(publicJobDetail).toHaveBeenCalledWith('2cd538d0-441c-42f3-816c-92495ad508f5');
      await request(app.getHttpServer() as Server).get('/jobs/not-a-uuid').expect(400);
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths['/jobs'].get).toBeDefined();
      expect(doc.paths['/jobs/{id}'].get).toBeDefined();
      expect(doc.paths['/jobs/{id}'].get?.security).toBeUndefined();
      expect(doc.paths['/jobs'].get?.security).toBeUndefined();
      expect(doc.components?.schemas?.PublicJobListItemDto).toMatchObject({
        properties: {
          organizationName: { type: 'string' },
          departmentName: { type: 'string', nullable: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});

describe('public job detail', () => {
  const id = '2cd538d0-441c-42f3-816c-92495ad508f5';
  function setup(data: unknown, error: unknown = null) {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'eq', 'not']) query[method] = jest.fn(() => query);
    query.maybeSingle = jest.fn().mockResolvedValue({ data, error });
    const from = jest.fn(() => query);
    return { query, service: new RecruitmentService({ adminClient: { from } } as unknown as SupabaseService) };
  }
  it('returns public fields, named department and ordered details only for open published jobs', async () => {
    const { service, query } = setup({ id, title: 'Designer', organizations: { name: 'Acme' },
      departments: { name: 'Product' }, job_responsibilities: [{ body: 'Second', display_order: 2 }, { body: 'First', display_order: 1 }],
      job_qualifications: [], job_skills: [], job_benefits: [] });
    await expect(service.publicJobDetail(id)).resolves.toMatchObject({ id, title: 'Designer',
      organizationName: 'Acme', departmentName: 'Product', responsibilities: [{ body: 'First', displayOrder: 1 }, { body: 'Second', displayOrder: 2 }], benefits: [] });
    expect(query.eq).toHaveBeenCalledWith('status', 'open');
    expect(query.not).toHaveBeenCalledWith('published_at', 'is', null);
    expect(query.select.mock.calls[0][0]).not.toMatch(/candidate|automation|expected_answer/);
  });
  it('returns 404 when the job is absent or not publicly available', async () => {
    const { service } = setup(null);
    await expect(service.publicJobDetail(id)).rejects.toMatchObject({ status: 404 });
  });
});

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

  it('snake-cases the application payload for the RPC', async () => {
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
    });
    expect(rpc).toHaveBeenCalledWith('recruitment_public_apply', {
      p_job: '2cd538d0-441c-42f3-816c-92495ad508f5',
      p_data: {
        full_name: 'Sarah Johnson',
        email: 'sarah.johnson@example.com',
        current_role: 'UX Designer',
      },
    });
  });

  it('serves the jobs route without an auth guard and documents it', async () => {
    const publicJobs = jest.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    const module = await Test.createTestingModule({
      controllers: [PublicJobsController],
      providers: [{ provide: RecruitmentService, useValue: { publicJobs } }],
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

      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(doc.paths['/jobs'].get).toBeDefined();
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

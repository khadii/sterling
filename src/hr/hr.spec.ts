import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService, camel } from './hr.service';
import { ZoomService } from './zoom.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  HrQueryDto,
  AttendanceDto,
  BulkDecisionDto,
  UpdateOnboardingDto,
} from './hr.dto';

const actor = '8a53bff5-a952-4ad7-b466-730659020a8e';
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
describe('HR contract', () => {
  it('preserves zero and null independently through nested responses', () => {
    expect(
      camel({
        headcount: 0,
        net_total: 0,
        capacity_percent: null,
        items: [{ annual_salary: 0 }],
      }),
    ).toEqual({
      headcount: 0,
      netTotal: 0,
      capacityPercent: null,
      items: [{ annualSalary: 0 }],
    });
  });
  it('validates dates, batches, partial updates and numeric pagination', async () => {
    await expect(
      pipe.transform(
        { date: '2026-02-31', employeeId: actor, hours: 8, state: 'present' },
        { type: 'body', metatype: AttendanceDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { ids: [], status: 'approved' },
        { type: 'body', metatype: BulkDecisionDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { hrNotes: 'Laptop delivered' },
        { type: 'body', metatype: UpdateOnboardingDto },
      ),
    ).resolves.toMatchObject({ hrNotes: 'Laptop delivered' });
    await expect(
      pipe.transform(
        { page: '2', limit: '25' },
        { type: 'query', metatype: HrQueryDto },
      ),
    ).resolves.toMatchObject({ page: 2, limit: 25 });
  });
  it.each([
    ['P0002', NotFoundException],
    ['42501', ForbiddenException],
    ['22023', BadRequestException],
    ['57014', ServiceUnavailableException],
  ])('maps %s without hanging', async (code, expected) => {
    const abortSignal = jest.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'HR request failed' },
    });
    const rpc = jest.fn().mockReturnValue({ abortSignal });
    const hr = new HrService({
      adminClient: { rpc },
    } as unknown as SupabaseService);
    await expect(hr.metrics(actor, actor)).rejects.toBeInstanceOf(expected);
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it('documents HR metrics and operations', async () => {
    const module = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrService, useValue: {} },
        { provide: ZoomService, useValue: {} },
      ],
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
      expect(
        doc.paths['/employer/hr/metrics'].get?.responses['200'],
      ).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/HrMetricsDto' },
          },
        },
      });
      expect(doc.components?.schemas?.HrSummaryDto).toMatchObject({
        properties: { headcount: { type: 'number', example: 0 } },
      });
      const schema = doc.components?.schemas?.HrQueryDto; // Query fields are flattened by Nest.
      const page = doc.paths['/employer/hr/employees'].get?.parameters?.find(
        (p) => 'name' in p && p.name === 'page',
      );
      expect(page).toMatchObject({ schema: { type: 'number' } });
      expect(page && 'required' in page ? page.required : undefined).toBeFalsy();
      expect(schema).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
describe('Zoom calendar action', () => {
  afterEach(() => jest.restoreAllMocks());
  it('fails clearly when workspace configuration is missing without creating a claim', async () => {
    const rpc = jest.fn().mockResolvedValue(null);
    const zoom = new ZoomService(
      { get: () => undefined } as unknown as ConfigService,
      { rpc } as unknown as HrService,
    );
    await expect(zoom.create(actor, actor, actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('uses the configured workspace host and stores only the attendee URL', async () => {
    const cfg = {
      accountId: 'account',
      clientId: 'client',
      clientSecret: 'secret',
      hostUserId: 'host@example.com',
    };
    const rpc = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        title: 'Review',
        startsAt: '2026-09-22T09:00:00Z',
        endsAt: '2026-09-22T10:00:00Z',
        timezone: 'Africa/Lagos',
      })
      .mockResolvedValueOnce({ meetingUrl: 'https://zoom.us/j/123' });
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 123,
            join_url: 'https://zoom.us/j/123',
            start_url: 'secret-host-url',
          }),
          { status: 201 },
        ),
      );
    const zoom = new ZoomService(
      {
        get: () => JSON.stringify({ [actor]: cfg }),
      } as unknown as ConfigService,
      { rpc } as unknown as HrService,
    );
    await expect(zoom.create(actor, actor, actor)).resolves.toEqual({
      meetingUrl: 'https://zoom.us/j/123',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.zoom.us/v2/users/host%40example.com/meetings',
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'hr_finish_zoom',
      expect.objectContaining({
        p_url: 'https://zoom.us/j/123',
        p_meeting: '123',
      }),
    );
  });
});

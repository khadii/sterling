import { Test } from '@nestjs/testing';
import {
  ValidationPipe,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { EmployerWorkspaceController } from './employer-workspace.controller';
import { EmployerWorkspaceService } from './employer-workspace.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { SupabaseService } from '../supabase/supabase.service';

const org = '8a53bff5-a952-4ad7-b466-730659020a8e';
const foreign = '8a53bff5-a952-4ad7-b466-730659020a8f';
const resource = '152d8fe4-4c96-4e1f-a336-88fa60762587';
const routes: [string, string, object?][] = [
  ['get', 'dashboard'],
  ['get', 'activities'],
  ['get', 'calendar/summary'],
  ['get', 'calendar/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z'],
  ['get', `calendar/events/${resource}`],
  ['delete', `calendar/events/${resource}`],
  [
    'post',
    'calendar/events',
    {
      kind: 'team_meeting',
      title: 'Planning',
      startsAt: '2026-09-20T09:00:00Z',
      endsAt: '2026-09-20T10:00:00Z',
      timezone: 'UTC',
    },
  ],
  ['patch', `calendar/events/${resource}`, { title: 'Updated planning' }],
  ['get', 'departments'],
  ['get', `departments/${resource}`],
  ['post', 'departments', { name: 'Engineering' }],
];
describe('All employer routes resolve workspace context', () => {
  let app: import('@nestjs/common').INestApplication<
    import('node:http').Server
  >;
  let memberships: string[];
  const workspace: Record<string, jest.Mock> = {};
  beforeAll(async () => {
    const supabase = {
      adminClient: {
        from: () => {
          let requested: string | undefined;
          const chain = {
            select: () => chain,
            eq: (key: string, value: string) => {
              if (key === 'organization_id') requested = value;
              return chain;
            },
            limit: () => chain,
            abortSignal: () =>
              Promise.resolve({
                data: memberships
                  .filter((id) => !requested || requested === id)
                  .map((organization_id) => ({ organization_id })),
                error: null,
              }),
          };
          return chain;
        },
      },
    } as unknown as SupabaseService;
    workspace.resolveOrganization = jest.fn(
      (user: string, header?: string, legacy?: string) =>
        resolveOrganization(supabase, user, header, legacy),
    );
    for (const name of [
      'dashboard',
      'activities',
      'calendarSummary',
      'calendarEvents',
      'calendarEvent',
      'deleteCalendarEvent',
      'createCalendarEvent',
      'updateCalendarEvent',
      'departments',
      'department',
      'createDepartment',
    ])
      workspace[name] = jest.fn((...args: unknown[]) => ({
        ok: true,
        context: args,
      }));
    const module = await Test.createTestingModule({
      controllers: [EmployerWorkspaceController],
      providers: [
        { provide: EmployerWorkspaceService, useValue: workspace },
        { provide: SupabaseService, useValue: supabase },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: { authorization?: string };
            user: unknown;
          }>();
          if (req.headers.authorization !== 'Bearer valid')
            throw new UnauthorizedException();
          req.user = { id: 'member', roles: [] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    memberships = [org];
    jest.clearAllMocks();
  });
  afterAll(async () => app.close());
  it.each(routes.map(([method, path, body]) => [method, path, body] as const))(
    '%s %s accepts no organization selector',
    async (method, path, body) => {
      const client = request(app.getHttpServer());
      const call =
        method === 'post'
          ? client.post(`/employer/${path}`)
          : method === 'patch'
            ? client.patch(`/employer/${path}`)
            : method === 'delete'
              ? client.delete(`/employer/${path}`)
              : client.get(`/employer/${path}`);
      if (body) call.send(body);
      await call
        .set('Authorization', 'Bearer valid')
        .expect(method === 'post' ? 201 : method === 'delete' ? 204 : 200);
      const actions = Object.entries(workspace)
        .filter(([name]) => name !== 'resolveOrganization')
        .flatMap(([, fn]) => fn.mock.calls as unknown[][]);
      expect(JSON.stringify(actions)).toContain(org);
    },
  );
  it('denies an organization the caller does not belong to', async () => {
    await request(app.getHttpServer())
      .get('/employer/dashboard')
      .set('Authorization', 'Bearer valid')
      .set('X-Organization-Id', foreign)
      .expect(403);
    expect(workspace.dashboard).not.toHaveBeenCalled();
  });
  it('rejects conflicting header and legacy selectors', async () => {
    await request(app.getHttpServer())
      .get(`/employer/dashboard?organizationId=${org}`)
      .set('Authorization', 'Bearer valid')
      .set('X-Organization-Id', foreign)
      .expect(400);
  });
  it('requires an explicit selection only for multiple memberships', async () => {
    memberships = [org, foreign];
    await request(app.getHttpServer())
      .get('/employer/dashboard')
      .set('Authorization', 'Bearer valid')
      .expect(400);
    await request(app.getHttpServer())
      .get('/employer/dashboard')
      .set('Authorization', 'Bearer valid')
      .set('X-Organization-Id', org)
      .expect(200);
  });
  it('still requires authentication', async () => {
    await request(app.getHttpServer()).get('/employer/dashboard').expect(401);
  });
  it('marks legacy organizationId optional in Swagger', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').build(),
    );
    const schemas = doc.components!.schemas!;
    expect(schemas.CreateCalendarEventDto).not.toMatchObject({
      required: expect.arrayContaining(['organizationId']) as unknown,
    });
    const params = doc.paths['/employer/dashboard'].get!.parameters!;
    expect(params).toContainEqual(
      expect.objectContaining({ name: 'organizationId', required: false }),
    );
  });
});

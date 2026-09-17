import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  DepartmentIconAdminController,
  DepartmentIconReferenceController,
} from './department-icons.controller';
import { DepartmentIconsService } from './department-icons.service';
import { PlatformIconGuard } from './platform-icon.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

jest.mock('../supabase/request-timeout', () => {
  const real = jest.requireActual<typeof import('../supabase/request-timeout')>(
    '../supabase/request-timeout',
  );
  return {
    ...real,
    withRequestDeadline: <T>(value: PromiseLike<T>) =>
      real.withRequestDeadline(value, 30),
  };
});

describe('Icon GET requests through real controllers and guards', () => {
  let app: INestApplication;
  let stalled: string;
  let activeFilter: jest.Mock;
  const never = () => new Promise(() => {});
  beforeEach(async () => {
    stalled = '';
    activeFilter = jest.fn().mockReturnThis();
    const supabase = {
      publicClient: {
        auth: {
          getUser: () =>
            stalled === 'auth'
              ? never()
              : Promise.resolve({
                  data: { user: { id: 'actor' } },
                  error: null,
                }),
        },
      },
      adminClient: {
        from: (table: string) => {
          const data =
            table === 'user_roles'
              ? [{ role_id: 'admin' }]
              : table === 'role_permissions'
                ? [{ role_id: 'admin' }]
                : [
                    {
                      id: 'icon',
                      name: 'Example',
                      is_active: true,
                      builtin_key: null,
                      storage_path: 'published/icon.png',
                    },
                  ];
          const promise =
            table === stalled
              ? never()
              : Promise.resolve({ data, error: null, count: 1 });
          return {
            select: jest.fn().mockReturnThis(),
            eq: activeFilter,
            in: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            range: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            then: promise.then.bind(promise),
          };
        },
        storage: {
          from: () => ({
            createSignedUrls: () =>
              stalled === 'storage'
                ? never()
                : Promise.resolve({
                    data: [
                      {
                        path: 'published/icon.png',
                        signedUrl: 'https://example.test/icon.png',
                        error: null,
                      },
                    ],
                    error: null,
                  }),
          }),
        },
      },
    };
    const module = await Test.createTestingModule({
      controllers: [
        DepartmentIconAdminController,
        DepartmentIconReferenceController,
      ],
      providers: [
        DepartmentIconsService,
        PlatformIconGuard,
        SupabaseAuthGuard,
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });
  it('documents pagination as integers rather than object editors', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const route of ['admin', 'reference']) {
      const parameters =
        doc.paths[`/api/v1/${route}/department-icons`].get!.parameters!;
      expect(parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'page',
            schema: expect.objectContaining({ type: 'integer', default: 1 }),
          }),
          expect.objectContaining({
            name: 'limit',
            schema: expect.objectContaining({
              type: 'integer',
              default: 50,
              maximum: 100,
            }),
          }),
        ]),
      );
      expect(JSON.stringify(parameters)).not.toContain(
        '#/components/schemas/Object',
      );
    }
  });
  afterEach(async () => {
    await app.close();
  });
  it.each(['admin', 'reference'])(
    '%s returns JSON for a healthy request',
    async (route) => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/${route}/department-icons`)
        .set('Authorization', 'Bearer test')
        .expect(200);
      expect(res.body.items[0].url).toBe('https://example.test/icon.png');
      if (route === 'reference')
        expect(activeFilter).toHaveBeenCalledWith('is_active', true);
    },
  );
  it.each(['auth', 'user_roles', 'role_permissions', 'department_icons'])(
    'admin returns 503 if %s stalls',
    async (stage) => {
      stalled = stage;
      await request(app.getHttpServer())
        .get('/api/v1/admin/department-icons')
        .set('Authorization', 'Bearer test')
        .expect(503);
    },
  );
  it('reference returns 503 if the catalogue query stalls', async () => {
    stalled = 'department_icons';
    await request(app.getHttpServer())
      .get('/api/v1/reference/department-icons')
      .set('Authorization', 'Bearer test')
      .expect(503);
  });
  it('returns catalogue data even when signing stalls', async () => {
    stalled = 'storage';
    const res = await request(app.getHttpServer())
      .get('/api/v1/reference/department-icons')
      .set('Authorization', 'Bearer test')
      .expect(200);
    expect(res.body.items[0].url).toBeNull();
  });
  it('rejects missing credentials immediately', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reference/department-icons')
      .expect(401);
  });
});

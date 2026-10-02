import { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { TaskAttachmentsService } from './task-attachments.service';
import { EmployerWorkspaceService } from '../employer-workspace/employer-workspace.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { RequestWithUser } from '../common/types/request-with-user.type';

describe('Role write HTTP and Swagger contract', () => {
  const roleId = '152d8fe4-4c96-4e1f-a336-88fa60762587';
  const org = '35826d6c-937d-4726-9a25-5bdbb492744a';
  let app: INestApplication;
  let rpc: jest.Mock;
  let query: {
    select: jest.Mock;
    eq: jest.Mock;
    in: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    maybeSingle: jest.Mock;
    abortSignal: jest.Mock;
  };
  let result: { data: object | null; error: object | null };
  beforeEach(async () => {
    result = {
      data: {
        id: roleId,
        name: 'Team Coordinator',
        revision: 1,
        permissionIds: ['teams.view'],
      },
      error: null,
    };
    rpc = jest.fn().mockImplementation(() => ({
      abortSignal: () => Promise.resolve(result),
    }));
    query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      abortSignal: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { revision: 7 }, error: null }),
    };
    const module = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        WorkflowService,
        {
          provide: SupabaseService,
          useValue: { adminClient: { rpc, from: () => query } },
        },
        { provide: TaskAttachmentsService, useValue: {} },
        { provide: EmployerWorkspaceService, useValue: {} },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<RequestWithUser>().user = {
            id: 'actor',
            roles: ['employer'],
          };
          return true;
        },
      })
      .compile();
    jest
      .spyOn(module.get(WorkflowService), 'organization')
      .mockResolvedValue(org);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('executes every documented creation example as one mutation with no existing ID', async () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').build(),
    );
    const operation = doc.paths['/api/v1/organization/roles'].post!;
    const body = operation.requestBody as {
      content: {
        'application/json': { examples: Record<string, { value: object }> };
      };
    };
    expect(doc.components!.schemas!.CreateRoleDto).not.toHaveProperty(
      'properties.expectedRevision',
    );
    expect(doc.components!.schemas!.WorkflowRoleResponseDto).not.toHaveProperty(
      'properties.expectedRevision',
    );
    expect(doc.components!.schemas!.UpdateRoleDto).toHaveProperty(
      'properties.expectedRevision',
    );
    for (const example of Object.values(
      body.content['application/json'].examples,
    )) {
      const response = await request(app.getHttpServer() as Server)
        .post('/api/v1/organization/roles')
        .send(example.value)
        .expect(201);
      expect(response.body).toMatchObject({ revision: 1 });
      expect(rpc).toHaveBeenLastCalledWith(
        'workflow_mutate',
        expect.objectContaining({
          p_action: 'role.save',
          p_id: null,
          p_data: example.value,
        }),
      );
    }
    expect(rpc).toHaveBeenCalledTimes(
      Object.keys(body.content['application/json'].examples).length,
    );
  });

  it('rejects revision on creation before contacting the database', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/organization/roles')
      .send({ name: 'Engineer', expectedRevision: 0 })
      .expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows a partial role save without treating omitted fields as replacements', async () => {
    await request(app.getHttpServer() as Server)
      .patch('/api/v1/organization/roles/' + roleId)
      .send({ name: 'Renamed role' })
      .expect(200);
    expect(rpc).toHaveBeenCalledWith(
      'workflow_mutate',
      expect.objectContaining({
        p_id: roleId,
        p_data: { name: 'Renamed role' },
      }),
    );
    expect(query.select).not.toHaveBeenCalled();
  });

  it('allows permission replacement without a revision on both update routes', async () => {
    result.data = { id: roleId, revision: 8, permissionIds: [] };
    const url = '/api/v1/organization/roles/' + roleId;
    await request(app.getHttpServer() as Server)
      .patch(url)
      .send({ permissionIds: [] })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .put(url + '/permissions')
      .send({ permissionIds: [] })
      .expect(200);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'workflow_mutate',
      expect.objectContaining({
        p_id: roleId,
        p_data: { permissionIds: [] },
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'workflow_mutate',
      expect.objectContaining({
        p_id: roleId,
        p_data: { permissionIds: [] },
      }),
    );
  });

  it('returns the new revision after a permission save', async () => {
    result.data = { id: roleId, revision: 8, permissionIds: [] };
    const response = await request(app.getHttpServer() as Server)
      .put('/api/v1/organization/roles/' + roleId + '/permissions')
      .send({ expectedRevision: 7, permissionIds: [] })
      .expect(200);
    expect(response.body).toMatchObject({ revision: 8 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'workflow_mutate',
      expect.objectContaining({
        p_id: roleId,
        p_data: { expectedRevision: 7, permissionIds: [] },
      }),
    );
  });

  it.each(['patch', 'put'] as const)(
    'returns scoped conflict details without retrying a stale %s',
    async (method) => {
      result = {
        data: null,
        error: {
          code: 'PT409',
          message: 'Membership or permissions changed; reload before saving',
        },
      };
      const url =
        '/api/v1/organization/roles/' +
        roleId +
        (method === 'put' ? '/permissions' : '');
      const response = await request(app.getHttpServer() as Server)
        [method](url)
        .send({ expectedRevision: 0, permissionIds: [] })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'ROLE_REVISION_CONFLICT',
        details: {
          roleId,
          expectedRevision: 0,
          currentRevision: 7,
          reloadUrl: '/api/v1/organization/roles/' + roleId,
        },
      });
      expect(query.eq).toHaveBeenCalledWith('organization_id', org);
      expect(query.eq).toHaveBeenCalledWith('id', roleId);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves the conflict if the optional revision lookup fails', async () => {
    result = {
      data: null,
      error: {
        code: 'PT409',
        message: 'Membership or permissions changed; reload before saving',
      },
    };
    query.maybeSingle.mockRejectedValueOnce(new Error('offline'));
    const response = await request(app.getHttpServer() as Server)
      .put('/api/v1/organization/roles/' + roleId + '/permissions')
      .send({ expectedRevision: 0, permissionIds: [] })
      .expect(409);
    expect(response.body).toMatchObject({ details: { currentRevision: null } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('never labels a create transaction conflict as a stale role revision', async () => {
    result = {
      data: null,
      error: { code: '40001', message: 'serialization failure' },
    };
    const response = await request(app.getHttpServer() as Server)
      .post('/api/v1/organization/roles')
      .send({ name: 'Engineer' })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'ROLE_CREATION_CONFLICT' });
    expect((response.body as { message: string }).message).not.toContain(
      'revision',
    );
    expect(query.select).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not load revision details for a forbidden write', async () => {
    result = {
      data: null,
      error: { code: '42501', message: 'Permission required' },
    };
    await request(app.getHttpServer() as Server)
      .put('/api/v1/organization/roles/' + roleId + '/permissions')
      .send({ expectedRevision: 0, permissionIds: [] })
      .expect(403);
    expect(query.select).not.toHaveBeenCalled();
  });

  it('surfaces the exact reason activation is blocked', async () => {
    result = {
      data: null,
      error: {
        code: '22023',
        message: 'Complete basic information before activating a department role',
      },
    };
    const response = await request(app.getHttpServer() as Server)
      .patch('/api/v1/organization/roles/' + roleId)
      .send({ status: 'active' })
      .expect(400);
    expect(response.body.message).toBe(
      'Complete basic information before activating a department role',
    );
  });

  it('returns the role audit trail newest first with actor profiles', async () => {
    query.abortSignal.mockResolvedValueOnce({
      data: [
        {
          id: 'history-1',
          organization_id: org,
          role_id: roleId,
          actor_id: 'actor',
          action: 'role.save',
          changes: { name: 'Renamed role' },
          previous_revision: 96,
          new_revision: 97,
          created_at: '2026-09-30T23:24:33.000Z',
        },
      ],
      error: null,
    });
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/organization/roles/' + roleId + '/history')
      .expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      roleId,
      actorId: 'actor',
      action: 'role.save',
      changes: { name: 'Renamed role' },
      previousRevision: 96,
      newRevision: 97,
      createdAt: '2026-09-30T23:24:33.000Z',
    });
    expect(query.eq).toHaveBeenCalledWith('organization_id', org);
    expect(query.eq).toHaveBeenCalledWith('role_id', roleId);
  });

  it('returns the labelled permission catalogue with owner-only and grantable flags', async () => {
    query.abortSignal
      .mockResolvedValueOnce({
        data: [
          { id: 'teams.manage', description: 'Manage teams' },
          { id: 'billing.manage', description: 'Manage workspace billing' },
          {
            id: 'candidates.view_assigned',
            description: 'View candidates for assigned jobs',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ organization_role_id: 'role-1' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ permission_id: 'teams.manage' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/organization/permissions')
      .expect(200);
    const byId = new Map(
      response.body.items.map((item: { id: string }) => [item.id, item]),
    );
    expect(byId.get('teams.manage')).toMatchObject({
      id: 'teams.manage',
      name: 'Manage teams',
      description: 'Manage teams',
      group: 'Teams & Work',
      type: 'manage',
      ownerOnly: false,
      assignable: true,
      grantable: true,
    });
    expect(byId.get('billing.manage')).toMatchObject({
      name: 'Manage billing',
      group: 'Billing',
      ownerOnly: true,
      assignable: false,
      grantable: false,
    });
    expect(byId.get('candidates.view_assigned')).toMatchObject({
      name: 'View assigned candidates',
      group: 'Recruitment',
    });
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CreateProjectDto,
  CreateRoleDto,
  CreateTaskDto,
  UpdateTaskDto,
} from './workflow.dto';
import { WorkflowService } from './workflow.service';
import { SupabaseService } from '../supabase/supabase.service';
import { validateTaskAttachment } from './task-attachments.service';

describe('Workflow request validation', () => {
  it('validates nested wizard sections and rejects unknown privilege fields', async () => {
    const dto = plainToInstance(CreateRoleDto, {
      name: 'Engineer',
      requirements: { minYears: -1 },
      isSystem: true,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['requirements', 'isSystem']),
    );
  });
  it('rejects task status and priority values outside the design contract', async () => {
    const dto = plainToInstance(CreateTaskDto, {
      name: 'Audit',
      priority: 'execute',
      status: 'root',
      startDate: '2026-10-01',
      dueDate: '2026-10-02',
    });
    expect((await validate(dto)).map((e) => e.property)).toEqual(
      expect.arrayContaining(['priority', 'status']),
    );
  });
  it('accepts only a UUID as the selected role icon catalogue ID', async () => {
    const valid = plainToInstance(CreateRoleDto, {
      name: 'Engineer',
      iconId: 'f91c8019-92a8-4714-bf0a-00f3ff5520df',
    });
    expect(await validate(valid)).toEqual([]);
    const invalid = plainToInstance(CreateRoleDto, {
      name: 'Engineer',
      iconId: 'new-generated-icon',
    });
    expect((await validate(invalid)).map((e) => e.property)).toContain(
      'iconId',
    );
  });
  it('rejects impossible dates', async () => {
    const dto = plainToInstance(CreateProjectDto, {
      name: 'API',
      departmentId: '35826d6c-937d-4726-9a25-5bdbb492744a',
      teamId: '35826d6c-937d-4726-9a25-5bdbb492744a',
      resourceManagerId: '35826d6c-937d-4726-9a25-5bdbb492744a',
      priority: 'medium',
      startDate: '2026-02-30',
      endDate: '2026-10-01',
    });
    expect((await validate(dto)).map((e) => e.property)).toContain('startDate');
  });
  it('allows partial updates and clearing an assignee', async () => {
    expect(
      await validate(
        plainToInstance(UpdateTaskDto, { assigneeId: null, status: 'done' }),
      ),
    ).toEqual([]);
  });
});

describe('Role icon persistence', () => {
  const iconId = 'f91c8019-92a8-4714-bf0a-00f3ff5520df';
  const roleId = '152d8fe4-4c96-4e1f-a336-88fa60762587';
  function setup(iconData: object | null) {
    const iconQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: iconData, error: null }),
    };
    const mutation = {
      abortSignal: jest.fn().mockResolvedValue({
        data: {
          id: roleId,
          organization_id: 'organization',
          name: 'Engineer',
          definition: { name: 'Engineer', iconId },
        },
        error: null,
      }),
    };
    const adminClient = {
      from: jest.fn().mockReturnValue(iconQuery),
      rpc: jest.fn().mockReturnValue(mutation),
    };
    return {
      service: new WorkflowService({
        adminClient,
      } as unknown as SupabaseService),
      adminClient,
    };
  }
  it('returns the exact selected catalogue ID on role creation', async () => {
    const { service, adminClient } = setup({ id: iconId });
    const role = await service.mutate(
      'actor',
      'organization',
      'role.save',
      null,
      {
        name: 'Engineer',
        iconId,
      },
    );
    expect(adminClient.from).toHaveBeenCalledWith('department_icons');
    expect(role).toMatchObject({ id: roleId, iconId });
    expect(adminClient.rpc).toHaveBeenCalledWith(
      'workflow_mutate',
      expect.objectContaining({ p_data: { name: 'Engineer', iconId } }),
    );
  });
  it('rejects inactive or unknown catalogue IDs instead of substituting an icon', async () => {
    const { service, adminClient } = setup(null);
    await expect(
      service.mutate('actor', 'organization', 'role.save', null, {
        name: 'Engineer',
        iconId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });
});

describe('Workspace resolution', () => {
  const id = '35826d6c-937d-4726-9a25-5bdbb492744a';
  function setup(data: object[]) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      abortSignal: jest.fn().mockResolvedValue({ data, error: null }),
    };
    const service = new WorkflowService({
      adminClient: { from: jest.fn().mockReturnValue(chain) },
    } as unknown as SupabaseService);
    return { service, chain };
  }
  it('resolves a single membership without a frontend organization ID', async () => {
    const { service, chain } = setup([{ organization_id: id }]);
    expect(await service.organization('actor')).toBe(id);
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'actor');
  });
  it('requires selection when multiple memberships exist', async () => {
    await expect(
      setup([
        { organization_id: id },
        { organization_id: 'other' },
      ]).service.organization('actor'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('does not grant membership merely because a header names an organization', async () => {
    const { service, chain } = setup([]);
    await expect(service.organization('actor', id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(chain.eq).toHaveBeenCalledWith('organization_id', id);
  });
});

describe('Task attachments', () => {
  const file = (name: string, type: string, body: string) => ({
    originalname: name,
    mimetype: type,
    buffer: Buffer.from(body),
    size: Buffer.byteLength(body),
  });
  it('accepts UTF-8 CSV and measures actual bytes', () => {
    expect(
      validateTaskAttachment({
        ...file('report.csv', 'text/csv', 'name,count\nAPI,3'),
        size: 1,
      }).fileSize,
    ).toBe(16);
  });
  it.each([
    ['payload.svg', 'image/svg+xml', '<svg/>'],
    ['report.pdf', 'application/pdf', 'not a pdf'],
    ['active.pdf', 'application/pdf', '%PDF-1.7\n/JavaScript (bad)\n%%EOF'],
    ['fake.csv', 'text/csv', '<html>bad</html>'],
  ])('rejects unsupported or mismatched files (%s)', (name, type, body) => {
    expect(() => validateTaskAttachment(file(name, type, body))).toThrow(
      BadRequestException,
    );
  });
  it('rejects oversize actual content even with a false declared size', () => {
    expect(() =>
      validateTaskAttachment({
        ...file('large.csv', 'text/csv', 'ok'),
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).toThrow(BadRequestException);
  });
});

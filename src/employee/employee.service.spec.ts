import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { EmployeeController } from './employee.controller';
import { EmployeeLeaveRequestDto } from './employee.dto';
import { EmployeeService } from './employee.service';

const actor = '8a53bff5-a952-4ad7-b466-730659020a8e';
const org = '2cd538d0-441c-42f3-816c-92495ad508f5';
const leaveId = 'c1b1a1c4-1111-4222-8333-444455556666';
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

function clientReturning(data: unknown, error: unknown = null) {
  const abortSignal = jest.fn(() => ({ data, error }));
  const rpc = jest.fn(() => ({ abortSignal }));
  const service = new EmployeeService({
    adminClient: { rpc },
  } as unknown as SupabaseService);
  return { service, rpc };
}

describe('EmployeeService self-service contract', () => {
  it('submits a leave request for the signed-in account only', async () => {
    const { service, rpc } = clientReturning({
      id: leaveId,
      leave_type: 'annual',
      starts_on: '2026-11-10',
      ends_on: '2026-11-14',
    });

    const result = await service.requestLeave(actor, org, {
      leaveType: 'annual',
      startsOn: '2026-11-10',
      endsOn: '2026-11-14',
      reason: 'Family wedding',
    });

    expect(rpc).toHaveBeenCalledWith('employee_leave_request', {
      p_actor: actor,
      p_org: org,
      p_data: {
        leave_type: 'annual',
        starts_on: '2026-11-10',
        ends_on: '2026-11-14',
        reason: 'Family wedding',
      },
    });
    expect(result).toMatchObject({
      id: leaveId,
      leaveType: 'annual',
      startsOn: '2026-11-10',
    });
  });

  it('never forwards a caller-supplied employee id', async () => {
    const { service, rpc } = clientReturning({ items: [] });

    await service.profile(actor, org);
    await service.tasks(actor, org);
    await service.team(actor, org);

    const calls = rpc.mock.calls as unknown as [
      string,
      Record<string, unknown>,
    ][];
    expect(calls).toHaveLength(3);
    for (const [, args] of calls) {
      expect(args.p_actor).toBe(actor);
      expect(args.p_org).toBe(org);
      expect(args).not.toHaveProperty('p_employee');
      expect(args).not.toHaveProperty('p_employee_id');
    }
  });

  it('maps database error codes onto HTTP responses', async () => {
    const notFound = clientReturning(null, {
      code: 'P0002',
      message: 'Leave request not found',
    });
    await expect(
      notFound.service.leaveDetail(actor, org, leaveId),
    ).rejects.toBeInstanceOf(NotFoundException);

    const invalid = clientReturning(null, {
      code: '22023',
      message: 'Overlapping leave request',
    });
    await expect(
      invalid.service.requestLeave(actor, org, {
        leaveType: 'annual',
        startsOn: '2026-11-10',
        endsOn: '2026-11-14',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const forbidden = clientReturning(null, {
      code: '42501',
      message: 'Permission required',
    });
    await expect(
      forbidden.service.clock(actor, org, { action: 'in' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancels and clocks through the self-service functions', async () => {
    const { service, rpc } = clientReturning({ id: leaveId });

    await service.cancelLeave(actor, org, leaveId);
    expect(rpc).toHaveBeenLastCalledWith('employee_leave_cancel', {
      p_actor: actor,
      p_org: org,
      p_id: leaveId,
    });

    await service.clock(actor, org, { action: 'in', workMode: 'remote' });
    expect(rpc).toHaveBeenLastCalledWith('employee_clock', {
      p_actor: actor,
      p_org: org,
      p_action: 'in',
      p_work_mode: 'remote',
    });
  });

  it('passes a date range through to attendance and calendar', async () => {
    const { service, rpc } = clientReturning({ items: [] });

    await service.attendance(actor, org, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(rpc).toHaveBeenLastCalledWith('employee_attendance', {
      p_actor: actor,
      p_org: org,
      p_from: '2026-10-01',
      p_to: '2026-10-31',
    });

    await service.calendar(actor, org, {});
    expect(rpc).toHaveBeenLastCalledWith('employee_calendar', {
      p_actor: actor,
      p_org: org,
      p_from: null,
      p_to: null,
    });
  });
});

describe('Employee leave request validation', () => {
  const translate = (value: Record<string, unknown>) =>
    pipe.transform(value, {
      type: 'body',
      metatype: EmployeeLeaveRequestDto as never,
    });

  it('accepts the designed leave types', async () => {
    for (const leaveType of ['annual', 'personal', 'maternity', 'unpaid']) {
      await expect(
        translate({
          leaveType,
          startsOn: '2026-11-10',
          endsOn: '2026-11-14',
        }),
      ).resolves.toMatchObject({ leaveType });
    }
  });

  it('rejects unknown leave types and non-ISO dates', async () => {
    await expect(
      translate({
        leaveType: 'sabbatical',
        startsOn: '2026-11-10',
        endsOn: '2026-11-14',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      translate({
        leaveType: 'annual',
        startsOn: '10/11/2026',
        endsOn: '2026-11-14',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Employee self-service OpenAPI contract', () => {
  it('publishes the self-service routes', async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [{ provide: EmployeeService, useValue: {} }],
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
      expect(doc.paths['/employee/profile'].get).toBeDefined();
      expect(doc.paths['/employee/dashboard'].get).toBeDefined();
      expect(doc.paths['/employee/leave'].get).toBeDefined();
      expect(doc.paths['/employee/leave'].post?.responses['201']).toBeDefined();
      expect(doc.paths['/employee/leave/{id}'].get).toBeDefined();
      expect(doc.paths['/employee/leave/{id}/cancel'].post).toBeDefined();
      expect(doc.paths['/employee/attendance'].get).toBeDefined();
      expect(doc.paths['/employee/attendance/clock'].post).toBeDefined();
      expect(doc.paths['/employee/tasks/{id}'].patch).toBeDefined();
      expect(doc.paths['/employee/learning/{courseId}'].patch).toBeDefined();
      expect(doc.paths['/employee/calendar'].get).toBeDefined();
      expect(doc.components?.schemas?.EmployeeLeaveDto).toBeDefined();
      expect(doc.components?.schemas?.EmployeeDashboardDto).toBeDefined();
      expect(doc.components?.schemas?.EmployeeLeaveBalanceDto).toMatchObject({
        properties: { remaining: { type: 'number', example: 14.5 } },
      });
    } finally {
      await app.close();
    }
  });
});

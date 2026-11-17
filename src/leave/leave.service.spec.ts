import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { LeavePolicyDto, LeaveSettingsDto } from './leave.dto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LeaveService } from './leave.service';

const actor = '8a53bff5-a952-4ad7-b466-730659020a8e';
const org = '2cd538d0-441c-42f3-816c-92495ad508f5';
const policyId = 'c1b1a1c4-1111-4222-8333-444455556666';

function clientReturning(data: unknown, error: unknown = null) {
  const abortSignal = jest.fn(() => ({ data, error }));
  const rpc = jest.fn(() => ({ abortSignal }));
  const service = new LeaveService({
    adminClient: { rpc },
  } as unknown as SupabaseService);
  return { service, rpc };
}

describe('LeaveService policy contract', () => {
  it('creates a policy with snake-cased data', async () => {
    const { service, rpc } = clientReturning({
      id: policyId,
      name: 'Annual Leave',
      leave_type: 'annual',
      days_per_year: 20,
    });

    const result = await service.savePolicy(actor, org, null, {
      name: 'Annual Leave',
      leaveType: 'annual',
      daysPerYear: 20,
    });

    expect(rpc).toHaveBeenCalledWith('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'policy.save',
      p_id: null,
      p_data: { name: 'Annual Leave', leave_type: 'annual', days_per_year: 20 },
    });
    expect(result).toMatchObject({ id: policyId, leaveType: 'annual' });
  });

  it('deletes a policy through leave_mutate', async () => {
    const { service, rpc } = clientReturning({ id: policyId });
    await service.deletePolicy(actor, org, policyId);
    expect(rpc).toHaveBeenCalledWith('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'policy.delete',
      p_id: policyId,
      p_data: {},
    });
  });

  it('saves settings through the partial-update settings RPC', async () => {
    const { service, rpc } = clientReturning({
      leave_year_start_month: 1,
      carry_forward_enabled: true,
    });
    await service.saveSettings(actor, org, {
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
      leaveYearEndMonth: 12,
      leaveYearEndDay: 31,
      carryForwardEnabled: true,
    });
    expect(rpc).toHaveBeenCalledWith('leave_settings_save', {
      p_actor: actor,
      p_org: org,
      p_data: {
        leave_year_start_month: 1,
        leave_year_start_day: 1,
        leave_year_end_month: 12,
        leave_year_end_day: 31,
        carry_forward_enabled: true,
      },
    });
  });

  it('loads reports through leave_reports', async () => {
    const { service, rpc } = clientReturning({
      summary: { days_used: 0, requests: 0 },
    });
    const result = await service.reports(actor, org);
    expect(rpc).toHaveBeenCalledWith('leave_reports', {
      p_actor: actor,
      p_org: org,
    });
    expect(result).toMatchObject({ summary: { daysUsed: 0, requests: 0 } });
  });
});

describe('Leave policy validation', () => {
  it('accepts a designed policy payload', async () => {
    const dto = {
      name: 'Annual Leave',
      leaveType: 'annual',
      allowanceType: 'fixed',
      daysPerYear: 20,
      accrualMethod: 'scheduled',
      accrualFrequency: 'monthly',
      maxCarryover: 5,
      eligibilityMatch: 'all',
      departmentIds: ['2cd538d0-441c-42f3-816c-92495ad508f5'],
      employmentTypes: ['full_time'],
      blackoutPeriods: [
        { name: 'Year End', startsOn: '2026-12-20', endsOn: '2026-12-31' },
      ],
      approvalWorkflow: 'custom',
      approvalChain: [
        {
          level: 1,
          approverRole: 'Direct Manager',
          action: 'approval_required',
        },
      ],
    };
    const instance = plainToInstance(LeavePolicyDto, dto);
    expect(await validate(instance)).toHaveLength(0);
  });

  it('rejects an unknown leave type', async () => {
    const instance = plainToInstance(LeavePolicyDto, {
      name: 'Bad',
      leaveType: 'sabbatical',
    });
    const errors = await validate(instance);
    expect(errors.map((e) => e.property)).toContain('leaveType');
  });
});

describe('Leave setup and policy lookup', () => {
  it('loads a policy by ID without scanning the policy list', async () => {
    const { service, rpc } = clientReturning({
      id: policyId,
      leave_type: 'annual',
      days_per_year: 0,
      allow_negative_balance: false,
    });
    await expect(service.policy(actor, org, policyId)).resolves.toMatchObject({
      id: policyId,
      leaveType: 'annual',
      daysPerYear: 0,
      allowNegativeBalance: false,
    });
    expect(rpc).toHaveBeenCalledWith('leave_policy_detail', {
      p_actor: actor,
      p_org: org,
      p_policy: policyId,
    });
  });
  it('loads permission-checked settings and preserves unsaved defaults', async () => {
    const { service, rpc } = clientReturning({
      organization_id: org,
      isConfigured: false,
      manager_notifications: false,
      carry_forward_start_month: null,
    });
    await expect(service.settings(actor, org)).resolves.toMatchObject({
      organizationId: org,
      isConfigured: false,
      managerNotifications: false,
      carryForwardStartMonth: null,
    });
    expect(rpc).toHaveBeenCalledWith('leave_settings_get', {
      p_actor: actor,
      p_org: org,
    });
  });
  it('maps missing and forbidden policy reads', async () => {
    await expect(
      clientReturning(null, {
        code: 'P0002',
        message: 'Not found',
      }).service.policy(actor, org, policyId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      clientReturning(null, {
        code: '42501',
        message: 'Permission required',
      }).service.policy(actor, org, policyId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('accepts partial saves, real false toggles and carry-forward date fields', async () => {
    const instance = plainToInstance(LeaveSettingsDto, {
      managerNotifications: false,
      carryForwardStartMonth: 12,
      carryForwardStartDay: 1,
      carryForwardEndMonth: 3,
      carryForwardEndDay: 31,
    });
    expect(await validate(instance)).toHaveLength(0);
    const { service, rpc } = clientReturning({});
    await service.saveSettings(actor, org, instance);
    expect(rpc).toHaveBeenCalledWith('leave_settings_save', {
      p_actor: actor,
      p_org: org,
      p_data: {
        manager_notifications: false,
        carry_forward_start_month: 12,
        carry_forward_start_day: 1,
        carry_forward_end_month: 3,
        carry_forward_end_day: 31,
      },
    });
    expect(
      await validate(
        plainToInstance(LeaveSettingsDto, { carryForwardStartMonth: 13 }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(LeaveSettingsDto, { managerNotifications: 'false' }),
      ),
    ).not.toHaveLength(0);
  });
});

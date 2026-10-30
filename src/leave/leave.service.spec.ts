import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { LeavePolicyDto } from './leave.dto';
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

  it('saves settings through leave_mutate', async () => {
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
    expect(rpc).toHaveBeenCalledWith('leave_mutate', {
      p_actor: actor,
      p_org: org,
      p_action: 'settings.save',
      p_id: null,
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

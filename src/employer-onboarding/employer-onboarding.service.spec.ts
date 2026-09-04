import { ConflictException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

import { EmployerOnboardingService } from './employer-onboarding.service';

describe('EmployerOnboardingService', () => {
  const setup = (status: string, step: number) => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const row = {
      status,
      current_step: step,
      started_at: status === 'not_started' ? null : '2026-09-04T12:00:00Z',
      completed_steps: [],
      department_drafts: [],
      logo_path: null,
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: row, error: null }),
    };
    return {
      rpc,
      service: new EmployerOnboardingService({
        adminClient: { rpc, from: jest.fn().mockReturnValue(query) },
      } as unknown as SupabaseService),
    };
  };

  it('reports Welcome as step zero for a new employer', async () => {
    const { service } = setup('not_started', 1);
    expect(await service.getState('user')).toMatchObject({
      currentStep: 0,
      startedAt: null,
      nextAction: 'welcome',
      progressPercentage: 0,
      totalSteps: 4,
    });
  });

  it.each([
    ['in_progress', 1],
    ['in_progress', 3],
    ['completed', 4],
  ])(
    'returns persisted progress after start: %s step %s',
    async (status, step) => {
      const { service, rpc } = setup(status, step);
      expect(await service.start('user')).toMatchObject({
        currentStep: step,
        startedAt: '2026-09-04T12:00:00Z',
      });
      expect(rpc).toHaveBeenCalledWith('start_employer_onboarding', {
        p_user_id: 'user',
      });
    },
  );

  it('rejects normalized duplicate department names before persistence', async () => {
    const service = new EmployerOnboardingService({} as SupabaseService);

    await expect(
      service.saveDepartments('user-id', {
        expectedRevision: 0,
        departments: [
          { clientId: 'one', name: 'Engineering' },
          { clientId: 'two', name: ' engineering ' },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

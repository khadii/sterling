import { ConflictException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

jest.mock('sanitize-html', () => (value: string) => value);

import { EmployerOnboardingService } from './employer-onboarding.service';

describe('EmployerOnboardingService', () => {
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

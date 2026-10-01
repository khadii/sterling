import { HttpStatus } from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { mapOnboardingDatabaseError } from './onboarding-error';

describe('mapOnboardingDatabaseError', () => {
  it.each(['PT409', '40001'])(
    'maps stale writes (%s) to a coded conflict',
    (code) => {
      const exception = mapOnboardingDatabaseError({
        code,
        message: 'Stale revision',
        details: '',
        hint: '',
        name: 'PostgrestError',
      } as PostgrestError);

      expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(exception.getResponse()).toMatchObject({
        code: 'STALE_DRAFT_VERSION',
      });
    },
  );

  it('maps incomplete steps to 422', () => {
    const exception = mapOnboardingDatabaseError({
      code: 'P0001',
      message: 'Country is required',
      details: '',
      hint: '',
      name: 'PostgrestError',
    } as PostgrestError);

    expect(exception.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(exception.getResponse()).toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
    });
  });
});

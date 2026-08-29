import { HttpException, HttpStatus } from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { mapDatabaseError } from '../supabase/database-error.mapper';

export function onboardingError(
  message: string,
  status: HttpStatus,
  code: string,
  details?: Record<string, unknown>,
) {
  return new HttpException({ message, code, details }, status);
}

export function mapOnboardingDatabaseError(error: PostgrestError) {
  if (error.code === '40001') {
    return onboardingError(
      'This draft was updated elsewhere; reload it before saving again',
      HttpStatus.CONFLICT,
      'STALE_DRAFT_VERSION',
    );
  }
  if (error.code === 'P0001') {
    return onboardingError(
      error.message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'ONBOARDING_INCOMPLETE',
    );
  }
  if (error.code === 'P0003') {
    return onboardingError(
      'Completed onboarding cannot be edited',
      HttpStatus.CONFLICT,
      'ONBOARDING_ALREADY_COMPLETED',
    );
  }
  if (error.code === 'P0004') {
    return onboardingError(
      error.message,
      HttpStatus.CONFLICT,
      'INVALID_STEP_ORDER',
    );
  }
  return mapDatabaseError(error, 'update employer onboarding');
}

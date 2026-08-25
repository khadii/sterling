import { HttpStatus } from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { mapDatabaseError } from './database-error.mapper';

function error(code: string): PostgrestError {
  return new PostgrestError({
    code,
    message: 'sensitive detail',
    details: '',
    hint: '',
  });
}

describe('mapDatabaseError', () => {
  it.each([
    ['23505', HttpStatus.CONFLICT],
    ['23503', HttpStatus.BAD_REQUEST],
    ['42501', HttpStatus.FORBIDDEN],
    ['08006', HttpStatus.SERVICE_UNAVAILABLE],
    ['PGRST002', HttpStatus.SERVICE_UNAVAILABLE],
    ['XX000', HttpStatus.INTERNAL_SERVER_ERROR],
  ])('maps database code %s', (code, expectedStatus) => {
    expect(mapDatabaseError(error(code), 'perform operation').getStatus()).toBe(
      expectedStatus,
    );
  });
});

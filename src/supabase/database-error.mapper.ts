import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';

export function mapDatabaseError(error: PostgrestError, action: string) {
  if (error.code === 'PT409' || error.code === '40001')
    return new ConflictException(
      'The resource changed. Reload it and retry with its current revision.',
    );
  if (error.code === '23505')
    return new ConflictException(`${action} already exists`);
  if (error.code === '23503' || error.code === '22023') {
    return new BadRequestException(
      `Invalid data supplied for ${action.toLowerCase()}`,
    );
  }
  if (error.code === '42501')
    return new ForbiddenException('Database operation is not permitted');
  if (
    error.code === '57014' ||
    /abort|timed?\s*out|timeout/i.test(error.message) ||
    error.code.startsWith('08') ||
    error.code.startsWith('53') ||
    error.code === '57P01' ||
    error.code.startsWith('PGRST0')
  ) {
    const reason = error.message ? ` (${error.message})` : '';
    return new ServiceUnavailableException(
      `Database is temporarily unavailable${reason}`,
    );
  }
  return new InternalServerErrorException(`Unable to ${action.toLowerCase()}`);
}

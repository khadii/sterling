import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';

export function mapDatabaseError(error: PostgrestError, action: string) {
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
    error.code.startsWith('08') ||
    error.code.startsWith('53') ||
    error.code === '57P01' ||
    error.code.startsWith('PGRST0')
  ) {
    return new ServiceUnavailableException(
      'Database is temporarily unavailable',
    );
  }
  return new InternalServerErrorException(`Unable to ${action.toLowerCase()}`);
}

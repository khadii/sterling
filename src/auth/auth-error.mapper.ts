import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthError } from '@supabase/supabase-js';

export type AuthOperation =
  | 'sign_up'
  | 'sign_in'
  | 'refresh'
  | 'password_reset'
  | 'resend_confirmation'
  | 'update_password'
  | 'update_email'
  | 'sign_out'
  | 'verify_token';

const conflictCodes = new Set([
  'email_exists',
  'user_already_exists',
  'identity_already_exists',
]);
const invalidSessionCodes = new Set([
  'bad_jwt',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
]);
const invalidRequestCodes = new Set([
  'validation_failed',
  'weak_password',
  'email_address_invalid',
  'password_too_short',
  'captcha_failed',
]);
const rateLimitCodes = new Set(['over_request_rate_limit']);
const providerUnavailableCodes = new Set([
  'provider_disabled',
  'unexpected_failure',
  'hook_timeout',
  'hook_timeout_after_retry',
]);

export function mapAuthError(
  error: AuthError,
  operation: AuthOperation,
): HttpException {
  const code = error.code ?? '';

  if (code === 'over_email_send_rate_limit') {
    return new HttpException(
      'Authentication email limit reached; wait before retrying or configure custom SMTP in Supabase',
      429,
    );
  }
  if (code === 'over_sms_send_rate_limit') {
    return new HttpException(
      'Authentication SMS limit reached; wait before retrying',
      429,
    );
  }
  if (
    rateLimitCodes.has(code) ||
    code.includes('rate_limit') ||
    error.status === 429
  ) {
    return new HttpException(
      'Too many authentication requests; wait before retrying',
      429,
    );
  }
  if (
    providerUnavailableCodes.has(code) ||
    (error.status && error.status >= 500)
  ) {
    return new ServiceUnavailableException(
      'Authentication provider is temporarily unavailable',
    );
  }
  if (operation === 'sign_up' && conflictCodes.has(code)) {
    return new ConflictException('An account with this email already exists');
  }
  if (operation === 'sign_in') {
    if (
      code === 'invalid_credentials' ||
      code === 'user_not_found' ||
      error.status === 401 ||
      error.status === 404
    ) {
      return new UnauthorizedException('Invalid email or password');
    }
    if (code === 'email_not_confirmed') {
      return new ForbiddenException('Email address has not been confirmed');
    }
  }
  if (
    operation === 'refresh' ||
    operation === 'update_password' ||
    operation === 'update_email' ||
    operation === 'sign_out' ||
    operation === 'verify_token'
  ) {
    if (
      invalidSessionCodes.has(code) ||
      error.status === 401 ||
      error.status === 404
    ) {
      return new UnauthorizedException('Invalid or expired session');
    }
  }
  if (operation === 'update_email' && conflictCodes.has(code)) {
    return new ConflictException('That email address is already in use');
  }
  if (
    invalidRequestCodes.has(code) ||
    error.status === 400 ||
    error.status === 422
  ) {
    return new BadRequestException(publicValidationMessage(code, operation));
  }
  if (error.status === 403) {
    return new ForbiddenException('This authentication action is not allowed');
  }
  if (error.status === 404) {
    return new BadGatewayException(
      'Supabase authentication endpoint was not found; verify the project configuration',
    );
  }
  return new BadGatewayException('Authentication provider request failed');
}

export function isMissingAccountError(error: AuthError): boolean {
  return error.code === 'user_not_found';
}

function publicValidationMessage(
  code: string,
  operation: AuthOperation,
): string {
  if (code === 'weak_password' || code === 'password_too_short') {
    return 'Password does not meet the security requirements';
  }
  if (code === 'email_address_invalid') return 'Email address is invalid';
  if (code === 'captcha_failed') return 'Captcha verification failed';
  if (operation === 'sign_up')
    return 'Unable to create account with the supplied details';
  return 'Invalid authentication request';
}

import { HttpStatus } from '@nestjs/common';
import { AuthError } from '@supabase/supabase-js';
import { AuthOperation, mapAuthError } from './auth-error.mapper';

describe('mapAuthError', () => {
  it.each<[string, number, AuthOperation, number]>([
    ['email_exists', 400, 'sign_up', HttpStatus.CONFLICT],
    ['invalid_credentials', 400, 'sign_in', HttpStatus.UNAUTHORIZED],
    ['email_not_confirmed', 400, 'sign_in', HttpStatus.FORBIDDEN],
    ['user_not_found', 404, 'sign_in', HttpStatus.UNAUTHORIZED],
    ['bad_jwt', 401, 'verify_token', HttpStatus.UNAUTHORIZED],
    ['over_request_rate_limit', 429, 'sign_up', HttpStatus.TOO_MANY_REQUESTS],
    ['unexpected_failure', 503, 'sign_up', HttpStatus.SERVICE_UNAVAILABLE],
  ])(
    'maps %s during %s safely',
    (code, providerStatus, operation, expectedStatus) => {
      const mapped = mapAuthError(
        new AuthError('Provider detail', providerStatus, code),
        operation,
      );
      expect(mapped.getStatus()).toBe(expectedStatus);
    },
  );

  it('never reports account-not-found during signup', () => {
    const mapped = mapAuthError(
      new AuthError('Provider detail', 404, 'user_not_found'),
      'sign_up',
    );
    expect(mapped.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(mapped.message).not.toMatch(/account not found/i);
  });

  it('does not expose provider details for invalid credentials', () => {
    const mapped = mapAuthError(
      new AuthError('Sensitive provider detail', 400, 'invalid_credentials'),
      'sign_in',
    );
    expect(mapped.message).toBe('Invalid email or password');
  });

  it('distinguishes a Supabase email quota from request throttling', () => {
    const mapped = mapAuthError(
      new AuthError('Provider detail', 429, 'over_email_send_rate_limit'),
      'sign_up',
    );

    expect(mapped.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(mapped.message).toMatch(/email limit/i);
    expect(mapped.message).toMatch(/custom SMTP/i);
  });
});

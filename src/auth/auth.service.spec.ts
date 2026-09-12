import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthError } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';

describe('AuthService confirmEmailOtp', () => {
  const dto = { email: 'person@example.com', token: '123456' };

  function setup(result: unknown) {
    const verifyOtp = jest.fn().mockResolvedValue(result);
    const service = new AuthService(
      {
        publicClient: { auth: { verifyOtp } },
      } as unknown as SupabaseService,
      {} as ConfigService,
    );
    return { service, verifyOtp };
  }

  it('returns the session supplied by Supabase after confirmation', async () => {
    const data = {
      user: { id: 'user-id', email: dto.email },
      session: { access_token: 'access-token', refresh_token: 'refresh-token' },
    };
    const { service, verifyOtp } = setup({ data, error: null });

    await expect(service.confirmEmailOtp(dto)).resolves.toEqual(data);
    expect(verifyOtp).toHaveBeenCalledWith({
      email: dto.email,
      token: dto.token,
      type: 'email',
    });
  });

  it('returns a safe bad-request error for an invalid or expired code', async () => {
    const { service } = setup({
      data: { user: null, session: null },
      error: new AuthError(
        'Provider detail must not reach the client',
        400,
        'otp_expired',
      ),
    });

    await expect(service.confirmEmailOtp(dto)).rejects.toEqual(
      expect.objectContaining({
        message: 'Invalid or expired confirmation code',
      }),
    );
    await expect(service.confirmEmailOtp(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

import { validate } from 'class-validator';
import { ConfirmEmailOtpDto } from './confirm-email-otp.dto';

describe('ConfirmEmailOtpDto', () => {
  it('accepts an email and a six-digit OTP', async () => {
    const dto = Object.assign(new ConfirmEmailOtpDto(), {
      email: 'person@example.com',
      token: '123456',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a malformed email or OTP', async () => {
    const dto = Object.assign(new ConfirmEmailOtpDto(), {
      email: 'not-an-email',
      token: '12345a',
    });

    expect(await validate(dto)).toHaveLength(2);
  });
});

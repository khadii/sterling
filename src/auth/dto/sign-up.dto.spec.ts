import { validate } from 'class-validator';
import { UserRole } from '../../common/enums/user-role.enum';
import { SignUpDto } from './sign-up.dto';

describe('SignUpDto', () => {
  it('accepts a valid self-service registration', async () => {
    const dto = Object.assign(new SignUpDto(), {
      email: 'person@example.com',
      password: 'strong-password',
      role: UserRole.JOB_SEEKER,
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unknown roles and weak passwords', async () => {
    const dto = Object.assign(new SignUpDto(), {
      email: 'person@example.com',
      password: 'short',
      role: 'admin',
    });
    expect(await validate(dto)).toHaveLength(2);
  });
});

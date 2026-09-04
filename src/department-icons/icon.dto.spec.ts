import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignUpDto } from '../auth/dto/sign-up.dto';
import { CompleteOnboardingDto } from '../auth/dto/complete-onboarding.dto';
import { IconUploadDto } from './icon.dto';
import { CompanyDraftDto } from '../employer-onboarding/dto/company-draft.dto';

describe('Icon and public onboarding validation', () => {
  it.each(['admin', 'superadmin'])(
    'does not expose %s through public role DTOs',
    async (role) => {
      expect(
        (
          await validate(
            plainToInstance(SignUpDto, {
              email: 'a@example.com',
              password: 'long-password',
              role,
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
      expect(
        (await validate(plainToInstance(CompleteOnboardingDto, { role })))
          .length,
      ).toBeGreaterThan(0);
    },
  );
  it('rejects oversized icon upload declarations', async () => {
    expect(
      (
        await validate(
          plainToInstance(IconUploadDto, {
            name: 'Logo',
            contentType: 'image/png',
            fileSize: 1048577,
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('uses nonoverlapping company-size buckets', async () => {
    expect(
      await validate(
        plainToInstance(CompanyDraftDto, {
          expectedRevision: 0,
          size: '101_plus',
        }),
      ),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(CompanyDraftDto, {
            expectedRevision: 0,
            size: '100_plus',
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

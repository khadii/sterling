import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyDraftDto } from './company-draft.dto';
import { SaveDepartmentsDto } from './departments.dto';
import { CreateLogoUploadDto } from './logo.dto';
import { WorkspaceSettingsDto } from './workspace-settings.dto';

describe('employer onboarding DTOs', () => {
  it('accepts clearing an optional company website', async () => {
    const dto = plainToInstance(CompanyDraftDto, {
      expectedRevision: 0,
      website: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects non-HTTP company URLs', async () => {
    const dto = plainToInstance(CompanyDraftDto, {
      expectedRevision: 0,
      website: 'ftp://example.com/logo',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('requires at least one department and a draft revision', async () => {
    const dto = plainToInstance(SaveDepartmentsDto, {
      expectedRevision: 0,
      departments: [],
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('validates ISO countries, IANA timezones, and BCP 47 locales', async () => {
    const valid = plainToInstance(WorkspaceSettingsDto, {
      expectedRevision: 0,
      countryCode: 'NG',
      timezone: 'Africa/Lagos',
      locale: 'en-NG',
    });
    const invalid = plainToInstance(WorkspaceSettingsDto, {
      expectedRevision: 0,
      countryCode: 'ZZ',
      timezone: 'Lagos',
      locale: 'not_a_locale',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('enforces the five-megabyte declared logo limit', async () => {
    const dto = plainToInstance(CreateLogoUploadDto, {
      fileName: 'logo.png',
      contentType: 'image/png',
      fileSize: 5_242_881,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

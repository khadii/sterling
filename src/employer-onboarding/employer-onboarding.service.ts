import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateImage } from '../common/images/validate-image';
import * as countries from 'i18n-iso-countries';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import { CompanyDraftDto } from './dto/company-draft.dto';
import { SaveDepartmentsDto } from './dto/departments.dto';
import { ConfirmLogoUploadDto, CreateLogoUploadDto } from './dto/logo.dto';
import { WorkspaceSettingsDto } from './dto/workspace-settings.dto';
import { LogoContentType } from './onboarding.enums';
import { mapOnboardingDatabaseError } from './onboarding-error';

const LOGO_BUCKET = 'onboarding-logos';
const LOGO_MAX_SIZE = 5_242_880;

interface OnboardingRow {
  user_id: string;
  status: 'not_started' | 'in_progress' | 'provisioning' | 'completed';
  current_step: number;
  started_at: string | null;
  completed_steps: number[];
  company_name: string | null;
  industry_id: string | null;
  company_website: string | null;
  company_size: string | null;
  logo_path: string | null;
  logo_uploaded_at: string | null;
  company_revision: number;
  department_drafts: DepartmentDraft[];
  departments_revision: number;
  country_code: string | null;
  timezone: string | null;
  locale: string | null;
  week_starts_on: string | null;
  date_format: string | null;
  settings_revision: number;
  organization_id: string | null;
  completed_at: string | null;
  updated_at: string;
  industries?: { name: string } | { name: string }[] | null;
}

export interface DepartmentDraft {
  iconId?: string;
  clientId: string;
  name: string;
  description?: string | null;
}

interface LogoUploadRow {
  id: string;
  user_id: string;
  storage_path: string;
  declared_content_type: LogoContentType;
  declared_size: number;
  expires_at: string;
  confirmed_at: string | null;
}

@Injectable()
export class EmployerOnboardingService {
  constructor(private readonly supabase: SupabaseService) {}

  async getState(userId: string) {
    return this.serializeState(await this.getRow(userId));
  }

  async start(userId: string) {
    const { error } = await this.supabase.adminClient.rpc(
      'start_employer_onboarding',
      { p_user_id: userId } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    return this.getState(userId);
  }

  async saveCompany(userId: string, dto: CompanyDraftDto) {
    const { expectedRevision, ...patch } = dto;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('At least one company field is required');
    }
    const { data, error } = await this.supabase.adminClient.rpc(
      'save_company_onboarding_draft',
      {
        p_user_id: userId,
        p_expected_revision: expectedRevision,
        p_patch: patch,
      } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    void data;
    return this.companyResponse(await this.getRow(userId));
  }

  async completeStep(userId: string, step: 1 | 2 | 3) {
    const { data, error } = await this.supabase.adminClient.rpc(
      'complete_employer_onboarding_step',
      { p_user_id: userId, p_step: step } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    const row = data as unknown as OnboardingRow;
    return {
      completedStep: step,
      currentStep: row.current_step,
      totalSteps: 4,
      progressPercentage: Math.min(row.completed_steps.length * 25, 75),
      nextAction: this.nextAction(row),
      completedAt: new Date().toISOString(),
    };
  }

  async saveDepartments(userId: string, dto: SaveDepartmentsDto) {
    const normalized = dto.departments.map((department) => ({
      ...department,
      name: department.name.trim().replace(/\s+/g, ' '),
      description: department.description?.trim() || null,
    }));
    const names = normalized.map((item) => item.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) {
      throw new ConflictException(
        'Department names must be unique within the workspace',
      );
    }
    const { data, error } = await this.supabase.adminClient.rpc(
      'save_department_onboarding_draft',
      {
        p_user_id: userId,
        p_expected_revision: dto.expectedRevision,
        p_departments: normalized,
      } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    return this.departmentResponse(data);
  }

  async saveWorkspaceSettings(userId: string, dto: WorkspaceSettingsDto) {
    const { expectedRevision, ...patch } = dto;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('At least one workspace field is required');
    }
    const normalized = {
      ...patch,
      countryCode: patch.countryCode?.toUpperCase(),
      locale: patch.locale
        ? Intl.getCanonicalLocales(patch.locale)[0]
        : undefined,
    };
    const { data, error } = await this.supabase.adminClient.rpc(
      'save_workspace_settings_draft',
      {
        p_user_id: userId,
        p_expected_revision: expectedRevision,
        p_patch: normalized,
      } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    return this.workspaceResponse(data);
  }

  async createLogoUpload(userId: string, dto: CreateLogoUploadDto) {
    const row = await this.getRow(userId);
    if (row.status === 'completed')
      throw new ConflictException('Completed onboarding cannot be edited');
    const uploadId = randomUUID();
    const extension = this.extensionFor(dto.contentType);
    const storagePath = `${userId}/${uploadId}/logo.${extension}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const { data, error } = await this.supabase.adminClient.storage
      .from(LOGO_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      throw new ServiceUnavailableException(
        'Logo storage is temporarily unavailable',
      );
    }
    const { error: insertError } = await this.supabase.adminClient
      .from('onboarding_logo_uploads')
      .insert({
        id: uploadId,
        user_id: userId,
        storage_path: storagePath,
        original_file_name: dto.fileName,
        declared_content_type: dto.contentType,
        declared_size: dto.fileSize,
        expires_at: expiresAt.toISOString(),
      } as never);
    if (insertError) {
      throw mapDatabaseError(insertError, 'create logo upload');
    }
    return {
      uploadId,
      uploadUrl: data.signedUrl,
      token: data.token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmLogo(userId: string, dto: ConfirmLogoUploadDto) {
    const upload = await this.getLogoUpload(userId, dto.uploadId);
    if (upload.confirmed_at) {
      return this.companyResponse(await this.getRow(userId));
    }
    if (new Date(upload.expires_at).getTime() <= Date.now()) {
      throw new ConflictException('Logo upload has expired');
    }
    const { data: blob, error } = await this.supabase.adminClient.storage
      .from(LOGO_BUCKET)
      .download(upload.storage_path);
    if (error || !blob) throw new NotFoundException('Uploaded logo not found');
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.length < 1 || buffer.length > LOGO_MAX_SIZE) {
      await this.discardLogo(upload.storage_path);
      throw new BadRequestException('Uploaded logo size is invalid');
    }
    if (buffer.length !== upload.declared_size) {
      await this.discardLogo(upload.storage_path);
      throw new BadRequestException(
        'Uploaded logo size does not match the upload request',
      );
    }
    if (!this.matchesContentType(buffer, upload.declared_content_type)) {
      await this.discardLogo(upload.storage_path);
      throw new BadRequestException(
        'Uploaded file content does not match its declared image type',
      );
    }
    const safeBody = await validateImage(buffer, upload.declared_content_type);
    const finalPath = `${upload.storage_path}.verified.png`;
    const { error: replaceError } = await this.supabase.adminClient.storage
      .from(LOGO_BUCKET)
      .upload(finalPath, safeBody, {
        contentType: 'image/png',
        upsert: true,
      });
    if (replaceError) {
      throw new ServiceUnavailableException('Unable to finalize logo upload');
    }
    const current = await this.getRow(userId);
    const { data: updated, error: updateError } =
      await this.supabase.adminClient
        .from('employer_onboarding')
        .update({
          logo_path: finalPath,
          logo_content_type: 'image/png',
          logo_uploaded_at: new Date().toISOString(),
          company_revision: current.company_revision + 1,
        } as never)
        .eq('user_id', userId)
        .eq('company_revision', current.company_revision)
        .neq('status', 'completed')
        .select('user_id')
        .maybeSingle();
    if (updateError) throw mapDatabaseError(updateError, 'confirm logo upload');
    if (!updated) {
      throw new ConflictException(
        'Company draft changed while the logo was being confirmed',
      );
    }
    const { error: confirmError } = await this.supabase.adminClient
      .from('onboarding_logo_uploads')
      .update({ confirmed_at: new Date().toISOString() } as never)
      .eq('id', upload.id);
    if (confirmError)
      throw mapDatabaseError(confirmError, 'confirm logo upload');
    if (current.logo_path && current.logo_path !== finalPath) {
      await this.discardLogo(current.logo_path);
    }
    return this.companyResponse(await this.getRow(userId));
  }

  async removeLogo(userId: string): Promise<void> {
    const row = await this.getRow(userId);
    if (row.status === 'completed')
      throw new ConflictException('Completed onboarding cannot be edited');
    if (!row.logo_path) return;
    const { data: removed, error } = await this.supabase.adminClient
      .from('employer_onboarding')
      .update({
        logo_path: null,
        logo_content_type: null,
        logo_uploaded_at: null,
        company_revision: row.company_revision + 1,
      } as never)
      .eq('user_id', userId)
      .eq('company_revision', row.company_revision)
      .neq('status', 'completed')
      .select('user_id')
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'remove company logo');
    if (!removed)
      throw new ConflictException(
        'Company draft changed; reload before removing the logo',
      );
    await this.discardLogo(row.logo_path);
  }

  async getReview(userId: string, email?: string) {
    const row = await this.getRow(userId);
    const missing = this.missingRequirements(row);
    return {
      readyToComplete: missing.length === 0,
      completedSteps: row.completed_steps,
      company: (await this.companyResponse(row)).company,
      departments: row.department_drafts,
      workspaceSettings: this.workspaceResponse(row).settings,
      provisioningPlan: {
        organisationWillBeCreated: true,
        departmentCount: row.department_drafts.length,
        defaultPipelineWillBeCreated: true,
        creatorRole: 'organisation_owner',
        ownerEmail: email,
      },
      missingRequirements: missing,
    };
  }

  async complete(userId: string) {
    const { data, error } = await this.supabase.adminClient.rpc(
      'provision_employer_workspace',
      { p_user_id: userId } as never,
    );
    if (error) throw mapOnboardingDatabaseError(error);
    const organizationId = data as unknown as string;
    const summary = await this.getSummary(userId);
    return {
      status: 'completed',
      progressPercentage: 100,
      organization: summary.organization,
      summary: {
        companyCreated: true,
        departmentsAdded: summary.departments.length,
        defaultPipelineCreated: true,
        workspaceReady: true,
        organisationRolesProvisioned: true,
      },
      organizationId,
      nextAction: 'dashboard',
      onboardingCompletedAt: summary.provisionedAt,
    };
  }

  async getSummary(userId: string) {
    const row = await this.getRow(userId);
    if (row.status !== 'completed' || !row.organization_id) {
      throw new ConflictException('Onboarding has not been completed');
    }
    const organizationId = row.organization_id;
    const [
      organizationResult,
      settingsResult,
      departmentsResult,
      pipelineResult,
      rolesResult,
    ] = await Promise.all([
      this.supabase.adminClient
        .from('organizations')
        .select(
          'id,name,website,company_size,logo_path,created_at,industries(name)',
        )
        .eq('id', organizationId)
        .single(),
      this.supabase.adminClient
        .from('organization_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .single(),
      this.supabase.adminClient
        .from('departments')
        .select('id,name,description,display_order,icon_id')
        .eq('organization_id', organizationId)
        .order('display_order'),
      this.supabase.adminClient
        .from('hiring_pipelines')
        .select('id,name,hiring_pipeline_stages(name,display_order)')
        .eq('organization_id', organizationId)
        .eq('is_default', true)
        .single(),
      this.supabase.adminClient
        .from('organization_roles')
        .select('key')
        .eq('organization_id', organizationId),
    ]);
    const failure = [
      organizationResult,
      settingsResult,
      departmentsResult,
      pipelineResult,
      rolesResult,
    ].find((result) => result.error);
    if (failure?.error)
      throw mapDatabaseError(failure.error, 'load setup summary');
    const organization = organizationResult.data as unknown as {
      id: string;
      name: string;
      website: string | null;
      company_size: string;
      logo_path: string | null;
      created_at: string;
      industries: { name: string } | { name: string }[];
    };
    const pipeline = pipelineResult.data as unknown as {
      name: string;
      hiring_pipeline_stages: { name: string; display_order: number }[];
    };
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        industry: this.relatedName(organization.industries),
        size: organization.company_size,
        website: organization.website,
        logoUrl: await this.signedLogoUrl(organization.logo_path),
      },
      departments: departmentsResult.data ?? [],
      settings: settingsResult.data,
      pipeline: {
        name: pipeline.name,
        stages: [...pipeline.hiring_pipeline_stages]
          .sort((a, b) => a.display_order - b.display_order)
          .map((stage) => stage.name),
      },
      roles: {
        provisioned: (rolesResult.data ?? []).map(
          (role: { key: string }) => role.key,
        ),
        creatorRole: 'organisation_owner',
      },
      provisionedAt: row.completed_at ?? organization.created_at,
    };
  }

  private async getRow(userId: string): Promise<OnboardingRow> {
    const { error: ensureError } = await this.supabase.adminClient.rpc(
      'ensure_employer_onboarding',
      { p_user_id: userId } as never,
    );
    if (ensureError) throw mapOnboardingDatabaseError(ensureError);
    const { data, error } = await this.supabase.adminClient
      .from('employer_onboarding')
      .select('*,industries(name)')
      .eq('user_id', userId)
      .single();
    if (error) throw mapDatabaseError(error, 'load employer onboarding');
    return data;
  }

  private async getLogoUpload(userId: string, uploadId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('onboarding_logo_uploads')
      .select('*')
      .eq('id', uploadId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error, 'load logo upload');
    if (!data) throw new NotFoundException('Logo upload not found');
    return data as unknown as LogoUploadRow;
  }

  private async serializeState(row: OnboardingRow) {
    if (row.status === 'completed') {
      return {
        status: 'completed',
        startedAt: row.started_at ?? null,
        currentStep: 4,
        totalSteps: 4,
        progressPercentage: 100,
        nextAction: 'dashboard',
        completedSteps: [1, 2, 3],
        organizationId: row.organization_id,
        onboardingCompletedAt: row.completed_at,
      };
    }
    return {
      status: row.status === 'not_started' ? 'not_started' : 'in_progress',
      startedAt: row.started_at ?? null,
      currentStep: row.status === 'not_started' ? 0 : row.current_step,
      totalSteps: 4,
      progressPercentage: Math.min(row.completed_steps.length * 25, 75),
      nextAction: this.nextAction(row),
      completedSteps: row.completed_steps,
      company: (await this.companyResponse(row)).company,
      companyRevision: row.company_revision,
      departments: row.department_drafts,
      departmentsRevision: row.departments_revision,
      workspaceSettings: this.workspaceResponse(row).settings,
      settingsRevision: row.settings_revision,
      lastSavedAt: row.updated_at,
    };
  }

  private async companyResponse(row: OnboardingRow) {
    const fieldsComplete = {
      name: Boolean(row.company_name),
      industry: Boolean(row.industry_id),
      size: Boolean(row.company_size),
      website: Boolean(row.company_website),
      logo: Boolean(row.logo_path),
    };
    return {
      company: {
        name: row.company_name,
        industryId: row.industry_id,
        industryName: this.relatedName(row.industries),
        website: row.company_website,
        size: row.company_size,
        sizeLabel: this.companySizeLabel(row.company_size),
        logoUrl: await this.signedLogoUrl(row.logo_path),
        logoUploadedAt: row.logo_uploaded_at,
      },
      fieldsComplete,
      allRequiredComplete:
        fieldsComplete.name && fieldsComplete.industry && fieldsComplete.size,
      canProceed:
        fieldsComplete.name && fieldsComplete.industry && fieldsComplete.size,
      revision: row.company_revision,
    };
  }

  private departmentResponse(row: OnboardingRow) {
    return {
      departments: row.department_drafts.map((item, order) => ({
        ...item,
        order,
      })),
      revision: row.departments_revision,
      count: row.department_drafts.length,
      hasMinimum: row.department_drafts.length > 0,
    };
  }

  private workspaceResponse(row: OnboardingRow) {
    const requiredFieldsComplete = Boolean(
      row.country_code && row.timezone && row.locale,
    );
    return {
      settings: {
        countryCode: row.country_code,
        countryName: row.country_code
          ? (countries.getName(row.country_code, 'en') ?? row.country_code)
          : null,
        timezone: row.timezone,
        locale: row.locale,
        weekStartsOn: row.week_starts_on,
        dateFormat: row.date_format,
      },
      requiredFieldsComplete,
      canProceed: requiredFieldsComplete,
      revision: row.settings_revision,
    };
  }

  private missingRequirements(row: OnboardingRow): string[] {
    const missing: string[] = [];
    if (!row.company_name) missing.push('Company name is required');
    if (!row.industry_id) missing.push('Industry is required');
    if (!row.company_size) missing.push('Company size is required');
    if (row.department_drafts.length < 1)
      missing.push('At least one department is required');
    if (!row.country_code) missing.push('Country is required');
    if (!row.timezone) missing.push('Timezone is required');
    if (!row.locale) missing.push('Locale is required');
    if (![1, 2, 3].every((step) => row.completed_steps.includes(step))) {
      missing.push('All onboarding steps must be completed');
    }
    return missing;
  }

  private nextAction(row: OnboardingRow): string {
    if (row.status === 'completed') return 'dashboard';
    if (row.status === 'not_started') return 'welcome';
    if (!row.completed_steps.includes(1)) return 'company_setup';
    if (!row.completed_steps.includes(2)) return 'departments';
    if (!row.completed_steps.includes(3)) return 'workspace_settings';
    return 'review';
  }

  private companySizeLabel(size: string | null): string | null {
    return size
      ? ((
          {
            '1_10': '1-10 Employees',
            '11_25': '11-25 Employees',
            '26_50': '26-50 Employees',
            '51_100': '51-100 Employees',
            '101_plus': '101+ Employees',
          } as Record<string, string>
        )[size] ?? size)
      : null;
  }

  private relatedName(
    value: { name: string } | { name: string }[] | null | undefined,
  ) {
    return Array.isArray(value)
      ? (value[0]?.name ?? null)
      : (value?.name ?? null);
  }

  private async signedLogoUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.supabase.adminClient.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  private extensionFor(type: LogoContentType): string {
    return {
      [LogoContentType.SVG]: 'svg',
      [LogoContentType.PNG]: 'png',
      [LogoContentType.JPEG]: 'jpg',
      [LogoContentType.GIF]: 'gif',
    }[type];
  }

  private matchesContentType(buffer: Buffer, type: LogoContentType): boolean {
    if (type === LogoContentType.PNG)
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (type === LogoContentType.JPEG)
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (type === LogoContentType.GIF)
      return ['GIF87a', 'GIF89a'].includes(
        buffer.subarray(0, 6).toString('ascii'),
      );
    const text = buffer
      .toString('utf8')
      .trim()
      .replace(/^<\?xml[^>]*>\s*/i, '');
    return text.startsWith('<svg');
  }

  private async discardLogo(path: string) {
    await this.supabase.adminClient.storage.from(LOGO_BUCKET).remove([path]);
  }
}

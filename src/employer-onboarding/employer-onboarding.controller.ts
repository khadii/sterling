import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { CompanyDraftDto } from './dto/company-draft.dto';
import { SaveDepartmentsDto } from './dto/departments.dto';
import { ConfirmLogoUploadDto, CreateLogoUploadDto } from './dto/logo.dto';
import {
  LogoUploadResponseDto,
  OnboardingResponseDto,
} from './dto/onboarding-response.dto';
import { WorkspaceSettingsDto } from './dto/workspace-settings.dto';
import { EmployerOnboardingService } from './employer-onboarding.service';

@ApiTags('Employer Onboarding')
@ApiBearerAuth()
@ApiResponse({ status: 400, type: ApiErrorDto })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 409, type: ApiErrorDto })
@ApiResponse({ status: 429, type: ApiErrorDto })
@ApiResponse({ status: 500, type: ApiErrorDto })
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYER)
@Controller('employer/onboarding')
export class EmployerOnboardingController {
  constructor(private readonly onboarding: EmployerOnboardingService) {}

  @Get()
  @ApiOperation({ summary: 'Get resumable employer onboarding state' })
  @ApiOkResponse({ type: OnboardingResponseDto })
  getState(@Req() request: RequestWithUser) {
    return this.onboarding.getState(request.user.id);
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave Welcome and start onboarding; retries preserve progress',
  })
  @ApiOkResponse({ type: OnboardingResponseDto })
  start(@Req() request: RequestWithUser) {
    return this.onboarding.start(request.user.id);
  }

  @Patch('company')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Auto-save the Step 1 company draft' })
  saveCompany(@Req() request: RequestWithUser, @Body() dto: CompanyDraftDto) {
    return this.onboarding.saveCompany(request.user.id, dto);
  }

  @Post('company/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and complete Step 1' })
  completeCompany(@Req() request: RequestWithUser) {
    return this.onboarding.completeStep(request.user.id, 1);
  }

  @Post('company/logo/upload-url')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a direct-to-Supabase signed logo upload' })
  @ApiOkResponse({ type: LogoUploadResponseDto })
  createLogoUpload(
    @Req() request: RequestWithUser,
    @Body() dto: CreateLogoUploadDto,
  ) {
    return this.onboarding.createLogoUpload(request.user.id, dto);
  }

  @Post('company/logo/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate, sanitize, and confirm an uploaded logo' })
  confirmLogo(
    @Req() request: RequestWithUser,
    @Body() dto: ConfirmLogoUploadDto,
  ) {
    return this.onboarding.confirmLogo(request.user.id, dto);
  }

  @Delete('company/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Idempotently remove the current company logo' })
  @ApiNoContentResponse()
  async removeLogo(@Req() request: RequestWithUser): Promise<void> {
    await this.onboarding.removeLogo(request.user.id);
  }

  @Put('departments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Replace the complete Step 2 department draft' })
  saveDepartments(
    @Req() request: RequestWithUser,
    @Body() dto: SaveDepartmentsDto,
  ) {
    return this.onboarding.saveDepartments(request.user.id, dto);
  }

  @Post('departments/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and complete Step 2' })
  completeDepartments(@Req() request: RequestWithUser) {
    return this.onboarding.completeStep(request.user.id, 2);
  }

  @Patch('workspace-settings')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Auto-save Step 3 workspace preferences' })
  saveWorkspaceSettings(
    @Req() request: RequestWithUser,
    @Body() dto: WorkspaceSettingsDto,
  ) {
    return this.onboarding.saveWorkspaceSettings(request.user.id, dto);
  }

  @Post('workspace-settings/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and complete Step 3' })
  completeWorkspaceSettings(@Req() request: RequestWithUser) {
    return this.onboarding.completeStep(request.user.id, 3);
  }

  @Get('review')
  @ApiOperation({ summary: 'Get the read-only Step 4 provisioning review' })
  review(@Req() request: RequestWithUser) {
    return this.onboarding.getReview(request.user.id, request.user.email);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Idempotently provision the employer workspace' })
  complete(@Req() request: RequestWithUser) {
    return this.onboarding.complete(request.user.id);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get the completed workspace setup summary' })
  summary(@Req() request: RequestWithUser) {
    return this.onboarding.getSummary(request.user.id);
  }
}

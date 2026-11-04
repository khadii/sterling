import {
  PartialType,
  OmitType,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  ArrayUnique,
  ArrayMinSize,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
];
export const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'on_site'];
export const JOB_STATUSES = ['draft', 'open', 'on_hold', 'closed'];
export const CANDIDATE_STATUSES = [
  'new',
  'in_review',
  'assessment',
  'interview',
  'offer',
  'hired',
  'rejected',
];
export const CANDIDATE_SOURCES = [
  'careers_page',
  'linkedin',
  'referral',
  'indeed',
  'other',
  'manual',
];
export const STAGE_CATEGORIES = [
  'screening',
  'interview',
  'assessment',
  'offer',
  'hired',
  'other',
];
export const PUBLISHING_CHANNELS = [
  'careers_page',
  'global_syndication',
  'internal_mobility',
  'premium_boost',
];
export const AUTOMATION_KINDS = [
  'email',
  'calendar',
  'ai_evaluation',
  'reviewer_assignment',
  'custom',
];

export class JobListQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES })
  @IsOptional()
  @IsIn(JOB_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Matches job title or reference' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Optional page number. Omit both page and limit to return every matching job; page alone uses 50 per page.',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, maximum: 200 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class CandidateListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  jobId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiPropertyOptional({ enum: CANDIDATE_STATUSES })
  @IsOptional()
  @IsIn(CANDIDATE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Matches candidate name or email' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, maximum: 200 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class JobMetricsQueryDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-09' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;
}

export class ResponsibilityDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

export class QualificationDto {
  @ApiPropertyOptional({ enum: ['must_have', 'preferred'] })
  @IsOptional()
  @IsIn(['must_have', 'preferred'])
  kind?: 'must_have' | 'preferred';

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

export class JobSkillDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: ['working', 'proficient', 'expert'] })
  @IsOptional()
  @IsIn(['working', 'proficient', 'expert'])
  level?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class ScreeningQuestionDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  prompt!: string;

  @ApiPropertyOptional({
    enum: ['number', 'boolean', 'short_answer', 'url'],
    default: 'short_answer',
  })
  @IsOptional()
  @IsIn(['number', 'boolean', 'short_answer', 'url'])
  kind?: string;

  @ApiPropertyOptional({ example: '5+ years' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  threshold?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  weight?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isKnockout?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  expectedAnswer?: string;
}

export class StageAutomationDto {
  @ApiProperty({ enum: AUTOMATION_KINDS })
  @IsIn(AUTOMATION_KINDS)
  kind!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    type: Object,
    example: {
      recipient: 'candidate',
      subject: 'Application update',
      body: 'Your application has moved to the next stage.',
      delayHours: 24,
      durationMinutes: 30,
      reviewerRole: 'reviewer',
    },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class StageAssessmentDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 600, example: 45 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: '2 challenges' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  format?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  pointsTotal?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passingPercent?: number;
}

export class PipelineStageDto {
  @ApiProperty({ maxLength: 120, example: 'Screening' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: STAGE_CATEGORIES, default: 'screening' })
  @IsOptional()
  @IsIn(STAGE_CATEGORIES)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accent?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAssessment?: boolean;

  @ApiPropertyOptional({ type: StageAssessmentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StageAssessmentDto)
  assessment?: StageAssessmentDto;

  @ApiPropertyOptional({ type: [StageAutomationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StageAutomationDto)
  automations?: StageAutomationDto[];
}

export class PublishingChannelDto {
  @ApiProperty({ enum: PUBLISHING_CHANNELS })
  @IsIn(PUBLISHING_CHANNELS)
  channel!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class BenefitDto {
  @ApiProperty({ maxLength: 200, example: 'Comprehensive Health Insurance' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class HiringTeamMemberDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ default: 'reviewer', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  roleLabel?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLead?: boolean;
}

export class CreateJobDto {
  @ApiProperty({ maxLength: 160, example: 'Senior Product Designer' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Organisation directory role this job is created from',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Reporting manager' })
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @ApiPropertyOptional({ example: 'JOB-0012' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES, default: 'full_time' })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @ApiPropertyOptional({ enum: WORK_ARRANGEMENTS, default: 'hybrid' })
  @IsOptional()
  @IsIn(WORK_ARRANGEMENTS)
  workArrangement?: string;

  @ApiPropertyOptional({ example: 'Senior (L4)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  seniorityLevel?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  experienceMinYears?: number;

  @ApiPropertyOptional({ maxLength: 300, example: 'Degree or equivalent' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  educationRequirement?: string;

  @ApiPropertyOptional({ maxLength: 300, example: 'Figma mastery' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  primaryTooling?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 720, default: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  reviewSlaHours?: number;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @Matches(/^[a-zA-Z]{2}$/)
  locationCountry?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locationCity?: string;

  @ApiPropertyOptional({ minimum: 0, example: 120000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ minimum: 0, example: 150000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMax?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Matches(/^[a-zA-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  positions?: number;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  postedOn?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  closesOn?: string;

  @ApiPropertyOptional({ type: [ResponsibilityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ResponsibilityDto)
  responsibilities?: ResponsibilityDto[];

  @ApiPropertyOptional({ type: [QualificationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => QualificationDto)
  qualifications?: QualificationDto[];

  @ApiPropertyOptional({ type: [JobSkillDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => JobSkillDto)
  skills?: JobSkillDto[];

  @ApiPropertyOptional({ type: [ScreeningQuestionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ScreeningQuestionDto)
  screeningQuestions?: ScreeningQuestionDto[];

  @ApiPropertyOptional({ type: [PipelineStageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PipelineStageDto)
  stages?: PipelineStageDto[];

  @ApiPropertyOptional({ type: [PublishingChannelDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PublishingChannelDto)
  channels?: PublishingChannelDto[];

  @ApiPropertyOptional({ type: [BenefitDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BenefitDto)
  benefits?: BenefitDto[];

  @ApiPropertyOptional({ type: [HiringTeamMemberDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HiringTeamMemberDto)
  hiringTeam?: HiringTeamMemberDto[];

  @ApiPropertyOptional({
    type: Number,
    description:
      'Optional optimistic-concurrency token from the latest job read. Omit it to save over the current revision; a stale value returns 409 JOB_REVISION_CONFLICT.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

export class UpdateJobDto extends PartialType(CreateJobDto) {}

export class JobStatusDto {
  @ApiProperty({ enum: ['open', 'on_hold', 'closed'] })
  @IsIn(['open', 'on_hold', 'closed'])
  status!: 'open' | 'on_hold' | 'closed';
}

export class CreateCandidateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  jobId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiProperty({ maxLength: 160, example: 'Sarah Johnson' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName!: string;

  @ApiProperty({ format: 'email', example: 'sarah.johnson@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ enum: CANDIDATE_SOURCES, default: 'careers_page' })
  @IsOptional()
  @IsIn(CANDIDATE_SOURCES)
  source?: string;

  @ApiPropertyOptional({ example: 'UX Designer' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  currentRole?: string;

  @ApiPropertyOptional({ example: 'Google' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  currentCompany?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  resumeUrl?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 94 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  matchScore?: number;

  @ApiPropertyOptional({ enum: CANDIDATE_STATUSES, default: 'new' })
  @IsOptional()
  @IsIn(CANDIDATE_STATUSES)
  status?: string;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}

export class AdvanceCandidateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  stageId!: string;

  @ApiPropertyOptional({
    enum: CANDIDATE_STATUSES,
    description: 'Defaults to the status implied by the destination stage',
  })
  @IsOptional()
  @IsIn(CANDIDATE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}

export class UpdatePipelineStageDto extends PartialType(
  OmitType(PipelineStageDto, ['automations'] as const),
) {}
export class UpdateStageAutomationDto extends PartialType(StageAutomationDto) {}
export class ReorderPipelineStagesDto {
  @ApiProperty({
    type: [String],
    description:
      'Every existing stage ID in the desired order; IDs remain unchanged.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  stageIds!: string[];
}

export class SaveStageAutomationDto extends StageAutomationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Keep the ID returned by GET for existing rules; omit for new rules.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;
}
export class SaveStageAutomationsDto {
  @ApiProperty({
    type: [SaveStageAutomationDto],
    description:
      'Complete desired list. Omitted rules are removed only if unused; keep used rules with isEnabled=false.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SaveStageAutomationDto)
  items!: SaveStageAutomationDto[];
}

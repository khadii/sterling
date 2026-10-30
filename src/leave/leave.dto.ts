import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MinLength,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const POLICY_STATUSES = ['active', 'draft', 'not_active', 'inactive'];
export const ELIGIBILITY_MATCH = ['all', 'any'];
export const GENDER_ELIGIBILITY = ['all', 'male', 'female'];
export const ALLOWANCE_TYPES = ['fixed', 'unlimited'];
export const ACCRUAL_METHODS = ['upfront', 'scheduled'];
export const APPROVAL_WORKFLOWS = ['default', 'custom'];
export const LEAVE_TYPES = [
  'annual',
  'sick',
  'study',
  'compassionate',
  'maternity',
  'paternity',
  'unpaid',
  'other',
];

export class BlackoutPeriodDto {
  @ApiProperty({ example: 'End of Year Freeze' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '2024-12-20' })
  @IsDateString()
  startsOn!: string;

  @ApiProperty({ example: '2025-01-05' })
  @IsDateString()
  endsOn!: string;
}

export class ApprovalChainStepDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  level!: number;

  @ApiProperty({ example: 'Direct Manager' })
  @IsString()
  @MaxLength(120)
  approverRole!: string;

  @ApiProperty({ example: 'approval_required' })
  @IsString()
  @MaxLength(60)
  action!: string;
}

export class PolicyAssignmentDto {
  @ApiProperty({ enum: ['department', 'role', 'employee'] })
  @IsIn(['department', 'role', 'employee'])
  kind!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class LeavePolicyDto {
  @ApiProperty({ example: 'Annual Leave' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: LEAVE_TYPES, example: 'annual' })
  @IsIn(LEAVE_TYPES)
  leaveType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: POLICY_STATUSES, default: 'draft' })
  @IsOptional()
  @IsIn(POLICY_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ enum: ELIGIBILITY_MATCH, default: 'all' })
  @IsOptional()
  @IsIn(ELIGIBILITY_MATCH)
  eligibilityMatch?: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  employmentTypes?: string[];

  @ApiPropertyOptional({ enum: GENDER_ELIGIBILITY, default: 'all' })
  @IsOptional()
  @IsIn(GENDER_ELIGIBILITY)
  genderEligibility?: string;

  @ApiPropertyOptional({ enum: ALLOWANCE_TYPES, default: 'fixed' })
  @IsOptional()
  @IsIn(ALLOWANCE_TYPES)
  allowanceType?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(366)
  daysPerYear?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  proRateNewHires?: boolean;

  @ApiPropertyOptional({ enum: ACCRUAL_METHODS, default: 'upfront' })
  @IsOptional()
  @IsIn(ACCRUAL_METHODS)
  accrualMethod?: string;

  @ApiPropertyOptional({ example: 'monthly' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  accrualFrequency?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(366)
  maxCarryover?: number;

  @ApiPropertyOptional({ example: 'march' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  carryoverExpiry?: string;

  @ApiPropertyOptional({ example: 0.5, default: 0.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(366)
  minDuration?: number;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  maxConsecutiveDays?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  advanceNoticeDays?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireDocumentation?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  documentationThresholdDays?: number;

  @ApiPropertyOptional({ type: [BlackoutPeriodDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BlackoutPeriodDto)
  blackoutPeriods?: BlackoutPeriodDto[];

  @ApiPropertyOptional({ enum: APPROVAL_WORKFLOWS, default: 'default' })
  @IsOptional()
  @IsIn(APPROVAL_WORKFLOWS)
  approvalWorkflow?: string;

  @ApiPropertyOptional({ type: [ApprovalChainStepDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ApprovalChainStepDto)
  approvalChain?: ApprovalChainStepDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  autoDeductPayroll?: boolean;

  @ApiPropertyOptional({ type: [PolicyAssignmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PolicyAssignmentDto)
  assignment?: PolicyAssignmentDto[];
}

export class UpdateLeavePolicyDto extends PartialType(LeavePolicyDto) {}

export class LeavePolicyListQueryDto {
  @ApiPropertyOptional({ enum: POLICY_STATUSES })
  @IsOptional()
  @IsIn(POLICY_STATUSES)
  status?: string;

  @ApiPropertyOptional({ description: 'Matches policy name or leave type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Optional page number. Omit both page and limit to return every policy',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class LeaveSettingsDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  leaveYearStartMonth!: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(31)
  leaveYearStartDay!: number;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  leaveYearEndMonth!: number;

  @ApiProperty({ example: 31 })
  @IsInt()
  @Min(1)
  @Max(31)
  leaveYearEndDay!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  proRateNewStarters?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  accrueByHours?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  trackPublicHolidays?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  managerNotifications?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  carryForwardEnabled?: boolean;
}

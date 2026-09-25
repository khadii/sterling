import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  Matches,
} from 'class-validator';
export class HrQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  payrollId?: string;
  @ApiPropertyOptional({
    enum: [
      'pending',
      'approved',
      'declined',
      'cancelled',
      'draft',
      'finalized',
      'open',
      'closed',
    ],
  })
  @IsOptional()
  @IsIn([
    'pending',
    'approved',
    'declined',
    'cancelled',
    'draft',
    'finalized',
    'open',
    'closed',
  ])
  status?: string;
  @ApiPropertyOptional({ format: 'date', example: '2026-09-20' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({
    type: Number,
    description: 'Page number; omit with limit to return one full page',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({
    type: Number,
    maximum: 100,
    description: 'Page size; omit to return the entire list',
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class EmployeeDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Existing workspace member; no new user account is created',
  })
  @IsUUID()
  userId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
  @ApiProperty({ example: '2026-09-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  birthDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  probationEndsOn?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  salaryReviewOn?: string;
  @ApiPropertyOptional({
    example: 80000,
    description: 'Annual base salary; not take-home pay',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  annualSalary?: number;
  @ApiProperty({ example: 'USD' }) @Matches(/^[A-Z]{3}$/) currency!: string;
}
export class UpdateEmployeeDto extends PartialType(EmployeeDto) {}
export class OnboardingItemDto {
  @ApiProperty({ example: 'Deliver laptop' })
  @IsString()
  @Length(1, 200)
  title!: string;
  @ApiProperty({ example: false }) @IsBoolean() completed!: boolean;
}
export class OnboardingDto {
  @ApiProperty({ type: [OnboardingItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OnboardingItemDto)
  checklist!: OnboardingItemDto[];
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  buddyUserId?: string;
  @ApiProperty({ enum: ['pending', 'ordered', 'delivered'] })
  @IsIn(['pending', 'ordered', 'delivered'])
  hardwareStatus!: string;
  @ApiProperty({ enum: ['pending', 'prepared', 'delivered'] })
  @IsIn(['pending', 'prepared', 'delivered'])
  welcomePackStatus!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  hrNotes?: string;
}
export class LeaveDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ enum: ['annual', 'sick', 'study'] })
  @IsIn(['annual', 'sick', 'study'])
  leaveType!: string;
  @ApiProperty({ example: '2026-09-21' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn!: string;
  @ApiProperty({ example: '2026-09-23' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
export class DecisionDto {
  @ApiProperty({ enum: ['approved', 'declined', 'cancelled'] })
  @IsIn(['approved', 'declined', 'cancelled'])
  status!: string;
  @ApiPropertyOptional({ description: 'Required for decline' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
export class BulkDecisionDto extends DecisionDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}
export class AttendanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ example: '2026-09-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date!: string;
  @ApiProperty({ enum: ['present', 'late', 'absent'] })
  @IsIn(['present', 'late', 'absent'])
  state!: string;
  @ApiProperty({ example: 8 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(24)
  hours!: number;
}
export class ReviewDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() reviewerUserId!: string;
  @ApiProperty({ example: '2026-09-25' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dueOn!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
export class ExpenseDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ example: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
  @ApiProperty({ example: 'USD' }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ example: 'Travel reimbursement' })
  @IsString()
  @Length(1, 2000)
  description!: string;
}
export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({ example: 'Passport' })
  @IsString()
  @Length(1, 160)
  name!: string;
  @ApiProperty({ example: '2026-10-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  expiresOn!: string;
}
export class InterviewDto {
  @ApiProperty({ example: 'Alex Smith' })
  @IsString()
  @Length(1, 160)
  candidateName!: string;
  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  candidateEmail!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() roleId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() eventId!: string;
}
export class RequisitionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() roleId!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamId?: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(100000) positions!: number;
}
export class DepartmentPlanningDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  leadUserId?: string;
  @ApiProperty({ example: 200000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  annualBudget!: number;
  @ApiProperty({ example: 'USD' }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ enum: ['stable', 'growing', 'at_capacity', 'optimized'] })
  @IsIn(['stable', 'growing', 'at_capacity', 'optimized'])
  operationalStatus!: string;
}
export class TeamPlanningDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  @Max(100000)
  plannedCapacity!: number;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  iconId?: string;
}
export class LeaveEntitlementDto {
  @ApiProperty({ enum: ['annual', 'sick', 'study'] })
  @IsIn(['annual', 'sick', 'study'])
  leaveType!: string;
  @ApiProperty({ example: 25 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(366)
  days!: number;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2200) year!: number;
}
export class PayrollDto {
  @ApiProperty({ example: '2026-09-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn!: string;
  @ApiProperty({ example: '2026-09-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn!: string;
  @ApiProperty({ example: '2026-09-28' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  closesOn!: string;
  @ApiProperty({ example: 'USD' }) @Matches(/^[A-Z]{3}$/) currency!: string;
}
export class PayrollLineDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() employeeId!: string;
  @ApiProperty({
    example: 4000,
    description: 'Explicit gross amount for this payroll period',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  gross!: number;
  @ApiProperty({ example: 500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deductions!: number;
}
export class MessageDto {
  @ApiProperty({ example: 'Happy birthday!' })
  @IsString()
  @Length(1, 2000)
  message!: string;
}
export class RsvpDto {
  @ApiProperty({ enum: ['accepted', 'declined', 'pending'] })
  @IsIn(['accepted', 'declined', 'pending'])
  response!: string;
}

export class ApprovalChainDto {
  @ApiProperty({ enum: ['leave', 'attendance', 'reviews', 'expenses'] })
  @IsIn(['leave', 'attendance', 'reviews', 'expenses'])
  kind!: string;
  @ApiProperty({
    type: [String],
    description: 'Ordered approver user IDs; applied to new requests only',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  approverIds!: string[];
}
export class BulkIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class UpdateOnboardingDto extends PartialType(OnboardingDto) {}
export class UpdateLeaveDto extends PartialType(LeaveDto) {}
export class UpdateAttendanceDto extends PartialType(AttendanceDto) {}
export class UpdateReviewDto extends PartialType(ReviewDto) {}
export class UpdateExpenseDto extends PartialType(ExpenseDto) {}
export class UpdateDocumentDto extends PartialType(DocumentDto) {}
export class UpdateInterviewDto extends PartialType(InterviewDto) {}
export class UpdateRequisitionDto extends PartialType(RequisitionDto) {}
export class UpdateDepartmentPlanningDto extends PartialType(
  DepartmentPlanningDto,
) {}
export class UpdateTeamPlanningDto extends PartialType(TeamPlanningDto) {}
export class UpdateLeaveEntitlementDto extends PartialType(
  LeaveEntitlementDto,
) {}
export class UpdatePayrollDto extends PartialType(PayrollDto) {}
export class UpdatePayrollLineDto extends PartialType(PayrollLineDto) {}

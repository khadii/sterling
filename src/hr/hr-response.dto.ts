import {
  ReadRelationsDto,
  RelatedPersonDto,
  RelatedNameDto,
} from '../common/dto/read-relations.dto';
import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { EmployeeDto, OnboardingItemDto } from './hr.dto';
export class HrSummaryDto {
  @ApiProperty({ example: 0 }) headcount!: number;
  @ApiProperty({ example: 0 }) previousHeadcount!: number;
  @ApiProperty({ example: 0 }) headcountChange!: number;
  @ApiProperty({ type: Number, nullable: true, example: null })
  headcountGrowthPercent!: number | null;
  @ApiProperty({ example: 0 }) departments!: number;
  @ApiProperty({ example: 0 }) subteams!: number;
  @ApiProperty({ example: 0 }) openRoles!: number;
  @ApiProperty({ example: 0 }) onLeaveToday!: number;
  @ApiProperty({ example: 0 }) pendingLeaveRequests!: number;
  @ApiProperty({ example: 0 }) startersToday!: number;
  @ApiProperty({ example: 0 }) reviewsDueThisWeek!: number;
  @ApiProperty({ example: 0 }) interviewsToday!: number;
  @ApiProperty({ example: 0 }) expiringDocuments!: number;
  @ApiProperty({ example: 0 }) pendingApprovals!: number;
}
export class HrPersonDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}
export class HrDepartmentMetricsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 0 }) headcount!: number;
  @ApiProperty({ example: 0 }) previousHeadcount!: number;
  @ApiProperty({ type: Number, nullable: true, example: null }) growthPercent!:
    number | null;
  @ApiProperty({ example: 0 }) subteams!: number;
  @ApiProperty({ example: 0 }) openRoles!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0,
    description:
      'Approved present + late employees / active headcount × 100; null with no employees',
  })
  attendancePercent!: number | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) leadUserId!:
    string | null;
  @ApiProperty({ type: HrPersonDto, nullable: true }) lead!: HrPersonDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['stable', 'growing', 'at_capacity', 'optimized'],
  })
  operationalStatus!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 0 }) annualBudget!:
    number | null;
  @ApiProperty({ type: String, nullable: true, example: 'USD' }) currency!:
    string | null;
  @ApiProperty({ type: Number, nullable: true, example: 0 })
  annualSalaryTotal!: number | null;
  @ApiProperty({ example: 0 }) salaryRecordsMissingOrOtherCurrency!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0,
    description:
      'Annual base salary / annual budget × 100. Null for zero budget, incomplete currency-matched salary records, or historical dates.',
  })
  budgetUtilizationPercent!: number | null;
}
export class HrTeamMetricsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ example: 0 }) headcount!: number;
  @ApiProperty({ type: Number, nullable: true, example: 10 }) plannedCapacity!:
    number | null;
  @ApiProperty({ type: Number, nullable: true, example: 0 }) capacityPercent!:
    number | null;
  @ApiProperty({ type: Boolean, nullable: true, example: true }) understaffed!:
    boolean | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) iconId!:
    string | null;
}
export class HrAttendanceSummaryDto {
  @ApiProperty({ example: 0 }) present!: number;
  @ApiProperty({ example: 0 }) late!: number;
  @ApiProperty({ example: 0 }) absent!: number;
  @ApiProperty({
    example: 0,
    description:
      'Active employees without an approved attendance record for the selected date',
  })
  unrecorded!: number;
}
export class HrLeaveSummaryDto {
  @ApiProperty({ example: 0 }) pending!: number;
  @ApiProperty({ example: 0 }) approved!: number;
  @ApiProperty({ example: 0 }) awayToday!: number;
}
export class HrMetricsDto {
  @ApiProperty({ example: '2026-09-21', format: 'date' }) date!: string;
  @ApiProperty({ example: 'Africa/Lagos' }) timezone!: string;
  @ApiProperty({ type: HrSummaryDto }) summary!: HrSummaryDto;
  @ApiProperty({ type: [HrDepartmentMetricsDto] })
  departments!: HrDepartmentMetricsDto[];
  @ApiProperty({ type: [HrTeamMetricsDto] }) teams!: HrTeamMetricsDto[];
  @ApiProperty({ type: HrAttendanceSummaryDto })
  attendance!: HrAttendanceSummaryDto;
  @ApiProperty({ type: HrLeaveSummaryDto }) leaveOverview!: HrLeaveSummaryDto;
}
export class HrSalaryAverageDto {
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ type: Number, nullable: true, example: 0 }) average!:
    number | null;
  @ApiProperty({ example: 1 }) sampleSize!: number;
}
export class HrRoleMemberDto extends HrPersonDto {
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty({ format: 'date', example: '2026-09-21' }) startsOn!: string;
}
export class HrRoleStatsDto {
  @ApiPropertyOptional({ type: RelatedNameDto, nullable: true })
  role?: RelatedNameDto | null;
  @ApiPropertyOptional({ format: 'uuid' }) roleId?: string;
  @ApiProperty({ example: 0 }) totalPositions!: number;
  @ApiProperty({ example: 0 }) plannedPositions!: number;
  @ApiProperty({ example: 0 }) filledPositions!: number;
  @ApiProperty({ example: 0 }) openPositions!: number;
  @ApiProperty({
    type: [HrSalaryAverageDto],
    nullable: true,
    description:
      'Separated by currency. Null without payroll.view; empty when no holders.',
  })
  averageSalaryByCurrency!: HrSalaryAverageDto[] | null;
  @ApiProperty({ type: [HrRoleMemberDto] }) members!: HrRoleMemberDto[];
}
export class HrOnboardingStatsDto {
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  buddy?: RelatedPersonDto | null;
  @ApiProperty({ type: [OnboardingItemDto] }) checklist!: OnboardingItemDto[];
  @ApiProperty({ example: 0 }) completedItems!: number;
  @ApiProperty({ example: 0 }) totalItems!: number;
  @ApiProperty({ example: 0 }) progressPercent!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  buddyUserId?: string | null;
  @ApiPropertyOptional({ enum: ['pending', 'ordered', 'delivered'] })
  hardwareStatus?: string;
  @ApiPropertyOptional({ enum: ['pending', 'prepared', 'delivered'] })
  welcomePackStatus?: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Only visible with employees.manage',
  })
  hrNotes?: string | null;
}
export class HrLeaveBalanceDto {
  @ApiProperty({ enum: ['annual', 'sick', 'study'] }) leaveType!: string;
  @ApiProperty({ example: 2026 }) year!: number;
  @ApiProperty({ example: 0 }) entitled!: number;
  @ApiProperty({ example: 0 }) used!: number;
  @ApiProperty({ example: 0 }) remaining!: number;
}
export class HrEmployeeAttendanceDto {
  @ApiProperty({ example: 0 }) approvedDays!: number;
  @ApiProperty({ example: 0 }) approvedHours!: number;
}
export class HrEmployeeResponseDto extends IntersectionType(
  OmitType(EmployeeDto, ['annualSalary'] as const),
  ReadRelationsDto,
) {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ example: 0 }) revision!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0,
    description: 'Null without payroll.view; a saved zero remains 0.',
  })
  annualSalary!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'Ada Okafor' })
  displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'ada@example.com' })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!:
    string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Engineering' })
  departmentName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Engineer' })
  roleName!: string | null;
}
export class HrEmployeeStatsDto {
  @ApiProperty({ type: HrEmployeeResponseDto })
  employee!: HrEmployeeResponseDto;
  @ApiProperty({ type: [HrLeaveBalanceDto] })
  leaveBalances!: HrLeaveBalanceDto[];
  @ApiProperty({ type: HrOnboardingStatsDto })
  onboarding!: HrOnboardingStatsDto;
  @ApiProperty({ type: HrEmployeeAttendanceDto })
  attendance!: HrEmployeeAttendanceDto;
  @ApiProperty({ example: 0 }) pendingReviews!: number;
}
export class HrPayrollLineResponseDto extends ReadRelationsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty({ format: 'uuid' }) payrollId!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ example: 0 }) gross!: number;
  @ApiProperty({ example: 0 }) deductions!: number;
  @ApiProperty({ example: 0 }) net!: number;
}
export class HrPayrollStatsDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ format: 'date' }) closesOn!: string;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ enum: ['draft', 'finalized'] }) status!: string;
  @ApiProperty({ example: 0 }) grossTotal!: number;
  @ApiProperty({ example: 0 }) deductionsTotal!: number;
  @ApiProperty({ example: 0 }) netTotal!: number;
  @ApiProperty({ example: 0 }) employeeCount!: number;
  @ApiProperty({ example: 0 }) pendingTimesheets!: number;
  @ApiProperty({ type: [HrPayrollLineResponseDto] })
  lines!: HrPayrollLineResponseDto[];
}

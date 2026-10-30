import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EMPLOYEE_LEAVE_TYPES, EMPLOYEE_WORK_MODES } from './employee.dto';

export class EmployeeProfileDto {
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiPropertyOptional({ nullable: true }) displayName?: string | null;
  @ApiPropertyOptional({ nullable: true }) fullName?: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) email?: string | null;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiPropertyOptional({ nullable: true }) organizationName?: string | null;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiPropertyOptional({ nullable: true }) departmentName?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) roleId?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) roleName?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  managerUserId?: string | null;
  @ApiPropertyOptional({ nullable: true }) managerName?: string | null;
  @ApiProperty({ example: '2026-11-01' }) startsOn!: string;
  @ApiPropertyOptional({ nullable: true, example: null }) endsOn?:
    string | null;
  @ApiPropertyOptional({ nullable: true }) probationEndsOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) birthDate?: string | null;
  @ApiPropertyOptional({ nullable: true }) annualSalary?: number | null;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ enum: ['active', 'inactive'] }) status!: string;
  @ApiProperty({ example: '2026-10-24' }) date!: string;
  @ApiProperty({ example: 'UTC' }) timezone!: string;
}

export class EmployeeLeaveBalanceDto {
  @ApiProperty({ enum: EMPLOYEE_LEAVE_TYPES }) leaveType!: string;
  @ApiProperty({ example: 2026 }) year!: number;
  @ApiProperty({ example: 20 }) entitled!: number;
  @ApiProperty({ example: 5.5 }) used!: number;
  @ApiProperty({ example: 14.5 }) remaining!: number;
  @ApiPropertyOptional({ nullable: true, example: 27.5 })
  usedPercent?: number | null;
}

export class EmployeeLeaveRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: EMPLOYEE_LEAVE_TYPES }) leaveType!: string;
  @ApiProperty({ example: '2026-11-10' }) startsOn!: string;
  @ApiProperty({ example: '2026-11-14' }) endsOn!: string;
  @ApiProperty({ example: 5 }) days!: number;
  @ApiProperty({ enum: ['pending', 'approved', 'declined', 'cancelled'] })
  status!: string;
  @ApiPropertyOptional({ nullable: true }) reason?: string | null;
  @ApiPropertyOptional({ nullable: true }) decisionReason?: string | null;
  @ApiProperty({ format: 'date-time' }) requestedOn!: string;
}

export class EmployeeLeaveSummaryDto {
  @ApiProperty({ example: 1 }) pending!: number;
  @ApiProperty({ example: 3 }) approved!: number;
  @ApiProperty({ example: 0 }) declined!: number;
  @ApiProperty({ example: 9.5 }) daysUsed!: number;
}

export class EmployeeLeaveDto {
  @ApiProperty({ example: '2026-10-24' }) date!: string;
  @ApiProperty({ example: 2026 }) year!: number;
  @ApiProperty({ type: [EmployeeLeaveBalanceDto] })
  balances!: EmployeeLeaveBalanceDto[];
  @ApiProperty({ type: [EmployeeLeaveRecordDto] })
  upcoming!: EmployeeLeaveRecordDto[];
  @ApiProperty({ type: [EmployeeLeaveRecordDto] })
  history!: EmployeeLeaveRecordDto[];
  @ApiProperty({ type: EmployeeLeaveSummaryDto })
  summary!: EmployeeLeaveSummaryDto;
}

export class EmployeeApprovalStepDto {
  @ApiProperty({ example: 1 }) position!: number;
  @ApiProperty({ format: 'uuid' }) approverId!: string;
  @ApiPropertyOptional({ nullable: true }) approverName?: string | null;
  @ApiProperty({ enum: ['pending', 'approved', 'declined'] }) status!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  decidedAt?: string | null;
}

export class EmployeeLeaveDetailDto extends EmployeeLeaveRecordDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  decidedBy?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  decidedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) decidedByName?: string | null;
  @ApiProperty({ type: [EmployeeApprovalStepDto] })
  approvalSteps!: EmployeeApprovalStepDto[];
}

export class EmployeeClockDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026-10-24' }) workDate!: string;
  @ApiProperty({ format: 'date-time' }) checkedInAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  checkedOutAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  breakStartedAt?: string | null;
  @ApiProperty({ example: 30 }) breakMinutes!: number;
  @ApiProperty({ enum: EMPLOYEE_WORK_MODES }) workMode!: string;
  @ApiPropertyOptional({ nullable: true, example: 5.7 }) hours?: number | null;
  @ApiPropertyOptional({ example: 8 }) targetHours?: number;
  @ApiPropertyOptional({ example: true }) checkedIn?: boolean;
}

export class EmployeeAttendanceRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026-10-20' }) date!: string;
  @ApiProperty({ enum: ['present', 'late', 'absent'] }) state!: string;
  @ApiProperty({ example: 8 }) hours!: number;
  @ApiProperty({ enum: ['pending', 'approved', 'declined'] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) decisionReason?: string | null;
}

export class EmployeeAttendanceSummaryDto {
  @ApiProperty({ example: 18 }) presentDays!: number;
  @ApiProperty({ example: 2 }) lateDays!: number;
  @ApiProperty({ example: 1 }) absentDays!: number;
}

export class EmployeeAttendanceDto {
  @ApiProperty({ example: '2026-09-24' }) from!: string;
  @ApiProperty({ example: '2026-10-24' }) to!: string;
  @ApiProperty({ example: '2026-10-24' }) date!: string;
  @ApiProperty({ example: 8 }) targetHours!: number;
  @ApiPropertyOptional({ type: EmployeeClockDto, nullable: true })
  today?: EmployeeClockDto | null;
  @ApiProperty({ type: [EmployeeClockDto] }) sessions!: EmployeeClockDto[];
  @ApiProperty({ type: [EmployeeAttendanceRecordDto] })
  records!: EmployeeAttendanceRecordDto[];
  @ApiProperty({ type: EmployeeAttendanceSummaryDto })
  summary!: EmployeeAttendanceSummaryDto;
}

export class EmployeeTaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiPropertyOptional({ nullable: true }) projectName?: string | null;
  @ApiProperty({ enum: ['low', 'normal', 'high', 'urgent'] })
  priority!: string;
  @ApiProperty({ enum: ['todo', 'in_progress', 'done'] }) status!: string;
  @ApiProperty({ example: '2026-10-20' }) startDate!: string;
  @ApiProperty({ example: '2026-10-25' }) dueDate!: string;
  @ApiProperty({ example: false }) overdue!: boolean;
  @ApiPropertyOptional({ nullable: true }) ownerName?: string | null;
}

export class EmployeeTasksDto {
  @ApiProperty({ type: [EmployeeTaskDto] }) items!: EmployeeTaskDto[];
  @ApiProperty({
    type: 'object',
    properties: {
      total: { type: 'integer', example: 12 },
      todo: { type: 'integer', example: 5 },
      inProgress: { type: 'integer', example: 4 },
      completed: { type: 'integer', example: 3 },
      overdue: { type: 'integer', example: 2 },
    },
  })
  summary!: Record<string, number>;
}

export class EmployeeTeamMemberDto {
  @ApiProperty({ format: 'uuid' }) employeeId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiPropertyOptional({ nullable: true }) displayName?: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) email?: string | null;
  @ApiPropertyOptional({ nullable: true }) roleName?: string | null;
  @ApiPropertyOptional({ nullable: true }) departmentName?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  teamId?: string | null;
  @ApiProperty({
    enum: [
      'out_of_office',
      'in_meeting',
      'working_office',
      'working_remote',
      'working_hybrid',
      'offline',
    ],
  })
  status!: string;
}

export class EmployeeTeamDto {
  @ApiProperty({ type: [EmployeeTeamMemberDto] })
  items!: EmployeeTeamMemberDto[];
}

export class EmployeeDocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '2027-01-31' }) expiresOn!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  updateRequestedAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  dismissedAt?: string | null;
  @ApiProperty({ example: false }) expiringSoon!: boolean;
  @ApiProperty({ example: false }) expired!: boolean;
}

export class EmployeeDocumentsDto {
  @ApiProperty({ type: [EmployeeDocumentDto] })
  items!: EmployeeDocumentDto[];
}

export class EmployeePayslipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) payrollId!: string;
  @ApiProperty({ example: '2026-09-01' }) periodStartsOn!: string;
  @ApiProperty({ example: '2026-09-30' }) periodEndsOn!: string;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ example: 5200 }) gross!: number;
  @ApiProperty({ example: 600 }) deductions!: number;
  @ApiProperty({ example: 4600 }) net!: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  finalizedAt?: string | null;
}

export class EmployeePayslipsDto {
  @ApiProperty({ type: [EmployeePayslipDto] })
  items!: EmployeePayslipDto[];
}

export class EmployeeAnnouncementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: ['general', 'holiday', 'hr', 'event'] })
  category!: string;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiPropertyOptional({ nullable: true, example: null })
  expiresOn?: string | null;
  @ApiPropertyOptional({ nullable: true }) authorName?: string | null;
}

export class EmployeeAnnouncementsDto {
  @ApiProperty({ type: [EmployeeAnnouncementDto] })
  items!: EmployeeAnnouncementDto[];
}

export class EmployeeCourseDto {
  @ApiProperty({ format: 'uuid' }) courseId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ example: 135 }) durationMinutes!: number;
  @ApiProperty({ enum: ['beginner', 'intermediate', 'advanced'] })
  level!: string;
  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] })
  status!: string;
  @ApiProperty({ example: 60 }) progress!: number;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  startedAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt?: string | null;
}

export class EmployeeLearningDto {
  @ApiProperty({ type: [EmployeeCourseDto] }) items!: EmployeeCourseDto[];
  @ApiProperty({
    type: 'object',
    properties: {
      completed: { type: 'integer', example: 12 },
      inProgress: { type: 'integer', example: 3 },
      notStarted: { type: 'integer', example: 5 },
      totalMinutes: { type: 'integer', example: 1230 },
      overallProgress: { type: 'number', nullable: true, example: 60 },
    },
  })
  summary!: Record<string, number | null>;
}

export class EmployeeCalendarEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
  @ApiProperty({ example: false }) allDay!: boolean;
  @ApiPropertyOptional({ nullable: true }) location?: string | null;
  @ApiPropertyOptional({ nullable: true }) meetingUrl?: string | null;
  @ApiProperty() timezone!: string;
}

export class EmployeeCalendarDto {
  @ApiProperty({ example: '2026-10-24' }) from!: string;
  @ApiProperty({ example: '2026-11-23' }) to!: string;
  @ApiProperty({ type: [EmployeeCalendarEventDto] })
  items!: EmployeeCalendarEventDto[];
}

export class EmployeeDashboardDto {
  @ApiProperty({ type: EmployeeProfileDto }) profile!: EmployeeProfileDto;
  @ApiProperty({ example: '2026-10-24' }) date!: string;
  @ApiProperty({ type: [EmployeeAnnouncementDto] })
  announcements!: EmployeeAnnouncementDto[];
  @ApiPropertyOptional({ type: EmployeeClockDto, nullable: true })
  clock?: EmployeeClockDto | null;
  @ApiProperty({ type: [EmployeeCalendarEventDto] })
  agenda!: EmployeeCalendarEventDto[];
  @ApiProperty({ type: 'object', additionalProperties: true })
  leave!: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true })
  tasks!: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true })
  learning!: Record<string, unknown>;
  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  review?: Record<string, unknown> | null;
  @ApiProperty({ type: [EmployeeTeamMemberDto] })
  team!: EmployeeTeamMemberDto[];
}

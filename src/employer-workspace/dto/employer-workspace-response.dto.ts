import {
  HrSummaryDto,
  HrDepartmentMetricsDto,
  HrAttendanceSummaryDto,
  HrLeaveSummaryDto,
  HrTeamMetricsDto,
} from '../../hr/hr-response.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActivityCategory,
  AttendeeResponse,
  CalendarEventKind,
} from './employer-workspace.dto';

const ORGANIZATION_ID = '8a53bff5-a952-4ad7-b466-730659020a8e';
const EVENT_ID = 'f91c8019-92a8-4714-bf0a-00f3ff5520df';
const USER_ID = '152d8fe4-4c96-4e1f-a336-88fa60762587';
const DEPARTMENT_ID = 'c56e6a9b-b44c-40ee-9d05-ab5090d8cc39';

export class OrganizationSummaryDto {
  @ApiProperty({ format: 'uuid', example: ORGANIZATION_ID }) id!: string;
  @ApiProperty({ example: 'Sterling Tech' }) name!: string;
}

export class ActivitySubjectResponseDto {
  @ApiProperty({ example: 'calendar_event' }) type!: string;
  @ApiProperty({ format: 'uuid', example: EVENT_ID }) id!: string;
}

export class ActivityResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'c6b3b90b-72f1-464f-8215-2153a88de13a',
  })
  id!: string;
  @ApiProperty({ enum: ActivityCategory, example: ActivityCategory.EVENTS })
  category!: string;
  @ApiProperty({ example: 'calendar_event_created' }) kind!: string;
  @ApiProperty({ example: 'Weekly planning' }) title!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Calendar event created',
  })
  summary!: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-09-04T11:45:00Z' })
  occurredAt!: string;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: USER_ID,
  })
  actorId!: string | null;
  @ApiPropertyOptional({ type: ActivitySubjectResponseDto, nullable: true })
  subject!: ActivitySubjectResponseDto | null;
  @ApiProperty({ enum: ['normal', 'attention', 'urgent'], example: 'normal' })
  urgency!: string;
  @ApiProperty({ type: [String], example: [] }) availableActions!: string[];
}

export class ActivityListResponseDto {
  @ApiProperty({
    example: 15,
    description:
      'Refresh the first page at this interval for live activity updates',
  })
  refreshAfterSeconds!: number;
  @ApiProperty({ type: [ActivityResponseDto] }) items!: ActivityResponseDto[];
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example:
      'eyJvY2N1cnJlZEF0IjoiMjAyNi0wOS0wNFQxMTo0NTowMFoiLCJpZCI6ImM2YjNiOTBiLTcyZjEtNDY0Zi04MjE1LTIxNTNhODhkZTEzYSJ9',
  })
  nextCursor!: string | null;
}

export class CalendarAttendeeResponseDto {
  @ApiProperty({ format: 'uuid', example: USER_ID }) userId!: string;
  @ApiProperty({ enum: AttendeeResponse, example: AttendeeResponse.ACCEPTED })
  response!: string;
}

export class CalendarEventResponseDto {
  @ApiPropertyOptional({
    type: Object,
    description: 'Permission-checked HR source detail, present on GET by ID',
  })
  details?: object;
  @ApiProperty({ format: 'uuid', example: EVENT_ID }) id!: string;
  @ApiProperty({ format: 'uuid', example: ORGANIZATION_ID })
  organizationId!: string;
  @ApiProperty({
    enum: CalendarEventKind,
    example: CalendarEventKind.TEAM_MEETING,
  })
  kind!: string;
  @ApiProperty({
    enum: ['manual', 'interview', 'leave', 'employee', 'performance'],
    example: 'manual',
  })
  source!: string;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
  })
  sourceId!: string | null;
  @ApiProperty({ example: 'Weekly planning' }) title!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Review priorities for the coming week.',
  })
  description!: string | null;
  @ApiProperty({ format: 'date-time', example: '2026-09-07T09:00:00Z' })
  startsAt!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-07T10:00:00Z' })
  endsAt!: string;
  @ApiProperty({ example: 'Africa/Lagos' }) timezone!: string;
  @ApiProperty({ example: false }) allDay!: boolean;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Meeting Room A',
  })
  location!: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    nullable: true,
    example: 'https://meet.example.com/weekly-planning',
  })
  meetingUrl!: string | null;
  @ApiProperty({ format: 'uuid', example: USER_ID }) organizerId!: string;
  @ApiProperty({ type: [CalendarAttendeeResponseDto] })
  attendees!: CalendarAttendeeResponseDto[];
  @ApiProperty({ format: 'uuid', example: USER_ID }) createdBy!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-04T11:30:00Z' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-04T11:30:00Z' })
  updatedAt!: string;
}

export class CalendarEventListResponseDto {
  @ApiProperty({ type: [CalendarEventResponseDto] })
  items!: CalendarEventResponseDto[];
}

export class CalendarCountsResponseDto {
  @ApiPropertyOptional({ example: 2 }) interview?: number;
  @ApiPropertyOptional({ example: 1 }) onboarding?: number;
  @ApiPropertyOptional({ example: 3 }) leave?: number;
  @ApiPropertyOptional({ example: 2 }) team_meeting?: number;
  @ApiPropertyOptional({ example: 1 }) public_holiday?: number;
  @ApiPropertyOptional({ example: 1 }) birthday?: number;
  @ApiPropertyOptional({ example: 1 }) work_anniversary?: number;
  @ApiPropertyOptional({ example: 2 }) performance_review?: number;
}

export class CalendarSummaryResponseDto {
  @ApiProperty({ type: HrSummaryDto }) summary!: HrSummaryDto;
  @ApiProperty({ format: 'date', example: '2026-09-04' }) date!: string;
  @ApiProperty({ example: 'Africa/Lagos' }) timezone!: string;
  @ApiProperty({ type: CalendarCountsResponseDto })
  counts!: CalendarCountsResponseDto;
}

export class DepartmentIconResponseDto {
  @ApiProperty({ enum: ['builtin', 'available', 'temporarily_unavailable'] })
  imageStatus!: string;
  @ApiProperty({ type: Boolean }) retryable!: boolean;
  @ApiProperty({
    format: 'uuid',
    example: '88bf5704-f2da-47d0-b826-b601e00711bf',
  })
  id!: string;
  @ApiProperty({ example: 'Engineering' }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'code' })
  builtinKey!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Expiring signed URL for uploaded icons; null for built-ins',
  })
  url!: string | null;
}

export class DepartmentResponseDto {
  @ApiPropertyOptional({ type: HrDepartmentMetricsDto })
  metrics?: HrDepartmentMetricsDto;
  @ApiProperty({ type: 'integer' }) membershipRevision!: number;
  @ApiProperty({ format: 'uuid', example: DEPARTMENT_ID }) id!: string;
  @ApiProperty({ format: 'uuid', example: ORGANIZATION_ID })
  organizationId!: string;
  @ApiProperty({ example: 'Engineering' }) name!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Product development and infrastructure.',
  })
  description!: string | null;
  @ApiProperty({ example: 0 }) displayOrder!: number;
  @ApiProperty({ example: false }) archived!: boolean;
  @ApiProperty({ type: DepartmentIconResponseDto })
  icon!: DepartmentIconResponseDto;
  @ApiProperty({ format: 'date-time', example: '2026-09-04T11:00:00Z' })
  createdAt!: string;
}

export class DepartmentSummaryResponseDto {
  @ApiProperty({ example: 3 }) totalDepartments!: number;
  @ApiProperty({ type: Number, example: 0 })
  totalHeadcount!: number;
  @ApiProperty({ type: Number, example: 0 }) totalSubteams!: number;
}

export class DepartmentListResponseDto {
  @ApiProperty({ type: DepartmentSummaryResponseDto })
  summary!: DepartmentSummaryResponseDto;
  @ApiProperty({ type: [DepartmentResponseDto] })
  items!: DepartmentResponseDto[];
  @ApiProperty({
    type: [String],
    example: [],
  })
  unavailableMetrics!: string[];
}

export class DepartmentMetricsResponseDto extends HrDepartmentMetricsDto {}

export class DepartmentDetailResponseDto extends DepartmentResponseDto {
  @ApiProperty({ type: DepartmentMetricsResponseDto })
  declare metrics: DepartmentMetricsResponseDto;
  @ApiProperty({
    type: [String],
    example: [],
  })
  unavailableMetrics!: string[];
}

export class DashboardSummaryResponseDto extends HrSummaryDto {}

export class EmployerDashboardResponseDto {
  @ApiProperty({ format: 'date', example: '2026-09-21' })
  date!: string;
  @ApiProperty({ type: [HrDepartmentMetricsDto] })
  departments!: HrDepartmentMetricsDto[];
  @ApiProperty({ type: [HrTeamMetricsDto] })
  teams!: HrTeamMetricsDto[];
  @ApiProperty({ type: HrAttendanceSummaryDto })
  attendance!: HrAttendanceSummaryDto;
  @ApiProperty({ type: HrLeaveSummaryDto }) leaveOverview!: HrLeaveSummaryDto;
  @ApiProperty({
    type: Object,
    example: {
      starters: [],
      awayToday: [],
      milestones: [],
      upcomingBirthdaysAndAnniversaries: [],
      nextPayrollClose: null,
    },
  })
  widgets!: object;
  @ApiProperty({
    type: Object,
    example: {
      headcount: [{ date: '2026-09-21', value: 0 }],
      attendance: [{ date: '2026-09-21', present: 0 }],
    },
  })
  trends!: object;

  @ApiProperty({ type: OrganizationSummaryDto })
  organization!: OrganizationSummaryDto;
  @ApiProperty({ example: 'Africa/Lagos' }) timezone!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-04T12:00:00Z' })
  asOf!: string;
  @ApiProperty({ type: DashboardSummaryResponseDto })
  summary!: DashboardSummaryResponseDto;
  @ApiProperty({ type: ActivityListResponseDto })
  todaysActivity!: ActivityListResponseDto;
  @ApiProperty({ type: CalendarEventListResponseDto })
  upcomingEvents!: CalendarEventListResponseDto;
  @ApiProperty({ type: DepartmentListResponseDto })
  departmentOverview!: DepartmentListResponseDto;
  @ApiProperty({
    type: [String],
    example: [],
  })
  unavailableMetrics!: string[];
}

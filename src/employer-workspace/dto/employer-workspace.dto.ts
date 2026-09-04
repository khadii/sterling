import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OrganizationQueryDto {
  @ApiProperty({
    format: 'uuid',
    example: '8a53bff5-a952-4ad7-b466-730659020a8e',
    description: 'Organization selected in the workspace switcher',
  })
  @IsUUID()
  organizationId!: string;
}

export enum ActivityCategory {
  RECRUITMENT = 'recruitment',
  EMPLOYEE = 'employee',
  PAYROLL = 'payroll',
  COMPLIANCE = 'compliance',
  EVENTS = 'events',
}

export class ActivityQueryDto extends OrganizationQueryDto {
  @ApiPropertyOptional({ format: 'date-time', example: '2026-09-04T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time', example: '2026-09-05T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
  @ApiPropertyOptional({
    enum: ActivityCategory,
    example: ActivityCategory.EVENTS,
  })
  @IsOptional()
  @IsEnum(ActivityCategory)
  category?: ActivityCategory;
  @ApiPropertyOptional({ example: 'meeting', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({
    description: 'Opaque nextCursor from the preceding page',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export enum CalendarEventKind {
  INTERVIEW = 'interview',
  ONBOARDING = 'onboarding',
  LEAVE = 'leave',
  TEAM_MEETING = 'team_meeting',
  PUBLIC_HOLIDAY = 'public_holiday',
  BIRTHDAY = 'birthday',
  WORK_ANNIVERSARY = 'work_anniversary',
  PERFORMANCE_REVIEW = 'performance_review',
}

export class CalendarQueryDto extends OrganizationQueryDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-01T00:00:00Z' })
  @IsISO8601()
  from!: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-01T00:00:00Z' })
  @IsISO8601()
  to!: string;

  @ApiPropertyOptional({
    enum: CalendarEventKind,
    isArray: true,
    example: [CalendarEventKind.INTERVIEW, CalendarEventKind.TEAM_MEETING],
    description: 'Comma-separated in a query string',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @IsEnum(CalendarEventKind, { each: true })
  kinds?: CalendarEventKind[];
}

export class CalendarSummaryQueryDto extends OrganizationQueryDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-09-04' })
  @IsOptional()
  @IsISO8601()
  date?: string;
}

export enum AttendeeResponse {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  TENTATIVE = 'tentative',
}

export class EventAttendeeDto {
  @ApiProperty({
    format: 'uuid',
    example: '152d8fe4-4c96-4e1f-a336-88fa60762587',
  })
  @IsUUID()
  userId!: string;
  @ApiPropertyOptional({
    enum: AttendeeResponse,
    default: AttendeeResponse.PENDING,
  })
  @IsOptional()
  @IsEnum(AttendeeResponse)
  response = AttendeeResponse.PENDING;
}

export class CreateCalendarEventDto {
  @ApiProperty({
    format: 'uuid',
    example: '8a53bff5-a952-4ad7-b466-730659020a8e',
  })
  @IsUUID()
  organizationId!: string;
  @ApiProperty({
    enum: CalendarEventKind,
    example: CalendarEventKind.TEAM_MEETING,
  })
  @IsEnum(CalendarEventKind)
  kind!: CalendarEventKind;
  @ApiProperty({ example: 'Weekly planning', minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;
  @ApiPropertyOptional({
    example: 'Review priorities for the coming week.',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-07T09:00:00Z' })
  @IsISO8601()
  startsAt!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-07T10:00:00Z' })
  @IsISO8601()
  endsAt!: string;
  @ApiProperty({ example: 'Africa/Lagos' })
  @IsTimeZone()
  timezone!: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allDay = false;
  @ApiPropertyOptional({ example: 'Meeting Room A', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;
  @ApiPropertyOptional({ example: 'https://meet.example.com/weekly-planning' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  meetingUrl?: string;
  @ApiPropertyOptional({ type: [EventAttendeeDto], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventAttendeeDto)
  attendees: EventAttendeeDto[] = [];
}

export class UpdateCalendarEventDto {
  @ApiProperty({
    format: 'uuid',
    example: '8a53bff5-a952-4ad7-b466-730659020a8e',
  })
  @IsUUID()
  organizationId!: string;
  @ApiPropertyOptional({ enum: CalendarEventKind })
  @IsOptional()
  @IsEnum(CalendarEventKind)
  kind?: CalendarEventKind;
  @ApiPropertyOptional({
    example: 'Updated weekly planning',
    minLength: 2,
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;
  @ApiPropertyOptional({ example: 'Updated agenda', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiPropertyOptional({ format: 'date-time', example: '2026-09-07T10:00:00Z' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;
  @ApiPropertyOptional({ format: 'date-time', example: '2026-09-07T11:00:00Z' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;
  @ApiPropertyOptional({ example: 'Meeting Room B', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;
  @ApiPropertyOptional({ example: 'https://meet.example.com/updated-planning' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  meetingUrl?: string;
  @ApiPropertyOptional({ type: [EventAttendeeDto], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EventAttendeeDto)
  attendees?: EventAttendeeDto[];
}

export class CreateDepartmentDto {
  @ApiProperty({
    format: 'uuid',
    example: '8a53bff5-a952-4ad7-b466-730659020a8e',
  })
  @IsUUID()
  organizationId!: string;
  @ApiProperty({ example: 'Engineering', minLength: 2, maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  name!: string;
  @ApiPropertyOptional({
    example: 'Product development and infrastructure.',
    maxLength: 250,
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    example: '88bf5704-f2da-47d0-b826-b601e00711bf',
  })
  @IsOptional()
  @IsUUID()
  iconId?: string;
}

export class DepartmentQueryDto extends OrganizationQueryDto {
  @ApiPropertyOptional({ example: 'engineering', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  includeArchived = false;
}

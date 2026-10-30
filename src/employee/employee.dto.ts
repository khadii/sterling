import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EMPLOYEE_LEAVE_TYPES = [
  'annual',
  'sick',
  'study',
  'personal',
  'maternity',
  'paternity',
  'compassionate',
  'unpaid',
] as const;

export const EMPLOYEE_CLOCK_ACTIONS = [
  'in',
  'out',
  'break-start',
  'break-end',
] as const;

export const EMPLOYEE_WORK_MODES = ['office', 'remote', 'hybrid'] as const;

export const EMPLOYEE_TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export class EmployeeRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class EmployeeLeaveRequestDto {
  @ApiProperty({ enum: EMPLOYEE_LEAVE_TYPES })
  @IsIn(EMPLOYEE_LEAVE_TYPES)
  leaveType!: string;

  @ApiProperty({ example: '2026-11-10' })
  @IsISO8601({ strict: true })
  startsOn!: string;

  @ApiProperty({ example: '2026-11-14' })
  @IsISO8601({ strict: true })
  endsOn!: string;

  @ApiPropertyOptional({ example: 'Family wedding' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class EmployeeClockDto {
  @ApiProperty({ enum: EMPLOYEE_CLOCK_ACTIONS })
  @IsIn(EMPLOYEE_CLOCK_ACTIONS)
  action!: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_WORK_MODES })
  @IsOptional()
  @IsIn(EMPLOYEE_WORK_MODES)
  workMode?: string;
}

export class EmployeeTaskStatusDto {
  @ApiProperty({ enum: EMPLOYEE_TASK_STATUSES })
  @IsIn(EMPLOYEE_TASK_STATUSES)
  status!: string;
}

export class EmployeeCourseProgressDto {
  @ApiProperty({ minimum: 0, maximum: 100, example: 60 })
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}

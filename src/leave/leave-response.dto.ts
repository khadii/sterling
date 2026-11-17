import { ApiProperty } from '@nestjs/swagger';
import { LeavePolicyDto } from './leave.dto';

export class LeavePolicyResponseDto extends LeavePolicyDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ example: 0 })
  revision!: number;
  @ApiProperty({ format: 'uuid' })
  createdBy!: string;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
export class LeaveSettingsResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({
    description:
      'False when returning unsaved defaults; GET never inserts a settings row.',
  })
  isConfigured!: boolean;
  @ApiProperty({ example: 1 })
  leaveYearStartMonth!: number;
  @ApiProperty({ example: 1 })
  leaveYearStartDay!: number;
  @ApiProperty({ example: 12 })
  leaveYearEndMonth!: number;
  @ApiProperty({ example: 31 })
  leaveYearEndDay!: number;
  @ApiProperty({})
  proRateNewStarters!: boolean;
  @ApiProperty({})
  accrueByHours!: boolean;
  @ApiProperty({})
  trackPublicHolidays!: boolean;
  @ApiProperty({})
  managerNotifications!: boolean;
  @ApiProperty({})
  carryForwardEnabled!: boolean;
  @ApiProperty({ type: Number, nullable: true })
  carryForwardStartMonth!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  carryForwardStartDay!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  carryForwardEndMonth!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  carryForwardEndDay!: number | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  updatedAt!: string | null;
}

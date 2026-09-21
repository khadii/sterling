import { HrRoleStatsDto, HrTeamMetricsDto } from '../hr/hr-response.dto';
import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger';
import {
  CreateRoleDto,
  CreateProjectDto,
  CreateTaskDto,
  CreateTeamDto,
} from './workflow.dto';
export class WorkflowIdentityDto {
  @ApiProperty({
    format: 'uuid',
    example: 'da0ea39c-2cbb-4216-a460-e65b8b349c53',
  })
  id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-14T12:00:00Z' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-14T12:00:00Z' })
  updatedAt!: string;
}
export class WorkflowRoleResponseDto extends IntersectionType(
  WorkflowIdentityDto,
  CreateRoleDto,
) {
  @ApiPropertyOptional({ type: HrRoleStatsDto }) metrics?: HrRoleStatsDto;
  @ApiProperty({ type: 'integer', minimum: 0 }) revision!: number;
  @ApiProperty({ example: 'custom_da0ea39c2cbb4216a460e65b8b349c53' })
  key!: string;
  @ApiProperty({ example: false }) isSystem!: boolean;
}
export class WorkflowTeamResponseDto extends IntersectionType(
  WorkflowIdentityDto,
  CreateTeamDto,
) {
  @ApiPropertyOptional({ type: HrTeamMetricsDto }) metrics?: HrTeamMetricsDto;
  @ApiPropertyOptional({ example: 0 }) memberCount?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 0 })
  plannedCapacity?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 0 })
  capacityPercent?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) understaffed?:
    boolean | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  iconId?: string | null;
  @ApiProperty({ type: 'integer', minimum: 0 }) membershipRevision!: number;
}
export class WorkflowProgressDto {
  @ApiProperty({ example: 10 }) totalTasks!: number;
  @ApiProperty({ example: 6 }) completedTasks!: number;
  @ApiProperty({ example: 60 }) percent!: number;
}
export class WorkflowProjectResponseDto extends IntersectionType(
  WorkflowIdentityDto,
  CreateProjectDto,
) {
  @ApiPropertyOptional({
    type: WorkflowProgressDto,
    description: 'Included on the project detail endpoint.',
  })
  progress?: WorkflowProgressDto;
}
export class WorkflowTaskResponseDto extends IntersectionType(
  WorkflowIdentityDto,
  CreateTaskDto,
) {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
}

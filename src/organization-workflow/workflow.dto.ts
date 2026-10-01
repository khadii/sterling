import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { CreateDepartmentDto } from '../employer-workspace/dto/employer-workspace.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  Matches,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class WorkflowDepartmentDto extends OmitType(CreateDepartmentDto, [
  'organizationId',
] as const) {}
export class WorkflowQueryDto {
  @ApiPropertyOptional({
    enum: ['size_desc', 'size_asc', 'name'],
    description: 'Team directory sorting; defaults to largest first',
  })
  @IsOptional()
  @IsIn(['size_desc', 'size_asc', 'name'])
  sort?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Omit for a single-workspace account. Required only to select among multiple memberships.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ type: 'integer', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;
  @ApiPropertyOptional({ type: 'integer', default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
export class RoleRequirementsDto {
  @ApiPropertyOptional({ type: [String], example: ['Design reliable APIs'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  responsibilities?: string[];
  @ApiPropertyOptional({
    type: [String],
    example: ['TypeScript', 'PostgreSQL'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  skills?: string[];
  @ApiPropertyOptional({ example: 'Bachelors Degree' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  minimumDegree?: string;
  @ApiPropertyOptional({ example: 'Computer Science' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fieldOfStudy?: string;
  @ApiPropertyOptional({ example: 3, minimum: 0, maximum: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  minYears?: number;
  @ApiPropertyOptional({ example: 7, minimum: 0, maximum: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  maxYears?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  certifications?: string[];
  @ApiPropertyOptional({ type: [String], example: ['English (Fluent)'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  languages?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  otherRequirements?: string;
}
export class RoleLeaveDaysDto {
  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  annual?: number;
  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  sick?: number;
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  study?: number;
}
export class RoleBenefitDetailDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty() @IsString() @MaxLength(1000) description!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  allowance?: number;
}
export class RoleBenefitsDto {
  @ApiPropertyOptional({ type: RoleLeaveDaysDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleLeaveDaysDto)
  leaveDays?: RoleLeaveDaysDto;
  @ApiPropertyOptional({ type: [RoleBenefitDetailDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RoleBenefitDetailDto)
  details?: RoleBenefitDetailDto[];

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
  @ApiPropertyOptional({ example: 80000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000000)
  minimumSalary?: number;
  @ApiPropertyOptional({ example: 120000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000000)
  maximumSalary?: number;
  @ApiPropertyOptional({ type: [String], example: ['annual', 'sick'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @IsIn(['annual', 'sick', 'study'], { each: true })
  leaveTypes?: string[];
  @ApiPropertyOptional({ example: 'annual' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  salaryReviewFrequency?: string;
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  probationMonths?: number;
  @ApiPropertyOptional({ example: 'monthly' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  growthReviewFrequency?: string;
  @ApiPropertyOptional({ example: 'Senior Engineer to Lead Engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  successionPath?: string;
  @ApiPropertyOptional({ example: 'Engineering Manager' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reportingLine?: string;
  @ApiPropertyOptional({
    type: [String],
    example: ['Health benefits', 'Learning budget'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  benefits?: string[];
}
export class CreateRoleDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Department for a job role; omit for a standalone access role.',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'ID of an active icon from GET /reference/department-icons. The selected ID is stored and returned unchanged.',
  })
  @IsOptional()
  @IsUUID()
  iconId?: string | null;
  @ApiPropertyOptional({ enum: ['draft', 'active'], default: 'draft' })
  @IsOptional()
  @IsIn(['draft', 'active'])
  status?: 'draft' | 'active';
  @ApiPropertyOptional({
    example: 'Build reliable services. Plain text; not HTML.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional({ example: 'L5 - Senior' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  level?: string;
  @ApiPropertyOptional({ example: 'full_time' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  employmentType?: string;
  @ApiPropertyOptional({ example: 'Lagos, Nigeria' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
  @ApiPropertyOptional({ enum: ['on_site', 'remote', 'hybrid'] })
  @IsOptional()
  @IsIn(['on_site', 'remote', 'hybrid'])
  workArrangement?: string;
  @ApiPropertyOptional({ type: RoleRequirementsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleRequirementsDto)
  requirements?: RoleRequirementsDto;
  @ApiPropertyOptional({ type: RoleBenefitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoleBenefitsDto)
  benefits?: RoleBenefitsDto;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Organization member who is the reporting manager.',
  })
  @IsOptional()
  @IsUUID()
  reportsToUserId?: string | null;
  @ApiPropertyOptional({
    type: [String],
    example: ['teams.view', 'teams.manage'],
    description:
      'Explicit permission IDs from GET /organization/permissions. Empty by default.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissionIds?: string[];
}
export class UpdateRoleDto extends PartialType(CreateRoleDto) {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description:
      'Optional optimistic-concurrency token. Omit it to apply the change directly; supply the latest revision from GET /organization/roles/{roleId} to reject the write with 409 when the role changed since it was loaded. Never hardcode 0.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
export class PermissionsDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description:
      'Optional optimistic-concurrency token. Omit it to replace permissions directly; supply the latest revision from GET /organization/roles/{roleId} to get a 409 when the role changed since it was loaded. Never hardcode 0.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
  @ApiProperty({ type: [String], example: ['teams.view', 'teams.manage'] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissionIds!: string[];
}
export class AssignRolesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Adds these roles; preserves existing assignments.',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}
export class MembersDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'membershipRevision returned by the team',
  })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Complete replacement of the team membership list.',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  memberIds!: string[];
}
export class CreateTeamDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description: 'Required when updating an existing team member list',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiProperty({ example: 'Backend Core' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;
  @ApiPropertyOptional({ example: 'Core API development' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  memberIds?: string[];
}
export class UpdateTeamDto extends PartialType(CreateTeamDto) {}
export class CreateProjectDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() departmentId!: string;
  @ApiProperty({
    format: 'uuid',
    description: 'An existing sub-team in the selected department.',
  })
  @IsUUID()
  teamId!: string;
  @ApiProperty({ example: 'Core API v2 Refactor' })
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name!: string;
  @ApiPropertyOptional({ example: 'Standardize internal endpoints.' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiProperty({ enum: ['low', 'medium', 'high'], example: 'medium' })
  @IsIn(['low', 'medium', 'high'])
  priority!: string;
  @ApiPropertyOptional({
    enum: ['todo', 'in_progress', 'done'],
    default: 'todo',
  })
  @IsOptional()
  @IsIn(['todo', 'in_progress', 'done'])
  status?: string;
  @ApiProperty({ format: 'date', example: '2026-10-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  startDate!: string;
  @ApiProperty({ format: 'date', example: '2026-12-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  endDate!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() resourceManagerId!: string;
}
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
export class CreateTaskDto {
  @ApiProperty({ example: 'Audit legacy endpoints' })
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name!: string;
  @ApiPropertyOptional({
    example: 'Document endpoint dependencies. Plain text.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsUUID()
  assigneeId?: string | null;
  @ApiProperty({ enum: ['low', 'normal', 'high', 'urgent'], example: 'normal' })
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority!: string;
  @ApiPropertyOptional({
    enum: ['todo', 'in_progress', 'done'],
    default: 'todo',
  })
  @IsOptional()
  @IsIn(['todo', 'in_progress', 'done'])
  status?: string;
  @ApiProperty({ format: 'date', example: '2026-10-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  startDate!: string;
  @ApiProperty({ format: 'date', example: '2026-10-15' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  dueDate!: string;
}
export class UpdateTaskDto extends PartialType(CreateTaskDto) {}
export class TaskNoteDto {
  @ApiProperty({ example: 'Initial audit complete. Plain text.' })
  @Transform(trim)
  @IsString()
  @Length(1, 5000)
  body!: string;
}

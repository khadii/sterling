import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RelatedNameDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Engineering' }) name!: string;
}
export class RelatedPersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'Ada Okafor' })
  displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'ada@example.com' })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!:
    string | null;
}
export class RelatedEmployeeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) roleId!:
    string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Ada Okafor' })
  displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!:
    string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Engineering' })
  departmentName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Engineer' })
  roleName!: string | null;
  @ApiProperty({ type: RelatedPersonDto, nullable: true })
  user!: RelatedPersonDto | null;
  @ApiProperty({ type: RelatedNameDto, nullable: true })
  department!: RelatedNameDto | null;
  @ApiProperty({ type: RelatedNameDto, nullable: true })
  role!: RelatedNameDto | null;
}
/** Additive GET fields; each summary is included when its corresponding ID is present. */
export class ReadRelationsDto {
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  approver?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  user?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedEmployeeDto, nullable: true })
  employee?: RelatedEmployeeDto | null;
  @ApiPropertyOptional({ type: RelatedNameDto, nullable: true })
  department?: RelatedNameDto | null;
  @ApiPropertyOptional({ type: RelatedNameDto, nullable: true })
  role?: RelatedNameDto | null;
  @ApiPropertyOptional({ type: RelatedNameDto, nullable: true })
  team?: RelatedNameDto | null;
  @ApiPropertyOptional({ type: RelatedNameDto, nullable: true })
  project?: RelatedNameDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  buddy?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  reviewer?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  lead?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  reportsTo?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  resourceManager?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  assignee?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  organizer?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  actor?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  creator?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  author?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  decisionMaker?: RelatedPersonDto | null;
  @ApiPropertyOptional({ type: RelatedPersonDto, nullable: true })
  finalizer?: RelatedPersonDto | null;
  @ApiPropertyOptional({
    type: [RelatedPersonDto],
    description: 'Matches approverIds order; unresolved entries are null.',
  })
  approvers?: (RelatedPersonDto | null)[];
}

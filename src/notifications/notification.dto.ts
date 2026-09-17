import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class NotificationPreferencesDto {
  @ApiPropertyOptional({
    enum: ['immediate', 'daily', 'off'],
    default: 'immediate',
  })
  @IsOptional()
  @IsIn(['immediate', 'daily', 'off'])
  activityEmail?: 'immediate' | 'daily' | 'off';
  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsOptional()
  @IsBoolean()
  reminders?: boolean;
}
export class OrganizationInvitationDto {
  @ApiProperty({ example: 'colleague@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiProperty({
    type: [String],
    description:
      'Active custom role IDs. Owner and other system roles cannot be invited.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
export class AcceptInvitationDto {
  @ApiProperty({
    description:
      'Opaque token from the invitation email; use while signed in to the invited verified account.',
  })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;
}
export class DepartmentMembersDto {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'membershipRevision from GET department members',
  })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
  @ApiProperty({
    type: [String],
    description:
      'Complete member list; omitted members are removed. Empty array removes all members. IDs must already belong to this organization.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds!: string[];
}

export class NotificationPreferencesResponseDto {
  @ApiProperty({ enum: ['immediate', 'daily', 'off'], example: 'immediate' })
  activityEmail!: string;
  @ApiProperty({ example: true }) reminders!: boolean;
}
export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'colleague@example.com' }) email!: string;
  @ApiProperty({ enum: ['pending', 'accepted', 'revoked'], example: 'pending' })
  status!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-22T09:00:00Z' })
  expiresAt!: string;
  @ApiPropertyOptional({ enum: ['queued'], example: 'queued' })
  emailStatus?: string;
}
export class InvitationListResponseDto {
  @ApiProperty({ type: [InvitationResponseDto] })
  items!: InvitationResponseDto[];
}
export class InvitationAcceptedResponseDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ example: 'accepted' }) status!: string;
}
export class DepartmentMembersResponseDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) membershipRevision!: number;
  @ApiProperty({ format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: [String] }) memberIds!: string[];
}

export class DepartmentTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() fromDepartmentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() toDepartmentId!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OnboardingResponseDto {
  @ApiProperty({ enum: ['not_started', 'in_progress', 'completed'] })
  status!: string;

  @ApiProperty({ example: 1 })
  currentStep!: number;

  @ApiProperty({ example: 4 })
  totalSteps!: number;

  @ApiProperty({ example: 25 })
  progressPercentage!: number;

  @ApiProperty({
    enum: [
      'welcome',
      'company_setup',
      'departments',
      'workspace_settings',
      'review',
      'dashboard',
    ],
  })
  nextAction!: string;

  @ApiProperty({ type: [Number] })
  completedSteps!: number[];

  @ApiPropertyOptional()
  company?: Record<string, unknown>;

  @ApiPropertyOptional()
  departments?: Record<string, unknown>[];

  @ApiPropertyOptional()
  workspaceSettings?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'uuid' })
  organizationId?: string;
}

export class LogoUploadResponseDto {
  @ApiProperty({ format: 'uuid' }) uploadId!: string;
  @ApiProperty({ format: 'uri' }) uploadUrl!: string;
  @ApiProperty() token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

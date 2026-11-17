import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const AUTOMATION_CATALOG = [
  {
    id: 'email',
    kind: 'email',
    name: 'Email notification',
    description:
      'Queues an email on stage entry. Delivery uses the configured notification worker; email delays are not supported.',
    group: 'communication',
    trigger: 'stage_enter',
    status: 'ready',
    executable: true,
    configFields: [
      {
        key: 'recipient',
        name: 'Recipient',
        type: 'string',
        description:
          'candidate sends to the applicant; hiring_team sends to the job hiring team.',
        required: false,
        options: ['candidate', 'hiring_team'],
        default: 'candidate',
      },
      {
        key: 'subject',
        name: 'Subject',
        type: 'string',
        description: 'Email subject; defaults to an application update.',
        required: false,
        maxLength: 160,
      },
      {
        key: 'body',
        name: 'Body',
        type: 'string',
        description: 'Plain-text email body; defaults to a stage update.',
        required: false,
      },
      {
        key: 'reviewerRole',
        name: 'Reviewer role',
        type: 'string',
        description:
          'When sending to the hiring team, restrict recipients to this role label.',
        required: false,
      },
    ],
    configExample: {
      recipient: 'candidate',
      subject: 'Application received',
      body: 'Thank you for applying.',
    },
  },
  {
    id: 'calendar',
    kind: 'calendar',
    name: 'Create interview event',
    description:
      'Creates an internal company-calendar event and interview record. Does not sync Google/Outlook or provide self-booking.',
    group: 'interview_scheduling',
    trigger: 'stage_enter',
    status: 'ready',
    executable: true,
    configFields: [
      {
        key: 'startsAt',
        name: 'Starts at',
        type: 'datetime',
        description:
          'Absolute ISO 8601 start; otherwise calculate from delayHours.',
        required: false,
      },
      {
        key: 'endsAt',
        name: 'Ends at',
        type: 'datetime',
        description:
          'Absolute ISO 8601 end; otherwise calculate from durationMinutes.',
        required: false,
      },
      {
        key: 'delayHours',
        name: 'Delay hours',
        type: 'integer',
        description: 'Hours after stage entry if startsAt is omitted.',
        required: false,
        minimum: 0,
        maximum: 8760,
        default: 24,
      },
      {
        key: 'durationMinutes',
        name: 'Duration minutes',
        type: 'integer',
        description: 'Interview duration when endsAt is omitted.',
        required: false,
        minimum: 15,
        maximum: 480,
        default: 30,
      },
      {
        key: 'title',
        name: 'Title',
        type: 'string',
        description: 'Event title; defaults to candidate and stage.',
        required: false,
        maxLength: 160,
      },
      {
        key: 'description',
        name: 'Description',
        type: 'string',
        description: 'Event description.',
        required: false,
      },
      {
        key: 'location',
        name: 'Location',
        type: 'string',
        description: 'Physical location.',
        required: false,
        maxLength: 300,
      },
      {
        key: 'meetingUrl',
        name: 'Meeting url',
        type: 'string',
        description: 'Existing meeting link; no link is generated.',
        required: false,
        maxLength: 2048,
      },
      {
        key: 'reviewerRole',
        name: 'Reviewer role',
        type: 'string',
        description:
          'Select hiring-team attendees by role label; defaults to the hiring team, then actor.',
        required: false,
      },
    ],
    configExample: {
      delayHours: 24,
      durationMinutes: 60,
      title: 'Technical interview',
    },
  },
  {
    id: 'reviewer_assignment',
    kind: 'reviewer_assignment',
    name: 'Assign reviewers',
    description:
      'Assigns reviewers who belong to the workspace and sends internal notifications.',
    group: 'reviewers',
    trigger: 'stage_enter',
    status: 'ready',
    executable: true,
    configFields: [
      {
        key: 'reviewerUserIds',
        name: 'Reviewer user ids',
        type: 'uuid_array',
        description:
          'Explicit reviewer user IDs from this workspace. Falls back to hiring team/reporting manager if none are eligible.',
        required: false,
      },
      {
        key: 'reviewerRole',
        name: 'Reviewer role',
        type: 'string',
        description: 'Filter the fallback hiring team by role label.',
        required: false,
      },
      {
        key: 'reason',
        name: 'Reason',
        type: 'string',
        description: 'Assignment reason recorded with each reviewer.',
        required: false,
        default: 'stage_automation',
      },
    ],
    configExample: {
      reviewerRole: 'reviewer',
      reason: 'Technical review',
    },
  },
  {
    id: 'ai_evaluation',
    kind: 'ai_evaluation',
    name: 'AI evaluation (deferred)',
    description:
      'Records a deferred placeholder. No real AI scoring, screening or evaluation is performed.',
    group: 'ai_screening',
    trigger: 'stage_enter',
    status: 'deferred',
    executable: false,
    configFields: [],
    configExample: {},
  },
  {
    id: 'custom',
    kind: 'custom',
    name: 'Custom rule (configuration only)',
    description:
      'Stores configuration; the executor records this rule as skipped. No custom action or external webhook is executed.',
    group: 'custom',
    trigger: 'stage_enter',
    status: 'configuration_only',
    executable: false,
    configFields: [],
    configExample: {},
  },
] as const;

export class AutomationConfigFieldDto {
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['string', 'integer', 'datetime', 'uuid_array'] })
  type!: string;
  @ApiProperty() description!: string;
  @ApiProperty() required!: boolean;
  @ApiPropertyOptional({
    type: Object,
    description: 'Default value where supported; may be a string or number',
  })
  default?: unknown;
  @ApiPropertyOptional({ type: [String] }) options?: string[];
  @ApiPropertyOptional() minimum?: number;
  @ApiPropertyOptional() maximum?: number;
  @ApiPropertyOptional() maxLength?: number;
}
export class AutomationCatalogItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() group!: string;
  @ApiProperty({ example: 'stage_enter' }) trigger!: string;
  @ApiProperty({ enum: ['ready', 'deferred', 'configuration_only'] })
  status!: string;
  @ApiProperty() executable!: boolean;
  @ApiProperty({ type: [AutomationConfigFieldDto] })
  configFields!: AutomationConfigFieldDto[];
  @ApiProperty({ type: Object }) configExample!: Record<string, unknown>;
}
export class AutomationCatalogResponseDto {
  @ApiProperty({ example: 1 }) schemaVersion!: number;
  @ApiProperty({ type: [AutomationCatalogItemDto] })
  items!: AutomationCatalogItemDto[];
  @ApiProperty({ example: 5 }) total!: number;
}

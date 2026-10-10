import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecruitmentSummaryDto {
  @ApiProperty({ example: 12 })
  openJobs!: number;

  @ApiProperty({ example: 2 })
  openJobsChange!: number;

  @ApiProperty({ example: 0 })
  draftJobs!: number;

  @ApiProperty({ example: 0 })
  onHoldJobs!: number;

  @ApiProperty({ example: 0 })
  closedJobs!: number;

  @ApiProperty({ example: 346 })
  totalApplications!: number;

  @ApiProperty({ example: 42 })
  applicationsLast7Days!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 18,
    description: 'Null when the previous period has no applications',
  })
  applicationsChangePercent!: number | null;

  @ApiProperty({ example: 28 })
  candidatesInReview!: number;

  @ApiProperty({ example: 5 })
  offersExtended!: number;

  @ApiProperty({ example: 3 })
  hiredTotal!: number;

  @ApiProperty({ example: 0 })
  rejectedTotal!: number;

  @ApiProperty({ example: 6 })
  interviewsToday!: number;

  @ApiProperty({ example: 16 })
  interviewsThisWeek!: number;

  @ApiProperty({ example: 1 })
  interviewsOverdue!: number;
}

export class ApplicationSourceDto {
  @ApiProperty({ example: 'careers_page' })
  source!: string;

  @ApiProperty({ example: 142 })
  count!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 41 })
  percent!: number | null;
}

export class PipelineCountDto {
  @ApiProperty({ example: 'screening' })
  key!: string;

  @ApiProperty({ example: 28 })
  count!: number;
}

export class InterviewCountsDto {
  @ApiProperty({ example: 6 })
  today!: number;

  @ApiProperty({ example: 16 })
  thisWeek!: number;

  @ApiProperty({ example: 1 })
  overdue!: number;
}

export class RecruitmentActivityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'candidate_added' })
  kind!: string;

  @ApiProperty({ example: 'Sarah Johnson' })
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;
}

export class RecruitmentMetricsDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-09' })
  date!: string;

  @ApiProperty({ example: 'Africa/Lagos' })
  timezone!: string;

  @ApiProperty({ type: RecruitmentSummaryDto })
  summary!: RecruitmentSummaryDto;

  @ApiProperty({ type: [ApplicationSourceDto] })
  applicationsBySource!: ApplicationSourceDto[];

  @ApiProperty({ type: [PipelineCountDto] })
  pipeline!: PipelineCountDto[];

  @ApiProperty({ type: InterviewCountsDto })
  interviews!: InterviewCountsDto;

  @ApiProperty({ type: [RecruitmentActivityDto] })
  recentActivity!: RecruitmentActivityDto[];
}

export class RecruitmentJobListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Senior Product Designer' })
  title!: string;

  @ApiProperty({ example: 'open' })
  status!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'JOB-0012' })
  reference!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Lagos' })
  locationCity!: string | null;

  @ApiProperty({ example: 2 })
  positions!: number;

  @ApiProperty({ example: 32 })
  applicationCount!: number;

  @ApiProperty({ example: 5 })
  newApplicationCount!: number;

  @ApiProperty({ example: 0 })
  hiredCount!: number;

  @ApiProperty({ example: 5 })
  stageCount!: number;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  postedOn!: string | null;
}

export class RecruitmentJobListDto {
  @ApiProperty({ type: [RecruitmentJobListItemDto] })
  items!: RecruitmentJobListItemDto[];

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class RecruitmentJobStatsDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ example: 'open' })
  status!: string;

  @ApiProperty({ example: 2 })
  totalPositions!: number;

  @ApiProperty({ example: 0 })
  filledPositions!: number;

  @ApiProperty({ example: 2 })
  openPositions!: number;

  @ApiProperty({ example: 42 })
  totalApplications!: number;

  @ApiProperty({ example: 28 })
  reviewed!: number;

  @ApiProperty({ example: 8 })
  interviewed!: number;

  @ApiProperty({ example: 6 })
  rejected!: number;

  @ApiProperty({ example: 2 })
  offers!: number;

  @ApiProperty({ type: [ApplicationSourceDto] })
  applicationsBySource!: ApplicationSourceDto[];

  @ApiProperty({ type: [Object] })
  byStage!: Record<string, unknown>[];
}

export class RecruitmentJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Senior Product Designer' })
  title!: string;

  @ApiProperty({ example: 'draft' })
  status!: string;

  @ApiProperty({ example: 0 })
  revision!: number;

  @ApiProperty({ example: 2 })
  positions!: number;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'JOB-0012' })
  reference!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Assigned when the job is published',
  })
  publicSlug!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;
}

export class RecruitmentPipelineStageDto {
  @ApiProperty({ format: 'uuid' })
  stageId!: string;

  @ApiProperty({ example: 'Screening' })
  name!: string;

  @ApiProperty({ example: 0 })
  displayOrder!: number;

  @ApiProperty({ example: 'screening' })
  category!: string;

  @ApiProperty({ example: 12 })
  candidateCount!: number;

  @ApiProperty({ type: [Object] })
  candidates!: Record<string, unknown>[];
}

export class RecruitmentPipelineDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ type: [RecruitmentPipelineStageDto] })
  stages!: RecruitmentPipelineStageDto[];
}

export class RecruitmentJobDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Senior Product Designer' })
  title!: string;

  @ApiProperty({ example: 'draft' })
  status!: string;

  @ApiProperty({ example: 0 })
  revision!: number;

  @ApiProperty({ example: 5 })
  stageCount!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Null while the job has no stages',
  })
  automationPercent!: number | null;

  @ApiProperty({ type: [RecruitmentPipelineStageDto] })
  stages!: RecruitmentPipelineStageDto[];

  @ApiProperty({ type: [Object] })
  responsibilities!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  qualifications!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  skills!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  screeningQuestions!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  benefits!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  channels!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  hiringTeam!: Record<string, unknown>[];
}

export class RecruitmentCandidateDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sarah Johnson' })
  fullName!: string;

  @ApiProperty({ example: 'sarah.johnson@example.com' })
  email!: string;

  @ApiProperty({ example: 'linkedin' })
  source!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 94 })
  matchScore!: number | null;

  @ApiProperty({ example: 'in_review' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  appliedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  lastActivityAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  jobTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  stageName!: string | null;
}

export class RecruitmentCandidateListDto {
  @ApiProperty({ type: [RecruitmentCandidateDto] })
  items!: RecruitmentCandidateDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

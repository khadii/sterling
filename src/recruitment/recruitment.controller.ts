import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import {
  AdvanceCandidateDto,
  CandidateListQueryDto,
  CreateCandidateDto,
  CreateJobDto,
  JobListQueryDto,
  JobMetricsQueryDto,
  JobStatusDto,
  UpdateCandidateDto,
  UpdateJobDto,
} from './recruitment.dto';
import {
  RecruitmentCandidateDto,
  RecruitmentCandidateListDto,
  RecruitmentJobDto,
  RecruitmentJobDetailDto,
  RecruitmentJobListDto,
  RecruitmentJobStatsDto,
  RecruitmentMetricsDto,
  RecruitmentPipelineDto,
} from './recruitment-response.dto';
import { RecruitmentService } from './recruitment.service';

@ApiTags('Employer Jobs')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description:
    'Selects the workspace when the signed-in user belongs to more than one',
})
@UseGuards(SupabaseAuthGuard)
@Controller('employer')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  private orgHeader(req: RequestWithUser): string | undefined {
    const value = req.headers['x-organization-id'];
    return Array.isArray(value) ? value[0] : value;
  }

  private org(req: RequestWithUser) {
    return this.recruitment.organization(req.user.id, this.orgHeader(req));
  }

  @Get('jobs/metrics')
  @ApiOkResponse({ type: RecruitmentMetricsDto })
  @ApiOperation({
    summary:
      'Calculated jobs dashboard, application-source and interview metrics; zero counts are returned as 0 and undefined percentages as null',
  })
  async metrics(@Req() req: RequestWithUser, @Query() q: JobMetricsQueryDto) {
    return this.recruitment.metrics(req.user.id, await this.org(req), q.date);
  }

  @Get('jobs')
  @ApiOkResponse({ type: RecruitmentJobListDto })
  @ApiOperation({
    summary:
      'List jobs with applicant counts. Omit page and limit to return every matching job.',
  })
  async listJobs(@Req() req: RequestWithUser, @Query() q: JobListQueryDto) {
    return this.recruitment.listJobs(req.user.id, await this.org(req), q);
  }

  @Post('jobs')
  @ApiCreatedResponse({ type: RecruitmentJobDto })
  @ApiOperation({
    summary:
      'Create a job draft with the full create-job payload: role, requirements, skills, screening questions, pipeline stages and publishing channels',
  })
  async createJob(@Req() req: RequestWithUser, @Body() dto: CreateJobDto) {
    return this.recruitment.saveJob(
      req.user.id,
      await this.org(req),
      null,
      dto,
    );
  }

  @Get('jobs/:id')
  @ApiOkResponse({ type: RecruitmentJobDetailDto })
  @ApiOperation({
    summary:
      'Job detail with every configured child collection, including revision and computed automation coverage',
  })
  async jobDetail(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recruitment.jobDetail(req.user.id, await this.org(req), id);
  }

  @Patch('jobs/:id')
  @ApiOkResponse({ type: RecruitmentJobDto })
  @ApiOperation({
    summary:
      'Update a job. Closed jobs are read-only; expectedRevision is optional and a stale value returns 409 JOB_REVISION_CONFLICT.',
  })
  async updateJob(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.recruitment.saveJob(req.user.id, await this.org(req), id, dto);
  }

  @Post('jobs/:id/publish')
  @ApiOkResponse({ type: RecruitmentJobDto })
  @ApiOperation({
    summary:
      'Publish a draft job, assign its public slug and open it for applications',
  })
  async publishJob(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recruitment.publishJob(req.user.id, await this.org(req), id);
  }

  @Patch('jobs/:id/status')
  @ApiOkResponse({ type: RecruitmentJobDto })
  @ApiOperation({ summary: 'Put a job on hold, close it or reopen it' })
  async setStatus(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JobStatusDto,
  ) {
    return this.recruitment.setStatus(
      req.user.id,
      await this.org(req),
      id,
      dto.status,
    );
  }

  @Get('jobs/:id/stats')
  @ApiOkResponse({ type: RecruitmentJobStatsDto })
  @ApiOperation({
    summary:
      'Calculated statistics for one job: positions, applications, review funnel and per-stage counts',
  })
  async jobStats(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recruitment.jobStats(req.user.id, await this.org(req), id);
  }

  @Get('jobs/:id/pipeline')
  @ApiOkResponse({ type: RecruitmentPipelineDto })
  @ApiOperation({
    summary: 'Hiring pipeline board: every stage with its candidate cards',
  })
  async pipeline(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CandidateListQueryDto,
  ) {
    return this.recruitment.pipeline(
      req.user.id,
      await this.org(req),
      id,
      q.limit ?? 50,
    );
  }

  @Get('jobs/:id/candidates')
  @ApiOkResponse({ type: RecruitmentCandidateListDto })
  @ApiOperation({
    summary:
      'Applications for one job. Omit page and limit to return every matching candidate.',
  })
  async jobCandidates(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CandidateListQueryDto,
  ) {
    return this.recruitment.listCandidates(req.user.id, await this.org(req), {
      ...q,
      jobId: id,
    });
  }

  @Post('jobs/:id/candidates')
  @ApiCreatedResponse({ type: RecruitmentCandidateDto })
  @ApiOperation({ summary: 'Add a candidate to a job' })
  async createCandidate(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCandidateDto,
  ) {
    return this.recruitment.saveCandidate(
      req.user.id,
      await this.org(req),
      null,
      {
        ...dto,
        jobId: id,
      },
    );
  }

  @Get('candidates')
  @ApiOkResponse({ type: RecruitmentCandidateListDto })
  @ApiOperation({
    summary:
      'List candidates across jobs with their job title and stage. Omit page and limit to return every matching candidate.',
  })
  async listCandidates(
    @Req() req: RequestWithUser,
    @Query() q: CandidateListQueryDto,
  ) {
    return this.recruitment.listCandidates(req.user.id, await this.org(req), q);
  }

  @Patch('candidates/:id')
  @ApiOkResponse({ type: RecruitmentCandidateDto })
  @ApiOperation({
    summary: 'Update a candidate record without moving their stage',
  })
  async updateCandidate(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.recruitment.saveCandidate(
      req.user.id,
      await this.org(req),
      id,
      dto,
    );
  }

  @Post('candidates/:id/advance')
  @ApiOkResponse({ type: RecruitmentCandidateDto })
  @ApiOperation({
    summary:
      'Move a candidate into a pipeline stage; the status follows the stage category unless one is supplied',
  })
  async advanceCandidate(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceCandidateDto,
  ) {
    return this.recruitment.advanceCandidate(
      req.user.id,
      await this.org(req),
      id,
      dto,
    );
  }
}

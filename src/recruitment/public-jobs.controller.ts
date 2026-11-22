import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PublicJobApplicationDto,
  PublicJobApplicationResponseDto,
  PublicJobListDto,
  PublicJobListQueryDto,
} from './public-jobs.dto';
import { RecruitmentService } from './recruitment.service';

@ApiTags('Public Jobs')
@Controller('jobs')
export class PublicJobsController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @ApiOkResponse({ type: PublicJobListDto })
  @ApiOperation({
    summary:
      'List published jobs for the public careers board; no authentication is required. Filter by organization, title, department, work arrangement, employment type, location or posted date range.',
  })
  list(@Query() q: PublicJobListQueryDto) {
    return this.recruitment.publicJobs(q);
  }

  @Post(':id/apply')
  @ApiCreatedResponse({ type: PublicJobApplicationResponseDto })
  @ApiOperation({
    summary:
      'Apply to a published job without signing in; records the application and routes it to the first pipeline stage',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublicJobApplicationDto,
  ) {
    return this.recruitment.publicApply(id, dto);
  }
}

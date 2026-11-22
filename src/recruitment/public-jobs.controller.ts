import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PublicJobListDto, PublicJobListQueryDto } from './public-jobs.dto';
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
}

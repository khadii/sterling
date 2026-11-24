import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UploadedFile as UploadedFileData } from '../common/types/uploaded-file.type';
import {
  PublicJobApplicationDto,
  PublicJobApplicationResponseDto,
  PublicJobListDto,
  PublicJobDetailDto,
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a published, open job by its ID without authentication' })
  @ApiOkResponse({ type: PublicJobDetailDto })
  @ApiNotFoundResponse({ description: 'Job not found or not publicly available' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruitment.publicJobDetail(id);
  }

  @Post(':id/apply')
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: 5_242_880 } }))
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: PublicJobApplicationResponseDto })
  @ApiOperation({
    summary:
      'Apply to a published job without signing in; accepts an optional resume file or a resume URL and routes the application to the first pipeline stage',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublicJobApplicationDto,
    @UploadedFile() resume?: UploadedFileData,
  ) {
    return this.recruitment.publicApply(id, dto, resume);
  }
}

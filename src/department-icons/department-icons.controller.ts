import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { DepartmentIconsService } from './department-icons.service';
import { PlatformIconGuard } from './platform-icon.guard';
import {
  ConfirmIconDto,
  IconQueryDto,
  IconResponseDto,
  IconUploadDto,
  UpdateIconDto,
} from './icon.dto';

@ApiTags('Department Icons')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('reference/department-icons')
export class DepartmentIconReferenceController {
  constructor(private readonly icons: DepartmentIconsService) {}
  @Get()
  @ApiOperation({ summary: 'List active department icons for selection' })
  list(@Query() query: IconQueryDto) {
    return this.icons.list(query);
  }
}

@ApiTags('Platform Administration')
@ApiBearerAuth()
@ApiResponse({ status: 400, type: ApiErrorDto })
@ApiResponse({ status: 401, type: ApiErrorDto })
@ApiResponse({ status: 403, type: ApiErrorDto })
@ApiResponse({ status: 404, type: ApiErrorDto })
@ApiResponse({ status: 409, type: ApiErrorDto })
@UseGuards(SupabaseAuthGuard, PlatformIconGuard)
@Controller('admin/department-icons')
export class DepartmentIconAdminController {
  constructor(private readonly icons: DepartmentIconsService) {}
  @Get()
  @ApiOperation({ summary: 'List all icons, including inactive icons' })
  list(@Query() query: IconQueryDto) {
    return this.icons.list(query, true);
  }
  @Post('upload-url')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Request a signed icon upload (1 MB, maximum 256 × 256, no animation)',
  })
  upload(@Req() request: RequestWithUser, @Body() dto: IconUploadDto) {
    return this.icons.uploadUrl(request.user.id, dto);
  }
  @Post('confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: IconResponseDto })
  @ApiOperation({
    summary: 'Verify and publish an icon; retries return the same icon',
  })
  confirm(@Req() request: RequestWithUser, @Body() dto: ConfirmIconDto) {
    return this.icons.confirm(request.user.id, dto.uploadId);
  }
  @Patch(':id')
  @ApiOkResponse({ type: IconResponseDto })
  @ApiOperation({
    summary: 'Rename, activate or deactivate an icon; references are preserved',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIconDto) {
    return this.icons.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Icon removed from the catalogue' })
  @ApiOperation({
    summary: 'Permanently delete an unused icon and its stored image',
    description:
      'Default icons and icons used by departments, suggestions or drafts return 409. Missing or already deleted icons return 404.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.icons.remove(id);
  }
}

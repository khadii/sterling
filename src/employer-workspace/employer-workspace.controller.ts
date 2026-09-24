import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiHeader,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import {
  ActivityQueryDto,
  CalendarQueryDto,
  CalendarSummaryQueryDto,
  CreateCalendarEventDto,
  CreateDepartmentDto,
  DepartmentQueryDto,
  OrganizationQueryDto,
  UpdateCalendarEventDto,
} from './dto/employer-workspace.dto';
import {
  ActivityListResponseDto,
  CalendarEventListResponseDto,
  CalendarEventResponseDto,
  CalendarSummaryResponseDto,
  DepartmentDetailResponseDto,
  DepartmentListResponseDto,
  DepartmentResponseDto,
  EmployerDashboardResponseDto,
} from './dto/employer-workspace-response.dto';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { EmployerWorkspaceService } from './employer-workspace.service';

@ApiTags('Employer Workspace')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: 'Invalid request', type: ApiErrorDto })
@ApiResponse({
  status: 401,
  description: 'Invalid or missing bearer token',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 403,
  description: 'Organization permission required',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 404,
  description: 'Requested organization resource not found',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 409,
  description: 'Resource already exists',
  type: ApiErrorDto,
})
@UseGuards(SupabaseAuthGuard)
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description:
    'Omit for a single workspace. Select only when you belong to multiple workspaces.',
})
@Controller('employer')
export class EmployerWorkspaceController {
  constructor(private readonly workspace: EmployerWorkspaceService) {}
  private orgHeader(request: RequestWithUser): string | undefined {
    const value = request.headers['x-organization-id'];
    return Array.isArray(value) ? value[0] : value;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get bounded employer dashboard widgets' })
  @ApiOkResponse({ type: EmployerDashboardResponseDto })
  async dashboard(
    @Req() request: RequestWithUser,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.dashboard(
      request.user.id,
      await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    );
  }

  @Get('activities')
  @ApiOperation({
    summary: 'Get the filterable organization activity timeline',
  })
  @ApiOkResponse({ type: ActivityListResponseDto })
  async activities(
    @Req() request: RequestWithUser,
    @Query() query: ActivityQueryDto,
  ) {
    return this.workspace.activities(request.user.id, {
      ...query,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    });
  }

  @Get('calendar/summary')
  @ApiOperation({
    summary: 'Get calendar counters for one organization-local day',
  })
  @ApiOkResponse({ type: CalendarSummaryResponseDto })
  async calendarSummary(
    @Req() request: RequestWithUser,
    @Query() query: CalendarSummaryQueryDto,
  ) {
    return this.workspace.calendarSummary(request.user.id, {
      ...query,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    });
  }

  @Get('calendar/events')
  @ApiOperation({ summary: 'Get calendar events intersecting a date range' })
  @ApiOkResponse({ type: CalendarEventListResponseDto })
  async calendarEvents(
    @Req() request: RequestWithUser,
    @Query() query: CalendarQueryDto,
  ) {
    return this.workspace.calendarEvents(request.user.id, {
      ...query,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    });
  }

  @Post('calendar/events')
  @ApiOperation({ summary: 'Create a manual calendar event' })
  @ApiCreatedResponse({ type: CalendarEventResponseDto })
  async createCalendarEvent(
    @Req() request: RequestWithUser,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.workspace.createCalendarEvent(request.user.id, {
      ...dto,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        dto.organizationId,
      ),
    });
  }

  @Get('calendar/events/:eventId')
  @ApiOperation({ summary: 'Get calendar event details' })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  async calendarEvent(
    @Req() request: RequestWithUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.calendarEvent(
      request.user.id,
      eventId,
      await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    );
  }

  @Patch('calendar/events/:eventId')
  @ApiOperation({ summary: 'Update a manually-created calendar event' })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  async updateCalendarEvent(
    @Req() request: RequestWithUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.workspace.updateCalendarEvent(request.user.id, eventId, {
      ...dto,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        dto.organizationId,
      ),
    });
  }

  @Delete('calendar/events/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a manually-created calendar event' })
  @ApiNoContentResponse({ description: 'Calendar event deleted' })
  async deleteCalendarEvent(
    @Req() request: RequestWithUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: OrganizationQueryDto,
  ): Promise<void> {
    await this.workspace.deleteCalendarEvent(
      request.user.id,
      eventId,
      await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    );
  }

  @Get('departments')
  @ApiOperation({
    summary: 'List organization departments and summary metrics',
  })
  @ApiOkResponse({ type: DepartmentListResponseDto })
  async departments(
    @Req() request: RequestWithUser,
    @Query() query: DepartmentQueryDto,
  ) {
    return this.workspace.departments(request.user.id, {
      ...query,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    });
  }

  @Post('departments')
  @ApiOperation({ summary: 'Create a department in a completed workspace' })
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  async createDepartment(
    @Req() request: RequestWithUser,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.workspace.createDepartment(request.user.id, {
      ...dto,
      organizationId: await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        dto.organizationId,
      ),
    });
  }

  @Get('departments/:departmentId')
  @ApiOperation({ summary: 'Get a department and its available metrics' })
  @ApiOkResponse({ type: DepartmentDetailResponseDto })
  async department(
    @Req() request: RequestWithUser,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.department(
      request.user.id,
      departmentId,
      await this.workspace.resolveOrganization(
        request.user.id,
        this.orgHeader(request),
        query.organizationId,
      ),
    );
  }
}

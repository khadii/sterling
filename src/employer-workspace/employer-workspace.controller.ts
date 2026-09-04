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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { UserRole } from '../common/enums/user-role.enum';
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
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYER)
@Controller('employer')
export class EmployerWorkspaceController {
  constructor(private readonly workspace: EmployerWorkspaceService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get bounded employer dashboard widgets' })
  @ApiOkResponse({ type: EmployerDashboardResponseDto })
  dashboard(
    @Req() request: RequestWithUser,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.dashboard(request.user.id, query.organizationId);
  }

  @Get('activities')
  @ApiOperation({
    summary: 'Get the filterable organization activity timeline',
  })
  @ApiOkResponse({ type: ActivityListResponseDto })
  activities(
    @Req() request: RequestWithUser,
    @Query() query: ActivityQueryDto,
  ) {
    return this.workspace.activities(request.user.id, query);
  }

  @Get('calendar/summary')
  @ApiOperation({
    summary: 'Get calendar counters for one organization-local day',
  })
  @ApiOkResponse({ type: CalendarSummaryResponseDto })
  calendarSummary(
    @Req() request: RequestWithUser,
    @Query() query: CalendarSummaryQueryDto,
  ) {
    return this.workspace.calendarSummary(request.user.id, query);
  }

  @Get('calendar/events')
  @ApiOperation({ summary: 'Get calendar events intersecting a date range' })
  @ApiOkResponse({ type: CalendarEventListResponseDto })
  calendarEvents(
    @Req() request: RequestWithUser,
    @Query() query: CalendarQueryDto,
  ) {
    return this.workspace.calendarEvents(request.user.id, query);
  }

  @Post('calendar/events')
  @ApiOperation({ summary: 'Create a manual calendar event' })
  @ApiCreatedResponse({ type: CalendarEventResponseDto })
  createCalendarEvent(
    @Req() request: RequestWithUser,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.workspace.createCalendarEvent(request.user.id, dto);
  }

  @Get('calendar/events/:eventId')
  @ApiOperation({ summary: 'Get calendar event details' })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  calendarEvent(
    @Req() request: RequestWithUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.calendarEvent(
      request.user.id,
      eventId,
      query.organizationId,
    );
  }

  @Patch('calendar/events/:eventId')
  @ApiOperation({ summary: 'Update a manually-created calendar event' })
  @ApiOkResponse({ type: CalendarEventResponseDto })
  updateCalendarEvent(
    @Req() request: RequestWithUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.workspace.updateCalendarEvent(request.user.id, eventId, dto);
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
      query.organizationId,
    );
  }

  @Get('departments')
  @ApiOperation({
    summary: 'List organization departments and summary metrics',
  })
  @ApiOkResponse({ type: DepartmentListResponseDto })
  departments(
    @Req() request: RequestWithUser,
    @Query() query: DepartmentQueryDto,
  ) {
    return this.workspace.departments(request.user.id, query);
  }

  @Post('departments')
  @ApiOperation({ summary: 'Create a department in a completed workspace' })
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  createDepartment(
    @Req() request: RequestWithUser,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.workspace.createDepartment(request.user.id, dto);
  }

  @Get('departments/:departmentId')
  @ApiOperation({ summary: 'Get a department and its available metrics' })
  @ApiOkResponse({ type: DepartmentDetailResponseDto })
  department(
    @Req() request: RequestWithUser,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
    @Query() query: OrganizationQueryDto,
  ) {
    return this.workspace.department(
      request.user.id,
      departmentId,
      query.organizationId,
    );
  }
}

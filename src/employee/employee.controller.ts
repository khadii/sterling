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
  EmployeeClockDto,
  EmployeeCourseProgressDto,
  EmployeeLeaveRequestDto,
  EmployeeRangeQueryDto,
  EmployeeTaskStatusDto,
} from './employee.dto';
import {
  EmployeeAnnouncementsDto,
  EmployeeAttendanceDto,
  EmployeeCalendarDto,
  EmployeeDashboardDto,
  EmployeeDocumentsDto,
  EmployeeLearningDto,
  EmployeeLeaveDetailDto,
  EmployeeLeaveDto,
  EmployeePayslipsDto,
  EmployeeProfileDto,
  EmployeeTasksDto,
  EmployeeTeamDto,
} from './employee-response.dto';
import { EmployeeService } from './employee.service';

@ApiTags('Employee Self-Service')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description:
    'Selects the workspace when the signed-in employee belongs to more than one',
})
@UseGuards(SupabaseAuthGuard)
@Controller('employee')
export class EmployeeController {
  constructor(private readonly employee: EmployeeService) {}

  private orgHeader(req: RequestWithUser): string | undefined {
    const value = req.headers['x-organization-id'];
    return Array.isArray(value) ? value[0] : value;
  }

  private org(req: RequestWithUser) {
    return this.employee.organization(req.user.id, this.orgHeader(req));
  }

  @Get('profile')
  @ApiOkResponse({ type: EmployeeProfileDto })
  @ApiOperation({
    summary: 'Get the signed-in employee profile and employment summary',
  })
  async profile(@Req() req: RequestWithUser) {
    return this.employee.profile(req.user.id, await this.org(req));
  }

  @Get('dashboard')
  @ApiOkResponse({ type: EmployeeDashboardDto })
  @ApiOperation({
    summary:
      'Get the employee dashboard: announcements, clock state, agenda, leave, tasks, learning, review and team',
  })
  async dashboard(@Req() req: RequestWithUser) {
    return this.employee.dashboard(req.user.id, await this.org(req));
  }

  @Get('leave')
  @ApiOkResponse({ type: EmployeeLeaveDto })
  @ApiOperation({
    summary:
      'Get the signed-in employee entitlements, upcoming leave, history and summary',
  })
  async leave(@Req() req: RequestWithUser) {
    return this.employee.leave(req.user.id, await this.org(req));
  }

  @Post('leave')
  @ApiCreatedResponse({ type: EmployeeLeaveDetailDto })
  @ApiOperation({
    summary:
      'Submit a leave request for the signed-in employee; the request starts pending and notifies the approval chain',
  })
  async requestLeave(
    @Req() req: RequestWithUser,
    @Body() dto: EmployeeLeaveRequestDto,
  ) {
    return this.employee.requestLeave(req.user.id, await this.org(req), dto);
  }

  @Get('leave/:id')
  @ApiOkResponse({ type: EmployeeLeaveDetailDto })
  @ApiOperation({
    summary:
      'Get one of the signed-in employee leave requests with its timeline',
  })
  async leaveDetail(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employee.leaveDetail(req.user.id, await this.org(req), id);
  }

  @Post('leave/:id/cancel')
  @ApiOkResponse({ type: EmployeeLeaveDetailDto })
  @ApiOperation({
    summary: 'Withdraw a pending leave request owned by the signed-in employee',
  })
  async cancelLeave(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.employee.cancelLeave(req.user.id, await this.org(req), id);
  }

  @Get('attendance')
  @ApiOkResponse({ type: EmployeeAttendanceDto })
  @ApiOperation({
    summary: 'Get the signed-in employee clock sessions and attendance records',
  })
  async attendance(
    @Req() req: RequestWithUser,
    @Query() query: EmployeeRangeQueryDto,
  ) {
    return this.employee.attendance(req.user.id, await this.org(req), query);
  }

  @Post('attendance/clock')
  @ApiOkResponse({ type: EmployeeAttendanceDto })
  @ApiOperation({
    summary: 'Clock the signed-in employee in, out, or on and off a break',
  })
  async clock(@Req() req: RequestWithUser, @Body() dto: EmployeeClockDto) {
    return this.employee.clock(req.user.id, await this.org(req), dto);
  }

  @Get('tasks')
  @ApiOkResponse({ type: EmployeeTasksDto })
  @ApiOperation({ summary: 'List tasks assigned to the signed-in employee' })
  async tasks(@Req() req: RequestWithUser) {
    return this.employee.tasks(req.user.id, await this.org(req));
  }

  @Patch('tasks/:id')
  @ApiOkResponse({ type: EmployeeTasksDto })
  @ApiOperation({ summary: 'Update the status of an assigned task' })
  async updateTask(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmployeeTaskStatusDto,
  ) {
    return this.employee.updateTask(req.user.id, await this.org(req), id, dto);
  }

  @Get('team')
  @ApiOkResponse({ type: EmployeeTeamDto })
  @ApiOperation({
    summary: 'List the signed-in employee department and team colleagues',
  })
  async team(@Req() req: RequestWithUser) {
    return this.employee.team(req.user.id, await this.org(req));
  }

  @Get('documents')
  @ApiOkResponse({ type: EmployeeDocumentsDto })
  @ApiOperation({ summary: 'List documents held for the signed-in employee' })
  async documents(@Req() req: RequestWithUser) {
    return this.employee.documents(req.user.id, await this.org(req));
  }

  @Get('payslips')
  @ApiOkResponse({ type: EmployeePayslipsDto })
  @ApiOperation({
    summary: 'List finalized payslips for the signed-in employee',
  })
  async payslips(@Req() req: RequestWithUser) {
    return this.employee.payslips(req.user.id, await this.org(req));
  }

  @Get('announcements')
  @ApiOkResponse({ type: EmployeeAnnouncementsDto })
  @ApiOperation({ summary: 'List published company announcements' })
  async announcements(@Req() req: RequestWithUser) {
    return this.employee.announcements(req.user.id, await this.org(req));
  }

  @Get('learning')
  @ApiOkResponse({ type: EmployeeLearningDto })
  @ApiOperation({
    summary: 'List courses with the signed-in employee progress',
  })
  async learning(@Req() req: RequestWithUser) {
    return this.employee.learning(req.user.id, await this.org(req));
  }

  @Patch('learning/:courseId')
  @ApiOkResponse({ type: EmployeeLearningDto })
  @ApiOperation({ summary: 'Update progress on a course' })
  async updateCourseProgress(
    @Req() req: RequestWithUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: EmployeeCourseProgressDto,
  ) {
    return this.employee.updateCourseProgress(
      req.user.id,
      await this.org(req),
      courseId,
      dto,
    );
  }

  @Get('calendar')
  @ApiOkResponse({ type: EmployeeCalendarDto })
  @ApiOperation({
    summary: 'List calendar events where the signed-in employee is involved',
  })
  async calendar(
    @Req() req: RequestWithUser,
    @Query() query: EmployeeRangeQueryDto,
  ) {
    return this.employee.calendar(req.user.id, await this.org(req), query);
  }
}

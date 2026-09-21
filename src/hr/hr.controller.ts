import {
  UpdateOnboardingDto,
  UpdateLeaveDto,
  UpdateAttendanceDto,
  UpdateReviewDto,
  UpdateExpenseDto,
  UpdateDocumentDto,
  UpdateInterviewDto,
  UpdateRequisitionDto,
  UpdateDepartmentPlanningDto,
  UpdateTeamPlanningDto,
  UpdateLeaveEntitlementDto,
  UpdatePayrollDto,
  UpdatePayrollLineDto,
} from './hr.dto';
import {
  HrMetricsDto,
  HrRoleStatsDto,
  HrEmployeeStatsDto,
  HrPayrollStatsDto,
} from './hr-response.dto';
import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiCreatedResponse,
  getSchemaPath,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { ZoomService } from './zoom.service';
import { HrService } from './hr.service';
import {
  ApprovalChainDto,
  BulkIdsDto,
  EmployeeDto,
  OnboardingDto,
  LeaveDto,
  AttendanceDto,
  ReviewDto,
  ExpenseDto,
  DocumentDto,
  InterviewDto,
  RequisitionDto,
  DepartmentPlanningDto,
  TeamPlanningDto,
  LeaveEntitlementDto,
  PayrollDto,
  PayrollLineDto,
  MessageDto,
  HrQueryDto,
  UpdateEmployeeDto,
  BulkDecisionDto,
  RsvpDto,
} from './hr.dto';
@ApiExtraModels(
  EmployeeDto,
  OnboardingDto,
  LeaveDto,
  AttendanceDto,
  ReviewDto,
  ExpenseDto,
  DocumentDto,
  InterviewDto,
  RequisitionDto,
  DepartmentPlanningDto,
  TeamPlanningDto,
  LeaveEntitlementDto,
  PayrollDto,
  PayrollLineDto,
  MessageDto,
)
@ApiTags('Employer HR Operations')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description: 'Only needed for multiple workspace memberships',
})
@UseGuards(SupabaseAuthGuard)
@Controller('employer/hr')
export class HrController {
  constructor(
    private readonly hr: HrService,
    private readonly zoom: ZoomService,
  ) {}
  @Get('metrics')
  @ApiOkResponse({ type: HrMetricsDto })
  @ApiOperation({
    summary:
      'Calculated dashboard, department and subteam metrics; zero counts are returned as 0',
  })
  async metrics(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.metrics(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      q.date,
    );
  }
  @Get('employees')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(EmployeeDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List employees records' })
  async list_employees(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'employees',
      q,
    );
  }
  @Post('employees')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(EmployeeDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create employees record' })
  async create_employees(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: EmployeeDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'employees',
      null,
      dto,
    );
  }
  @Patch('employees/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(EmployeeDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update employees; approved or finalized records are immutable',
  })
  async update_employees(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'employees',
      id,
      dto,
    );
  }
  @Get('onboarding')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(OnboardingDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List onboarding records' })
  async list_onboarding(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'onboarding',
      q,
    );
  }
  @Post('onboarding/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(OnboardingDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create onboarding record' })
  async create_onboarding(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: OnboardingDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'onboarding',
      null,
      { ...dto, employeeId: parentId },
    );
  }
  @Patch('onboarding/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(OnboardingDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update onboarding; approved or finalized records are immutable',
  })
  async update_onboarding(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'onboarding',
      id,
      dto,
    );
  }
  @Get('leave')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(LeaveDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List leave records' })
  async list_leave(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'leave',
      q,
    );
  }
  @Post('leave')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(LeaveDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create leave record' })
  async create_leave(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: LeaveDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'leave',
      null,
      dto,
    );
  }
  @Patch('leave/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(LeaveDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update leave; approved or finalized records are immutable',
  })
  async update_leave(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'leave',
      id,
      dto,
    );
  }
  @Post('leave/decisions')
  @ApiOperation({
    summary: 'Atomically approve or decline a batch; own approvals prohibited',
  })
  async decide_leave(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: BulkDecisionDto,
  ) {
    return this.hr.decide(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'leave',
      dto.ids,
      dto,
    );
  }
  @Get('attendance')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(AttendanceDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List attendance records' })
  async list_attendance(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'attendance',
      q,
    );
  }
  @Post('attendance')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(AttendanceDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create attendance record' })
  async create_attendance(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: AttendanceDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'attendance',
      null,
      dto,
    );
  }
  @Patch('attendance/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(AttendanceDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update attendance; approved or finalized records are immutable',
  })
  async update_attendance(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'attendance',
      id,
      dto,
    );
  }
  @Post('attendance/decisions')
  @ApiOperation({
    summary: 'Atomically approve or decline a batch; own approvals prohibited',
  })
  async decide_attendance(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: BulkDecisionDto,
  ) {
    return this.hr.decide(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'attendance',
      dto.ids,
      dto,
    );
  }
  @Get('reviews')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(ReviewDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List reviews records' })
  async list_reviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'reviews',
      q,
    );
  }
  @Post('reviews')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(ReviewDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create reviews record' })
  async create_reviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: ReviewDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'reviews',
      null,
      dto,
    );
  }
  @Patch('reviews/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(ReviewDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update reviews; approved or finalized records are immutable',
  })
  async update_reviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'reviews',
      id,
      dto,
    );
  }
  @Post('reviews/decisions')
  @ApiOperation({
    summary: 'Atomically approve or decline a batch; own approvals prohibited',
  })
  async decide_reviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: BulkDecisionDto,
  ) {
    return this.hr.decide(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'reviews',
      dto.ids,
      dto,
    );
  }
  @Get('expenses')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(ExpenseDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List expenses records' })
  async list_expenses(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'expenses',
      q,
    );
  }
  @Post('expenses')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(ExpenseDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create expenses record' })
  async create_expenses(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: ExpenseDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'expenses',
      null,
      dto,
    );
  }
  @Patch('expenses/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(ExpenseDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update expenses; approved or finalized records are immutable',
  })
  async update_expenses(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'expenses',
      id,
      dto,
    );
  }
  @Post('expenses/decisions')
  @ApiOperation({
    summary: 'Atomically approve or decline a batch; own approvals prohibited',
  })
  async decide_expenses(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: BulkDecisionDto,
  ) {
    return this.hr.decide(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'expenses',
      dto.ids,
      dto,
    );
  }
  @Get('documents')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(DocumentDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List documents records' })
  async list_documents(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'documents',
      q,
    );
  }
  @Post('documents')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(DocumentDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create documents record' })
  async create_documents(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: DocumentDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'documents',
      null,
      dto,
    );
  }
  @Patch('documents/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(DocumentDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update documents; approved or finalized records are immutable',
  })
  async update_documents(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'documents',
      id,
      dto,
    );
  }
  @Get('interviews')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(InterviewDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List interviews records' })
  async list_interviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'interviews',
      q,
    );
  }
  @Post('interviews')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(InterviewDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create interviews record' })
  async create_interviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: InterviewDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'interviews',
      null,
      dto,
    );
  }
  @Patch('interviews/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(InterviewDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update interviews; approved or finalized records are immutable',
  })
  async update_interviews(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'interviews',
      id,
      dto,
    );
  }
  @Get('requisitions')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(RequisitionDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List requisitions records' })
  async list_requisitions(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'requisitions',
      q,
    );
  }
  @Post('requisitions')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(RequisitionDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create requisitions record' })
  async create_requisitions(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: RequisitionDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'requisitions',
      null,
      dto,
    );
  }
  @Patch('requisitions/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(RequisitionDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update requisitions; approved or finalized records are immutable',
  })
  async update_requisitions(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequisitionDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'requisitions',
      id,
      dto,
    );
  }
  @Get('department-plans')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(DepartmentPlanningDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List department-plans records' })
  async list_department_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'department-plans',
      q,
    );
  }
  @Post('department-plans/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(DepartmentPlanningDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create department-plans record' })
  async create_department_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: DepartmentPlanningDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'department-plans',
      null,
      { ...dto, departmentId: parentId },
    );
  }
  @Patch('department-plans/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(DepartmentPlanningDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary:
      'Update department-plans; approved or finalized records are immutable',
  })
  async update_department_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentPlanningDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'department-plans',
      id,
      dto,
    );
  }
  @Get('team-plans')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(TeamPlanningDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List team-plans records' })
  async list_team_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'team-plans',
      q,
    );
  }
  @Post('team-plans/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(TeamPlanningDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create team-plans record' })
  async create_team_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: TeamPlanningDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'team-plans',
      null,
      { ...dto, teamId: parentId },
    );
  }
  @Patch('team-plans/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(TeamPlanningDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update team-plans; approved or finalized records are immutable',
  })
  async update_team_plans(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamPlanningDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'team-plans',
      id,
      dto,
    );
  }
  @Get('entitlements')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(LeaveEntitlementDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List entitlements records' })
  async list_entitlements(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'entitlements',
      q,
    );
  }
  @Post('entitlements/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(LeaveEntitlementDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create entitlements record' })
  async create_entitlements(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: LeaveEntitlementDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'entitlements',
      null,
      { ...dto, employeeId: parentId },
    );
  }
  @Patch('entitlements/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(LeaveEntitlementDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update entitlements; approved or finalized records are immutable',
  })
  async update_entitlements(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveEntitlementDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'entitlements',
      id,
      dto,
    );
  }
  @Get('payroll')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(PayrollDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List payroll records' })
  async list_payroll(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll',
      q,
    );
  }
  @Post('payroll')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PayrollDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create payroll record' })
  async create_payroll(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: PayrollDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll',
      null,
      dto,
    );
  }
  @Patch('payroll/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PayrollDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Update payroll; approved or finalized records are immutable',
  })
  async update_payroll(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll',
      id,
      dto,
    );
  }
  @Get('payroll-lines')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(PayrollLineDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List payroll-lines records' })
  async list_payroll_lines(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll-lines',
      q,
    );
  }
  @Post('payroll-lines/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PayrollLineDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create payroll-lines record' })
  async create_payroll_lines(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: PayrollLineDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll-lines',
      null,
      { ...dto, payrollId: parentId },
    );
  }
  @Patch('payroll-lines/:id')
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PayrollLineDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({
    summary:
      'Update payroll-lines; approved or finalized records are immutable',
  })
  async update_payroll_lines(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollLineDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll-lines',
      id,
      dto,
    );
  }
  @Get('celebrations')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            allOf: [
              { $ref: getSchemaPath(MessageDto) },
              {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  organizationId: { type: 'string', format: 'uuid' },
                  employeeId: { type: 'string', format: 'uuid' },
                  status: { type: 'string' },
                },
              },
            ],
          },
        },
        total: { type: 'integer', example: 0 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 50 },
      },
    },
  })
  @ApiOperation({ summary: 'List celebrations records' })
  async list_celebrations(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.list(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'celebrations',
      q,
    );
  }
  @Post('celebrations/:parentId')
  @ApiCreatedResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(MessageDto) },
        {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
          },
        },
      ],
    },
  })
  @ApiOperation({ summary: 'Create celebrations record' })
  async create_celebrations(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('parentId', ParseUUIDPipe) parentId: string,
    @Body() dto: MessageDto,
  ) {
    return this.hr.mutate(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'celebrations',
      null,
      { ...dto, employeeId: parentId },
    );
  }
  @Get('employees/:id')
  @ApiOkResponse({ type: HrEmployeeStatsDto })
  @ApiOperation({ summary: 'Get employees details and calculated statistics' })
  async detail_employees(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.employee(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      id,
      q.date,
    );
  }
  @Get('roles/:id')
  @ApiOkResponse({ type: HrRoleStatsDto })
  @ApiOperation({ summary: 'Get roles details and calculated statistics' })
  async detail_roles(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.role(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      id,
      q.date,
    );
  }
  @Get('payroll/:id')
  @ApiOkResponse({ type: HrPayrollStatsDto })
  @ApiOperation({ summary: 'Get payroll details and calculated statistics' })
  async detail_payroll(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.payroll(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      id,
    );
  }
  @Post('documents/:id/request-update')
  @ApiOperation({ summary: 'request-update documents' })
  async documents_request_update(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.action(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'documents',
      id,
      'request-update',
    );
  }
  @Post('documents/:id/dismiss')
  @ApiOperation({ summary: 'dismiss documents' })
  async documents_dismiss(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.action(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'documents',
      id,
      'dismiss',
    );
  }
  @Post('payroll/:id/finalize')
  @ApiOperation({ summary: 'finalize payroll' })
  async payroll_finalize(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.action(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'payroll',
      id,
      'finalize',
    );
  }
  @Post('requisitions/:id/close')
  @ApiOperation({ summary: 'close requisitions' })
  async requisitions_close(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.action(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'requisitions',
      id,
      'close',
    );
  }
  @Post('calendar/:id/rsvp')
  @ApiOperation({
    summary:
      'Respond as the signed-in attendee; cannot change another attendee response',
  })
  async rsvp(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RsvpDto,
  ) {
    return this.hr.action(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      'calendar',
      id,
      'rsvp',
      dto,
    );
  }
  @Get('records/:kind/:id')
  @ApiOperation({
    summary:
      'Get a permission-checked HR source record for an activity detail modal',
  })
  async record(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.detail(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      kind,
      id,
    );
  }
  @Post('roles/:id/duplicate')
  @ApiOperation({
    summary: 'Duplicate a role as a draft without copying assignments',
  })
  async duplicateRole(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.rpc('hr_duplicate_role', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_role: id,
    });
  }
  @Get('departments/:id/chart')
  @ApiOperation({
    summary: 'Employee reporting relationships for a department chart',
  })
  async chart(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.rpc('hr_department_chart', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_department: id,
    });
  }

  @Post('approval-chains')
  @ApiOperation({
    summary: 'Configure ordered approvers for future HR requests',
  })
  async chain(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: ApprovalChainDto,
  ) {
    return this.hr.rpc('hr_set_approval_chain', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_kind: dto.kind,
      p_approvers: dto.approverIds,
    });
  }
  @Post('documents/request-updates')
  @ApiOperation({
    summary: 'Atomically request updates for selected documents',
  })
  async bulkDocuments(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Body() dto: BulkIdsDto,
  ) {
    return this.hr.rpc('hr_document_updates', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_ids: dto.ids,
    });
  }
  @Get('activities/:id')
  @ApiOperation({
    summary: 'Activity detail with permitted actions and approval progress',
  })
  async activity(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.rpc('hr_activity_detail', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_id: id,
    });
  }
  @Get('trends')
  @ApiOperation({
    summary: 'Six months of headcount and seven days of approved attendance',
  })
  async trends(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Query() q: HrQueryDto,
  ) {
    return this.hr.rpc('hr_trends', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_date: q.date ?? null,
    });
  }
  @Get('approval-chains')
  @ApiOperation({ summary: 'Configured approver chains' })
  async chains(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
  ) {
    return this.hr.chains(
      req.user.id,
      await this.hr.organization(req.user.id, h),
    );
  }
  @Post('calendar/:id/zoom')
  @ApiOperation({
    summary:
      'Create and attach a Zoom meeting using this workspace’s configured account',
  })
  async zoomMeeting(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.zoom.create(
      req.user.id,
      await this.hr.organization(req.user.id, h),
      id,
    );
  }
  @Post('requests/:kind/:id/resubmit')
  @ApiOperation({
    summary:
      'Reopen a declined HR request with the current approval chain; then PATCH corrections before approval',
  })
  async resubmit(
    @Req() req: RequestWithUser,
    @Headers('x-organization-id') h: string | undefined,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.hr.rpc('hr_resubmit', {
      p_actor: req.user.id,
      p_org: await this.hr.organization(req.user.id, h),
      p_kind: kind,
      p_id: id,
    });
  }
}

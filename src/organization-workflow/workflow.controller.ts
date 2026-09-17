import {
  WorkflowRoleResponseDto,
  WorkflowTeamResponseDto,
  WorkflowProjectResponseDto,
  WorkflowTaskResponseDto,
} from './workflow-response.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile as Upload } from '../common/types/uploaded-file.type';
import { TaskAttachmentsService } from './task-attachments.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { WorkflowService } from './workflow.service';
import { EmployerWorkspaceService } from '../employer-workspace/employer-workspace.service';
import { WorkflowDepartmentDto } from './workflow.dto';
import {
  AssignRolesDto,
  CreateProjectDto,
  CreateRoleDto,
  CreateTaskDto,
  CreateTeamDto,
  MembersDto,
  PermissionsDto,
  TaskNoteDto,
  UpdateProjectDto,
  UpdateRoleDto,
  UpdateTaskDto,
  UpdateTeamDto,
  WorkflowQueryDto,
} from './workflow.dto';

@ApiExtraModels(
  WorkflowRoleResponseDto,
  WorkflowTeamResponseDto,
  WorkflowProjectResponseDto,
  WorkflowTaskResponseDto,
)
@ApiTags('Organization Roles & Work Structure')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description:
    'Only needed when the account belongs to multiple workspaces. Never grants access by itself.',
})
@UseGuards(SupabaseAuthGuard)
@Controller('organization')
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly workspace: EmployerWorkspaceService,
    private readonly attachments: TaskAttachmentsService,
  ) {}
  private org(req: RequestWithUser, query: WorkflowQueryDto, header?: string) {
    return this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
  }

  @Post('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'Upload an actual PDF or CSV file (maximum 5 MiB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  async uploadAttachment(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.attachments.upload(
      r.user.id,
      await this.org(r, q, h),
      id,
      file,
    );
  }
  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'List task attachments' })
  async taskAttachments(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.attachments.list(r.user.id, await this.org(r, q, h), id);
  }
  @Get('tasks/:taskId/attachments/:attachmentId/download')
  @ApiOperation({
    summary: 'Get an authorized download URL valid for five minutes',
  })
  async downloadAttachment(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachment: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.attachments.download(
      r.user.id,
      await this.org(r, q, h),
      id,
      attachment,
    );
  }
  @Delete('tasks/:taskId/attachments/:attachmentId')
  @ApiOperation({
    summary: 'Remove a task attachment before deleting its metadata',
  })
  async removeAttachment(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachment: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.attachments.remove(
      r.user.id,
      await this.org(r, q, h),
      id,
      attachment,
    );
  }

  @Post('departments')
  @ApiOperation({ summary: 'Create a department in the resolved workspace' })
  async createDepartment(
    @Req() r: RequestWithUser,
    @Body() b: WorkflowDepartmentDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workspace.createDepartment(r.user.id, {
      ...b,
      organizationId: await this.org(r, q, h),
    });
  }
  @Get('departments')
  @ApiOperation({ summary: 'List departments in the resolved workspace' })
  async departments(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workspace.departments(r.user.id, {
      organizationId: await this.org(r, q, h),
      search: q.search,
      includeArchived: false,
    });
  }
  @Get('departments/:departmentId')
  @ApiOperation({ summary: 'Get department details' })
  async department(
    @Req() r: RequestWithUser,
    @Param('departmentId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workspace.department(r.user.id, id, await this.org(r, q, h));
  }

  @Get('permissions')
  @ApiOperation({ summary: 'Get the permission catalogue for role checkboxes' })
  async permissions(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.permissions(r.user.id, await this.org(r, q, h));
  }
  @Get('members')
  @ApiOperation({
    summary: 'Member picker with email, display name and avatar',
  })
  async members(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.members(r.user.id, await this.org(r, q, h), q);
  }
  @Get('roles')
  @ApiOperation({
    summary:
      'List roles, including drafts, requirements, benefits and permissions',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(WorkflowRoleResponseDto) },
        },
        total: { type: 'integer', example: 1 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
      },
    },
  })
  async roles(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.list(r.user.id, await this.org(r, q, h), 'roles', q);
  }
  @Get('roles/:roleId')
  @ApiOperation({ summary: 'Resume a saved role wizard or view a role' })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async role(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.detail(
      r.user.id,
      await this.org(r, q, h),
      'roles',
      id,
    );
  }
  @Post('roles')
  @ApiOperation({
    summary:
      'Create a role draft or an active role; ID and key are generated by the backend',
  })
  @ApiCreatedResponse({ type: WorkflowRoleResponseDto })
  async createRole(
    @Req() r: RequestWithUser,
    @Body() b: CreateRoleDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'role.save',
      null,
      b,
    );
  }
  @Patch('roles/:roleId')
  @ApiOperation({
    summary: 'Save wizard sections or activate a complete role',
    description:
      'Omitted fields are preserved. Supplied requirements/benefits objects replace that section. Drafts cannot be assigned.',
  })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async updateRole(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Body() b: UpdateRoleDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'role.save',
      id,
      b,
    );
  }
  @Put('roles/:roleId/permissions')
  @ApiOperation({ summary: 'Atomically replace the explicit permission set' })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async rolePermissions(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Body() b: PermissionsDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'role.permissions',
      id,
      b,
    );
  }
  @Post('members/:userId/roles')
  @ApiOperation({
    summary: 'Add active roles to an existing organization member',
  })
  async assign(
    @Req() r: RequestWithUser,
    @Param('userId', ParseUUIDPipe) id: string,
    @Body() b: AssignRolesDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'member.assign',
      id,
      b,
    );
  }
  @Delete('members/:userId/roles/:roleId')
  @ApiOperation({
    summary: 'Remove a role assignment; owner changes use ownership transfer',
  })
  async unassign(
    @Req() r: RequestWithUser,
    @Param('userId', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'member.unassign',
      id,
      { roleIds: [roleId] },
    );
  }

  @Get('teams')
  @ApiOperation({ summary: 'List sub-teams; filter by departmentId' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(WorkflowTeamResponseDto) },
        },
        total: { type: 'integer', example: 1 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
      },
    },
  })
  async teams(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.list(r.user.id, await this.org(r, q, h), 'teams', q);
  }
  @Get('teams/:teamId')
  @ApiOperation({ summary: 'Get a sub-team' })
  @ApiOkResponse({ type: WorkflowTeamResponseDto })
  async team(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.detail(
      r.user.id,
      await this.org(r, q, h),
      'teams',
      id,
    );
  }
  @Post('teams')
  @ApiOperation({
    summary: 'Create a sub-team and its initial members in one transaction',
  })
  @ApiCreatedResponse({ type: WorkflowTeamResponseDto })
  async createTeam(
    @Req() r: RequestWithUser,
    @Body() b: CreateTeamDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'team.save',
      null,
      b,
    );
  }
  @Patch('teams/:teamId')
  @ApiOperation({ summary: 'Update a sub-team' })
  @ApiOkResponse({ type: WorkflowTeamResponseDto })
  async updateTeam(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Body() b: UpdateTeamDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'team.save',
      id,
      b,
    );
  }
  @Get('teams/:teamId/members')
  @ApiOperation({ summary: 'View all team members' })
  async teamMembers(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.members(r.user.id, await this.org(r, q, h), q, id);
  }
  @Put('teams/:teamId/members')
  @ApiOperation({ summary: 'Replace team membership atomically' })
  @ApiOkResponse({ type: WorkflowTeamResponseDto })
  async replaceMembers(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Body() b: MembersDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'team.members',
      id,
      b,
    );
  }

  @Get('projects')
  @ApiOperation({ summary: 'List projects; filter by departmentId or teamId' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(WorkflowProjectResponseDto) },
        },
        total: { type: 'integer', example: 1 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
      },
    },
  })
  async projects(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.list(
      r.user.id,
      await this.org(r, q, h),
      'projects',
      q,
    );
  }
  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Project details and progress from all its tasks' })
  @ApiOkResponse({ type: WorkflowProjectResponseDto })
  async project(
    @Req() r: RequestWithUser,
    @Param('projectId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.detail(
      r.user.id,
      await this.org(r, q, h),
      'projects',
      id,
    );
  }
  @Post('projects')
  @ApiOperation({
    summary:
      'Create a project linked to a department, team and resource manager',
  })
  @ApiCreatedResponse({ type: WorkflowProjectResponseDto })
  async createProject(
    @Req() r: RequestWithUser,
    @Body() b: CreateProjectDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'project.save',
      null,
      b,
    );
  }
  @Patch('projects/:projectId')
  @ApiOperation({ summary: 'Edit project details' })
  @ApiOkResponse({ type: WorkflowProjectResponseDto })
  async updateProject(
    @Req() r: RequestWithUser,
    @Param('projectId', ParseUUIDPipe) id: string,
    @Body() b: UpdateProjectDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'project.save',
      id,
      b,
    );
  }
  @Post('projects/:projectId/tasks')
  @ApiOperation({ summary: 'Create a task within the selected project' })
  @ApiCreatedResponse({ type: WorkflowTaskResponseDto })
  async createTask(
    @Req() r: RequestWithUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() b: CreateTaskDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'task.save',
      null,
      { ...b, projectId },
    );
  }
  @Get('tasks')
  @ApiOperation({ summary: 'List tasks; filter by projectId' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(WorkflowTaskResponseDto) },
        },
        total: { type: 'integer', example: 1 },
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
      },
    },
  })
  async tasks(
    @Req() r: RequestWithUser,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.list(r.user.id, await this.org(r, q, h), 'tasks', q);
  }
  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'View task details' })
  @ApiOkResponse({ type: WorkflowTaskResponseDto })
  async task(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.detail(
      r.user.id,
      await this.org(r, q, h),
      'tasks',
      id,
    );
  }
  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'Edit, assign, or complete a task (status: done)' })
  @ApiOkResponse({ type: WorkflowTaskResponseDto })
  async updateTask(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Body() b: UpdateTaskDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'task.save',
      id,
      b,
    );
  }
  @Delete('tasks/:taskId')
  @ApiOperation({ summary: 'Permanently delete a task and its notes/history' })
  async deleteTask(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.attachments.deleteTask(r.user.id, await this.org(r, q, h), id);
  }
  @Post('tasks/:taskId/notes')
  @ApiOperation({ summary: 'Add a plain-text note' })
  async note(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Body() b: TaskNoteDto,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q, h),
      'task.note',
      id,
      b,
    );
  }
  @Get('tasks/:taskId/notes')
  @ApiOperation({ summary: 'Get task notes' })
  async notes(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.taskChildren(
      r.user.id,
      await this.org(r, q, h),
      id,
      'notes',
      q,
    );
  }
  @Get('tasks/:taskId/history')
  @ApiOperation({ summary: 'Get task activity history' })
  async history(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
    @Headers('x-organization-id') h?: string,
  ) {
    return this.workflow.taskChildren(
      r.user.id,
      await this.org(r, q, h),
      id,
      'history',
      q,
    );
  }
}

import {
  WorkflowRoleResponseDto,
  WorkflowRoleHistoryDto,
  PermissionCatalogueItemDto,
  WorkflowTeamResponseDto,
  WorkflowProjectResponseDto,
  WorkflowTaskResponseDto,
} from './workflow-response.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiConflictResponse,
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
  WorkflowRoleHistoryDto,
  PermissionCatalogueItemDto,
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
  private org(req: RequestWithUser, query: WorkflowQueryDto) {
    const header =
      typeof req.headers['x-organization-id'] === 'string'
        ? req.headers['x-organization-id']
        : undefined;
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
  ) {
    return this.attachments.upload(r.user.id, await this.org(r, q), id, file);
  }
  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'List task attachments' })
  async taskAttachments(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.attachments.list(r.user.id, await this.org(r, q), id);
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
  ) {
    return this.attachments.download(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.attachments.remove(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workspace.createDepartment(r.user.id, {
      ...b,
      organizationId: await this.org(r, q),
    });
  }
  @Get('departments')
  @ApiOperation({ summary: 'List departments in the resolved workspace' })
  async departments(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workspace.departments(r.user.id, {
      organizationId: await this.org(r, q),
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
  ) {
    return this.workspace.department(r.user.id, id, await this.org(r, q));
  }

  @Get('permissions')
  @ApiOperation({
    summary: 'Permission catalogue for role builders',
    description:
      'Every permission with a display name, description, group and type. ownerOnly marks workspace.delete, workspace.transfer and billing.manage (never assignable to custom roles, included so the UI can show them disabled). assignable is false for those rows. grantable is true only when the current user can grant the permission, so the UI can disable checkboxes for anything beyond the caller. Sort items by group, then by name.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(PermissionCatalogueItemDto) },
        },
      },
    },
  })
  async permissions(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.permissions(r.user.id, await this.org(r, q));
  }
  @Get('members')
  @ApiOperation({
    summary: 'Member picker with email, display name and avatar',
  })
  async members(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.members(r.user.id, await this.org(r, q), q);
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
  async roles(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.list(r.user.id, await this.org(r, q), 'roles', q);
  }
  @Get('roles/:roleId')
  @ApiOperation({ summary: 'Resume a saved role wizard or view a role' })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async role(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.detail(r.user.id, await this.org(r, q), 'roles', id);
  }
  @Get('roles/:roleId/history')
  @ApiOperation({
    summary: 'Audit trail of every role save',
    description:
      'Newest first. Each entry records who saved, what they submitted (including permissionIds when replaced), and the previous/new revision, so overwrites are never silent.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: getSchemaPath(WorkflowRoleHistoryDto) },
        },
      },
    },
  })
  async roleHistory(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.roleHistory(r.user.id, await this.org(r, q), id);
  }
  @Post('roles')
  @ApiOperation({
    summary:
      'Create a role draft or an active role; ID and key are generated by the backend',
    description:
      'Creates the role and initial permissionIds atomically. Do not send id or expectedRevision, and do not make a second permissions request to finish creation. Use PATCH /organization/roles/{roleId} to resume a saved draft.',
  })
  @ApiBody({
    type: CreateRoleDto,
    examples: {
      draft: {
        summary: 'Create a draft',
        value: { name: 'Senior Backend Engineer', status: 'draft' },
      },
      accessRole: {
        summary: 'Create an active access role with permissions in one request',
        value: {
          name: 'Team Coordinator',
          status: 'active',
          permissionIds: ['teams.view', 'teams.manage'],
        },
      },
    },
  })
  @ApiCreatedResponse({ type: WorkflowRoleResponseDto })
  async createRole(
    @Req() r: RequestWithUser,
    @Body() b: CreateRoleDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
      'role.save',
      null,
      b,
    );
  }
  @Patch('roles/:roleId')
  @ApiOperation({
    summary: 'Save wizard sections, update permissions, or activate a role',
    description:
      'Omitted fields are preserved. Supplied requirements/benefits objects replace that section. Drafts cannot be assigned. Sending permissionIds replaces the permission set directly and the response returns the next revision; expectedRevision is optional and only guards against concurrent changes when supplied. Every successful save returns the next revision.',
  })
  @ApiBody({
    type: UpdateRoleDto,
    examples: {
      basicInformation: {
        summary: 'Save fields without replacing permissions',
        value: { name: 'Senior Backend Engineer' },
      },
    },
  })
  @ApiConflictResponse({
    description:
      'Only when a stale expectedRevision is supplied. Reload the role and retry, or omit expectedRevision to save directly.',
  })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async updateRole(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Body() b: UpdateRoleDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
      'role.save',
      id,
      b,
    );
  }
  @Put('roles/:roleId/permissions')
  @ApiOperation({
    summary: 'Atomically replace the explicit permission set',
    description:
      'For an existing role only. Replaces the permission set directly and returns the next revision. expectedRevision is optional: omit it for a plain replace, or supply the revision from the latest GET /organization/roles/{roleId} to detect concurrent changes. On ROLE_REVISION_CONFLICT, reload and review before retrying.',
  })
  @ApiConflictResponse({
    description:
      'Only when a stale expectedRevision is supplied. details includes roleId, expectedRevision, currentRevision (when available), and reloadUrl.',
  })
  @ApiOkResponse({ type: WorkflowRoleResponseDto })
  async rolePermissions(
    @Req() r: RequestWithUser,
    @Param('roleId', ParseUUIDPipe) id: string,
    @Body() b: PermissionsDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  async teams(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.list(r.user.id, await this.org(r, q), 'teams', q);
  }
  @Get('teams/:teamId')
  @ApiOperation({ summary: 'Get a sub-team' })
  @ApiOkResponse({ type: WorkflowTeamResponseDto })
  async team(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.detail(r.user.id, await this.org(r, q), 'teams', id);
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.members(r.user.id, await this.org(r, q), q, id);
  }
  @Put('teams/:teamId/members')
  @ApiOperation({ summary: 'Replace team membership atomically' })
  @ApiOkResponse({ type: WorkflowTeamResponseDto })
  async replaceMembers(
    @Req() r: RequestWithUser,
    @Param('teamId', ParseUUIDPipe) id: string,
    @Body() b: MembersDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  async projects(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.list(r.user.id, await this.org(r, q), 'projects', q);
  }
  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Project details and progress from all its tasks' })
  @ApiOkResponse({ type: WorkflowProjectResponseDto })
  async project(
    @Req() r: RequestWithUser,
    @Param('projectId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.detail(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  async tasks(@Req() r: RequestWithUser, @Query() q: WorkflowQueryDto) {
    return this.workflow.list(r.user.id, await this.org(r, q), 'tasks', q);
  }
  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'View task details' })
  @ApiOkResponse({ type: WorkflowTaskResponseDto })
  async task(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.detail(r.user.id, await this.org(r, q), 'tasks', id);
  }
  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'Edit, assign, or complete a task (status: done)' })
  @ApiOkResponse({ type: WorkflowTaskResponseDto })
  async updateTask(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Body() b: UpdateTaskDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.attachments.deleteTask(r.user.id, await this.org(r, q), id);
  }
  @Post('tasks/:taskId/notes')
  @ApiOperation({ summary: 'Add a plain-text note' })
  async note(
    @Req() r: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) id: string,
    @Body() b: TaskNoteDto,
    @Query() q: WorkflowQueryDto,
  ) {
    return this.workflow.mutate(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.taskChildren(
      r.user.id,
      await this.org(r, q),
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
  ) {
    return this.workflow.taskChildren(
      r.user.id,
      await this.org(r, q),
      id,
      'history',
      q,
    );
  }
}

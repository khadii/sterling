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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiExcludeController,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { WorkflowService } from '../organization-workflow/workflow.service';
import { WorkflowQueryDto } from '../organization-workflow/workflow.dto';
import { NotificationService } from './notification.service';
import {
  NotificationPreferencesResponseDto,
  InvitationResponseDto,
  InvitationListResponseDto,
  InvitationAcceptedResponseDto,
  DepartmentMembersResponseDto,
  AcceptInvitationDto,
  DepartmentMembersDto,
  DepartmentTransferDto,
  NotificationPreferencesDto,
  OrganizationInvitationDto,
} from './notification.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';

@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description: 'Select a workspace only when you have multiple memberships.',
})
@ApiTags('Notifications & Invitations')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller()
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly workflow: WorkflowService,
    private readonly supabase: SupabaseService,
  ) {}
  @Get('organization/workspaces')
  @ApiOperation({
    summary:
      'List your workspace memberships, including accepted invitations; no employer setup required',
  })
  async workspaces(@Req() req: RequestWithUser) {
    const { data, error } = await this.supabase.adminClient
      .from('organization_members')
      .select('organization_id,organization:organizations(id,name)')
      .eq('user_id', req.user.id);
    if (error) throw mapDatabaseError(error, 'load workspace memberships');
    return {
      items: (data as { organization_id: string; organization: unknown }[]).map(
        (row) => ({
          organizationId: row.organization_id,
          organization: row.organization,
        }),
      ),
    };
  }
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  @Get('notifications/preferences')
  @ApiOperation({ summary: 'Get your email preferences' })
  preferences(@Req() req: RequestWithUser) {
    return this.notifications.preferences(req.user.id);
  }
  @ApiOkResponse({ type: NotificationPreferencesResponseDto })
  @Patch('notifications/preferences')
  @ApiOperation({
    summary:
      'Set routine email delivery and reminders; essential access emails remain enabled',
  })
  updatePreferences(
    @Req() req: RequestWithUser,
    @Body() dto: NotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(req.user.id, dto);
  }
  @ApiCreatedResponse({ type: InvitationResponseDto })
  @Post('organization/invitations')
  @ApiOperation({
    summary:
      'Invite a colleague; queue a seven-day acceptance link. Reinviting revokes the previous pending link.',
  })
  async invite(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Body() dto: OrganizationInvitationDto,
  ) {
    return this.notifications.invite(
      req.user.id,
      await this.workflow.organization(
        req.user.id,
        header,
        query.organizationId,
      ),
      dto,
    );
  }
  @ApiCreatedResponse({ type: InvitationAcceptedResponseDto })
  @Post('organization/invitations/accept')
  @ApiOperation({
    summary:
      'Accept an invitation with the invited verified account; safely repeatable',
  })
  accept(@Req() req: RequestWithUser, @Body() dto: AcceptInvitationDto) {
    return this.notifications.accept(req.user.id, dto.token);
  }
  @ApiOkResponse({ type: InvitationListResponseDto })
  @Get('organization/invitations')
  @ApiOperation({ summary: 'List invitation status without exposing tokens' })
  async invitations(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    await this.workflow.access(req.user.id, org, 'members.invite');
    const { data, error } = await this.supabase.adminClient
      .from('organization_invitations')
      .select('id,email,status,expires_at,created_at,accepted_by')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .range((query.page - 1) * query.limit, query.page * query.limit - 1);
    if (error) throw mapDatabaseError(error, 'list invitations');
    return {
      items: (
        data as {
          id: string;
          email: string;
          status: string;
          expires_at: string;
        }[]
      ).map((row) => ({
        id: row.id,
        email: row.email,
        status: row.status,
        expiresAt: row.expires_at,
      })),
    };
  }
  @Delete('organization/invitations/:invitationId')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revoke(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('invitationId', ParseUUIDPipe) id: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.rpc('revoke_organization_invitation', {
      p_actor: req.user.id,
      p_org: org,
      p_id: id,
    });
  }
  @ApiOkResponse({ type: DepartmentMembersResponseDto })
  @Put('organization/departments/:departmentId/members')
  @ApiOperation({
    summary:
      'Replace direct department members and notify only actual additions/removals; does not grant permissions',
  })
  async setMembers(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('departmentId', ParseUUIDPipe) id: string,
    @Body() dto: DepartmentMembersDto,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.rpc('set_department_members', {
      p_actor: req.user.id,
      p_org: org,
      p_department: id,
      p_members: dto.memberIds,
      p_revision: dto.expectedRevision,
    });
  }
  @ApiOkResponse({ type: DepartmentMembersResponseDto })
  @Get('organization/departments/:departmentId/members')
  @ApiOperation({ summary: 'List direct department member IDs' })
  async members(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('departmentId', ParseUUIDPipe) id: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.rpc('workspace_membership_snapshot', {
      p_actor: req.user.id,
      p_org: org,
      p_kind: 'department',
      p_entity: id,
    });
  }
  @Put('organization/departments/:entityId/members/:userId')
  @ApiOperation({
    summary: 'Add one department member atomically; other members are retained',
  })
  async addDepartmentMember(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('entityId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.changeMember({
      p_actor: req.user.id,
      p_org: org,
      p_kind: 'department',
      p_entity: id,
      p_user: userId,
      p_add: true,
    });
  }

  @Delete('organization/departments/:entityId/members/:userId')
  @ApiOperation({
    summary:
      'Remove one department member atomically; other members are retained',
  })
  async removeDepartmentMember(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('entityId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.changeMember({
      p_actor: req.user.id,
      p_org: org,
      p_kind: 'department',
      p_entity: id,
      p_user: userId,
      p_add: false,
    });
  }

  @Put('organization/teams/:entityId/members/:userId')
  @ApiOperation({
    summary: 'Add one team member atomically; other members are retained',
  })
  async addTeamMember(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('entityId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.changeMember({
      p_actor: req.user.id,
      p_org: org,
      p_kind: 'team',
      p_entity: id,
      p_user: userId,
      p_add: true,
    });
  }

  @Delete('organization/teams/:entityId/members/:userId')
  @ApiOperation({
    summary: 'Remove one team member atomically; other members are retained',
  })
  async removeTeamMember(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Param('entityId', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.changeMember({
      p_actor: req.user.id,
      p_org: org,
      p_kind: 'team',
      p_entity: id,
      p_user: userId,
      p_add: false,
    });
  }

  @Post('organization/departments/transfer-member')
  @ApiOperation({
    summary:
      'Transfer a direct department membership atomically; team memberships and permissions are unchanged',
  })
  async transfer(
    @Req() req: RequestWithUser,
    @Query() query: WorkflowQueryDto,
    @Headers('x-organization-id') header: string | undefined,
    @Body() dto: DepartmentTransferDto,
  ) {
    const org = await this.workflow.organization(
      req.user.id,
      header,
      query.organizationId,
    );
    return this.notifications.rpc('transfer_department_member', {
      p_actor: req.user.id,
      p_org: org,
      p_user: dto.userId,
      p_from: dto.fromDepartmentId,
      p_to: dto.toDepartmentId,
    });
  }
}

@ApiExcludeController()
@Controller('internal/notifications')
export class NotificationWorkerController {
  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}
  @Get('health')
  health(@Headers('authorization') authorization: string | undefined) {
    this.authorize(authorization);
    return this.notifications.health();
  }
  @Get('process')
  cron(@Headers('authorization') authorization: string | undefined) {
    return this.process(authorization);
  }
  @Post('process')
  process(@Headers('authorization') authorization: string | undefined) {
    this.authorize(authorization);
    return this.notifications.process();
  }
  private authorize(authorization: string | undefined) {
    const secrets = [
      this.config.get<string>('NOTIFICATION_WORKER_SECRET'),
      this.config.get<string>('CRON_SECRET'),
    ].filter((s): s is string => Boolean(s));
    const valid = secrets.some((secret) => {
      const actual = Buffer.from(authorization ?? '');
      const expected = Buffer.from(`Bearer ${secret}`);
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    });
    if (!valid) throw new UnauthorizedException('Invalid worker credentials');
  }
}

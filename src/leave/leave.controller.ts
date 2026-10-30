import {
  Body,
  Controller,
  Delete,
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
  LeavePolicyDto,
  LeavePolicyListQueryDto,
  LeaveSettingsDto,
  UpdateLeavePolicyDto,
} from './leave.dto';
import { LeaveService } from './leave.service';

@ApiTags('Employer Leave')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Organization-Id',
  required: false,
  description:
    'Selects the workspace when the signed-in user belongs to more than one',
})
@UseGuards(SupabaseAuthGuard)
@Controller('employer/leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  private orgHeader(req: RequestWithUser): string | undefined {
    const value = req.headers['x-organization-id'];
    return Array.isArray(value) ? value[0] : value;
  }

  private org(req: RequestWithUser) {
    return this.leave.organization(req.user.id, this.orgHeader(req));
  }

  @Get('policies')
  @ApiOperation({
    summary: 'List leave policies; omit page and limit to return every policy',
  })
  @ApiOkResponse()
  async listPolicies(
    @Req() req: RequestWithUser,
    @Query() q: LeavePolicyListQueryDto,
  ) {
    return this.leave.listPolicies(req.user.id, await this.org(req), q);
  }

  @Post('policies')
  @ApiOperation({ summary: 'Create a leave policy' })
  @ApiCreatedResponse()
  async createPolicy(@Req() req: RequestWithUser, @Body() dto: LeavePolicyDto) {
    return this.leave.savePolicy(req.user.id, await this.org(req), null, dto);
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update a leave policy' })
  @ApiOkResponse()
  async updatePolicy(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeavePolicyDto,
  ) {
    return this.leave.savePolicy(req.user.id, await this.org(req), id, dto);
  }

  @Delete('policies/:id')
  @ApiOperation({ summary: 'Delete a leave policy' })
  @ApiOkResponse()
  async deletePolicy(
    @Req() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leave.deletePolicy(req.user.id, await this.org(req), id);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get organization leave settings' })
  @ApiOkResponse()
  async settings(@Req() req: RequestWithUser) {
    return this.leave.settings(req.user.id, await this.org(req));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Save organization leave settings' })
  @ApiOkResponse()
  async saveSettings(
    @Req() req: RequestWithUser,
    @Body() dto: LeaveSettingsDto,
  ) {
    return this.leave.saveSettings(req.user.id, await this.org(req), dto);
  }

  @Get('reports')
  @ApiOperation({
    summary:
      'Leave usage report: summary, by-type breakdown and employee balances',
  })
  @ApiOkResponse()
  async reports(@Req() req: RequestWithUser) {
    return this.leave.reports(req.user.id, await this.org(req));
  }
}

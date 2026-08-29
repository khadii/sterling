import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { UserRole } from '../common/enums/user-role.enum';
import {
  IndustryQueryDto,
  SuggestionQueryDto,
} from './dto/reference-query.dto';
import { ReferenceService } from './reference.service';

@ApiTags('Reference Data')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYER)
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('industries')
  @ApiOperation({ summary: 'Search active industries' })
  industries(@Query() query: IndustryQueryDto) {
    return this.reference.industries(query);
  }

  @Get('departments/suggestions')
  @ApiOperation({ summary: 'Get common department suggestions' })
  suggestions(@Query() query: SuggestionQueryDto) {
    return this.reference.departmentSuggestions(query);
  }
}

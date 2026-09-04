import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { UserRole } from '../common/enums/user-role.enum';
import {
  IndustryQueryDto,
  SuggestionQueryDto,
} from './dto/reference-query.dto';
import {
  CountriesQueryDto,
  LocalesQueryDto,
  TimezonesQueryDto,
} from './dto/geography-query.dto';
import {
  CountriesResponseDto,
  LocalesResponseDto,
  TimezonesResponseDto,
} from './dto/geography-response.dto';
import { GeographyReferenceService } from './geography-reference.service';
import { ReferenceService } from './reference.service';

@ApiTags('Reference Data')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYER)
@Controller('reference')
export class ReferenceController {
  constructor(
    private readonly reference: ReferenceService,
    private readonly geography: GeographyReferenceService,
  ) {}

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

  @Get('countries')
  @ApiOperation({ summary: 'Search and paginate countries' })
  @ApiOkResponse({ type: CountriesResponseDto })
  countries(@Query() query: CountriesQueryDto) {
    return this.geography.countries(query);
  }

  @Get('timezones')
  @ApiOperation({ summary: 'Search IANA timezones' })
  @ApiOkResponse({ type: TimezonesResponseDto })
  timezones(@Query() query: TimezonesQueryDto) {
    return this.geography.timezones(query);
  }

  @Get('locales')
  @ApiOperation({ summary: 'Get supported BCP 47 locales' })
  @ApiOkResponse({ type: LocalesResponseDto })
  locales(@Query() query: LocalesQueryDto) {
    return this.geography.locales(query);
  }
}

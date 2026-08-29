import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SupportedDateFormat, WeekStart } from '../onboarding.enums';
import {
  IsBcp47Locale,
  IsIanaTimeZone,
  IsIsoCountryCode,
} from './onboarding.validators';

export class WorkspaceSettingsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  @IsIsoCountryCode()
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  @IsOptional()
  @IsString()
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ example: 'en-NG' })
  @IsOptional()
  @IsString()
  @IsBcp47Locale()
  locale?: string;

  @ApiPropertyOptional({ enum: WeekStart })
  @IsOptional()
  @IsEnum(WeekStart)
  weekStartsOn?: WeekStart;

  @ApiPropertyOptional({ enum: SupportedDateFormat })
  @IsOptional()
  @IsEnum(SupportedDateFormat)
  dateFormat?: SupportedDateFormat;
}

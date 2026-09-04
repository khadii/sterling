import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CountryReferenceDto {
  @ApiProperty({ example: 'NG' }) code!: string;
  @ApiProperty({ example: 'Nigeria' }) name!: string;
  @ApiPropertyOptional({ nullable: true, example: '+234' }) phoneCode?:
    string | null;
  @ApiPropertyOptional({ nullable: true, example: 'NGN' }) currency?:
    string | null;
  @ApiProperty({ example: '🇳🇬' }) flag!: string;
}

export class CountriesResponseDto {
  @ApiProperty({ type: [CountryReferenceDto] }) items!: CountryReferenceDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() hasMore!: boolean;
}

export class TimezoneReferenceDto {
  @ApiProperty({ example: 'Africa/Lagos' }) name!: string;
  @ApiProperty({ example: '+01:00' }) offset!: string;
  @ApiProperty({ example: 'GMT+1' }) abbr!: string;
  @ApiPropertyOptional({ nullable: true, example: 'NG' }) countryCode!:
    string | null;
}

export class TimezonesResponseDto {
  @ApiProperty({ type: [TimezoneReferenceDto] }) items!: TimezoneReferenceDto[];
  @ApiProperty() total!: number;
}

export class LocaleReferenceDto {
  @ApiProperty({ example: 'en-NG' }) code!: string;
  @ApiProperty({ example: 'English (Nigeria)' }) name!: string;
  @ApiProperty({ example: 'English' }) language!: string;
  @ApiProperty({ example: 'NG' }) countryCode!: string;
  @ApiProperty({ example: 'Nigeria' }) countryName!: string;
  @ApiProperty({ enum: ['sunday', 'monday'] }) defaultWeekStart!:
    'sunday' | 'monday';
  @ApiProperty({ enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] })
  defaultDateFormat!: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
}

export class LocalesResponseDto {
  @ApiProperty({ type: [LocaleReferenceDto] }) items!: LocaleReferenceDto[];
  @ApiProperty() total!: number;
}

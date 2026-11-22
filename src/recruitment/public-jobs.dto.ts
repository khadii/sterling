import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EMPLOYMENT_TYPES, WORK_ARRANGEMENTS } from './recruitment.dto';

export class PublicJobListQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restrict results to one organization',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Matches organization name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organization?: string;

  @ApiPropertyOptional({ description: 'Matches job title or summary' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ description: 'Matches department name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @ApiPropertyOptional({ enum: WORK_ARRANGEMENTS })
  @IsOptional()
  @IsIn(WORK_ARRANGEMENTS)
  workArrangement?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @ApiPropertyOptional({ description: 'Matches city or country' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-10-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  postedFrom?: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-22' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  postedTo?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class PublicJobListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'senior-product-designer-ab12cd' })
  publicSlug!: string | null;

  @ApiProperty({ example: 'Senior Product Designer' })
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Sterling Tech' })
  organizationName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Product' })
  departmentName!: string | null;

  @ApiProperty({ example: 'hybrid' })
  workArrangement!: string;

  @ApiProperty({ example: 'full_time' })
  employmentType!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Senior (L4)' })
  seniorityLevel!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Lagos' })
  locationCity!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'NG' })
  locationCountry!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 120000 })
  salaryMin!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: 150000 })
  salaryMax!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'USD' })
  currency!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  postedOn!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  closesOn!: string | null;
}

export class PublicJobListDto {
  @ApiProperty({ type: [PublicJobListItemDto] })
  items!: PublicJobListItemDto[];

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}

export class PublicJobApplicationDto {
  @ApiProperty({ minLength: 1, maxLength: 160, example: 'Sarah Johnson' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName!: string;

  @ApiProperty({ format: 'email', example: 'sarah.johnson@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({ maxLength: 40, example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 2048, description: 'Resume or portfolio URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  resumeUrl?: string;

  @ApiPropertyOptional({ maxLength: 160, example: 'UX Designer' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  currentRole?: string;

  @ApiPropertyOptional({ maxLength: 160, example: 'Google' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  currentCompany?: string;
}

export class PublicJobApplicationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ example: 'Senior Product Designer' })
  jobTitle!: string;

  @ApiProperty({ example: 'Sarah Johnson' })
  fullName!: string;

  @ApiProperty({ example: 'sarah.johnson@example.com' })
  email!: string;

  @ApiProperty({ example: 'new' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  appliedAt!: string;
}

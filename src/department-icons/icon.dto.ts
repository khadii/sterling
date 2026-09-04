import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LogoContentType } from '../employer-onboarding/onboarding.enums';

export class IconUploadDto {
  @ApiProperty({ minLength: 2, maxLength: 60 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
  @ApiProperty({ enum: LogoContentType })
  @IsEnum(LogoContentType)
  contentType!: LogoContentType;
  @ApiProperty({ minimum: 1, maximum: 1_048_576 })
  @IsInt()
  @Min(1)
  @Max(1_048_576)
  fileSize!: number;
}
export class ConfirmIconDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() uploadId!: string;
}
export class UpdateIconDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 60 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
export class IconQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
export class IconResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Built-in frontend icon key, or null for uploaded icons',
  })
  builtinKey!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Private image URL, expires after one hour',
  })
  url!: string | null;
}

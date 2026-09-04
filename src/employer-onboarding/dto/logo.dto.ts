import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LogoContentType } from '../onboarding.enums';

export class CreateLogoUploadDto {
  @ApiProperty({ example: 'company-logo.png', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  fileName!: string;

  @ApiProperty({
    enum: LogoContentType,
    description:
      'Maximum 800 × 400 pixels. Single-frame images only; verified output is PNG.',
  })
  @IsEnum(LogoContentType)
  contentType!: LogoContentType;

  @ApiProperty({ minimum: 1, maximum: 5_242_880 })
  @IsInt()
  @Min(1)
  @Max(5_242_880)
  fileSize!: number;
}

export class ConfirmLogoUploadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  uploadId!: string;
}

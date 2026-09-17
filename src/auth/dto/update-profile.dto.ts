import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String, example: 'Ada Okafor', nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'uri',
    nullable: true,
    description:
      'HTTPS avatar URL; null clears it. This endpoint does not upload bytes.',
  })
  @IsOptional()
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
  })
  @MaxLength(2048)
  avatarUrl?: string | null;
}

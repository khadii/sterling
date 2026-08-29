import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DepartmentDraftItemDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  clientId!: string;

  @ApiProperty({ minLength: 2, maxLength: 60 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string | null;
}

export class SaveDepartmentsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: [DepartmentDraftItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DepartmentDraftItemDto)
  departments!: DepartmentDraftItemDto[];
}

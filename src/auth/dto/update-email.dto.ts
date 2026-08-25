import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class UpdateEmailDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() refreshToken!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

export class ConfirmEmailOtpDto {
  @ApiProperty({ example: 'person@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '123456',
    description:
      'The six-digit code from the Supabase signup confirmation email',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'token must be a six-digit code' })
  token!: string;
}

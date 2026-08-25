import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginFlowDto {
  @ApiProperty({ example: 'google' })
  provider!: 'google';

  @ApiProperty({ example: 'pkce' })
  flow!: 'pkce';

  @ApiProperty({
    example:
      "supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })",
  })
  frontendAction!: string;

  @ApiProperty({
    example:
      'After login, send session.access_token as Authorization: Bearer <token>',
  })
  apiAuthentication!: string;

  @ApiProperty({ example: 'GET /api/v1/auth/me' })
  nextStep!: string;

  @ApiProperty({
    example: 'POST /api/v1/auth/complete-onboarding',
    required: false,
  })
  onboardingWhenRolesAreEmpty!: string;
}

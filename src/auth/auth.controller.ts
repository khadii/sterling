import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthService } from './auth.service';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { EmailDto } from './dto/email.dto';
import { GoogleLoginFlowDto } from './dto/google-login-flow.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { SupabaseAuthGuard } from './supabase-auth.guard';

@ApiTags('Authentication')
@ApiResponse({ status: 400, description: 'Invalid request', type: ApiErrorDto })
@ApiResponse({
  status: 429,
  description: 'Rate limit exceeded',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 500,
  description: 'Unexpected server error',
  type: ApiErrorDto,
})
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('google')
  @ApiOperation({
    summary: 'Google login integration (frontend Supabase PKCE flow)',
    description:
      "Google login starts in the frontend with supabase.auth.signInWithOAuth({ provider: 'google' }). This endpoint documents the flow; it does not initiate or exchange browser-specific PKCE state.",
  })
  @ApiResponse({ status: 200, type: GoogleLoginFlowDto })
  googleLoginFlow(): GoogleLoginFlowDto {
    return {
      provider: 'google',
      flow: 'pkce',
      frontendAction:
        "supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })",
      apiAuthentication:
        'After login, send session.access_token as Authorization: Bearer <token>',
      nextStep: 'GET /api/v1/auth/me',
      onboardingWhenRolesAreEmpty: 'POST /api/v1/auth/complete-onboarding',
    };
  }

  @Post('sign-up')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register with email and password' })
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto);
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email and password' })
  signIn(@Body() dto: SignInDto) {
    return this.auth.signIn(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() dto: EmailDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendConfirmation(@Body() dto: EmailDto) {
    return this.auth.resendConfirmation(dto.email);
  }

  @Post('update-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  updatePassword(
    @Headers('authorization') header: string,
    @Body() dto: UpdatePasswordDto,
  ) {
    return this.auth.updatePassword(this.tokenFrom(header), dto);
  }

  @Post('update-email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  updateEmail(
    @Headers('authorization') header: string,
    @Body() dto: UpdateEmailDto,
  ) {
    return this.auth.updateEmail(this.tokenFrom(header), dto);
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  signOut(@Headers('authorization') header: string) {
    return this.auth.signOut(this.tokenFrom(header));
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  me(@Req() request: RequestWithUser) {
    return request.user;
  }

  @Post('complete-onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  @ApiOperation({
    summary: 'Assign the authenticated user’s initial public role once',
  })
  completeOnboarding(
    @Req() request: RequestWithUser,
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.auth.completeOnboarding(request.user.id, dto.role);
  }

  @Post('change-role')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @UseGuards(SupabaseAuthGuard)
  @ApiOperation({
    summary: 'Deliberately switch the user’s self-assignable account role',
  })
  changeRole(
    @Req() request: RequestWithUser,
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.auth.changeRole(request.user.id, dto.role);
  }

  private tokenFrom(header: string): string {
    return header.slice(header.indexOf(' ') + 1);
  }
}

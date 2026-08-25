import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums/user-role.enum';
import { SupabaseService } from '../supabase/supabase.service';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { isMissingAccountError, mapAuthError } from './auth-error.mapper';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async signUp(dto: SignUpDto) {
    const { data, error } = await this.supabase.publicClient.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: {
        data: { role: dto.role },
        emailRedirectTo: this.config.getOrThrow<string>(
          'EMAIL_CONFIRM_REDIRECT_URL',
        ),
      },
    });
    if (error) throw mapAuthError(error, 'sign_up');
    return data;
  }

  async signIn(dto: SignInDto) {
    const { data, error } =
      await this.supabase.publicClient.auth.signInWithPassword(dto);
    if (error) throw mapAuthError(error, 'sign_in');
    return data;
  }

  async refresh(refreshToken: string) {
    const { data, error } =
      await this.supabase.publicClient.auth.refreshSession({
        refresh_token: refreshToken,
      });
    if (error) throw mapAuthError(error, 'refresh');
    return data;
  }

  async requestPasswordReset(email: string) {
    const { error } =
      await this.supabase.publicClient.auth.resetPasswordForEmail(email, {
        redirectTo: this.config.getOrThrow<string>(
          'PASSWORD_RESET_REDIRECT_URL',
        ),
      });
    if (error && !isMissingAccountError(error)) {
      throw mapAuthError(error, 'password_reset');
    }
    return {
      message:
        'If an account exists, password reset instructions have been sent',
    };
  }

  async resendConfirmation(email: string) {
    const { error } = await this.supabase.publicClient.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: this.config.getOrThrow<string>(
          'EMAIL_CONFIRM_REDIRECT_URL',
        ),
      },
    });
    if (error && !isMissingAccountError(error)) {
      throw mapAuthError(error, 'resend_confirmation');
    }
    return {
      message: 'If confirmation is required, a new email has been sent',
    };
  }

  async updatePassword(accessToken: string, dto: UpdatePasswordDto) {
    const client = this.supabase.createUserClient(accessToken);
    const { error: sessionError } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: dto.refreshToken,
    });
    if (sessionError) throw mapAuthError(sessionError, 'update_password');
    const { data, error } = await client.auth.updateUser({
      password: dto.password,
    });
    if (error) throw mapAuthError(error, 'update_password');
    return { user: data.user };
  }

  async updateEmail(accessToken: string, dto: UpdateEmailDto) {
    const client = this.supabase.createUserClient(accessToken);
    const { error: sessionError } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: dto.refreshToken,
    });
    if (sessionError) throw mapAuthError(sessionError, 'update_email');
    const { data, error } = await client.auth.updateUser(
      { email: dto.email },
      {
        emailRedirectTo: this.config.getOrThrow<string>(
          'EMAIL_CONFIRM_REDIRECT_URL',
        ),
      },
    );
    if (error) throw mapAuthError(error, 'update_email');
    return { user: data.user };
  }

  async signOut(accessToken: string) {
    const { error } = await this.supabase.adminClient.auth.admin.signOut(
      accessToken,
      'local',
    );
    if (error) throw mapAuthError(error, 'sign_out');
    return { success: true };
  }

  async completeOnboarding(userId: string, role: UserRole) {
    const { error: assignmentError } = await this.supabase.adminClient.rpc(
      'assign_initial_role',
      { p_user_id: userId, p_role: role } as never,
    );
    if (assignmentError) {
      throw mapDatabaseError(assignmentError, 'assign account role');
    }
    return { roles: [role], onboardingComplete: true };
  }

  async changeRole(userId: string, role: UserRole) {
    const { error } = await this.supabase.adminClient.rpc('change_self_role', {
      p_user_id: userId,
      p_role: role,
    } as never);
    if (error?.code === 'P0002') {
      throw new BadRequestException(
        'Complete account onboarding before changing role',
      );
    }
    if (error) {
      throw mapDatabaseError(error, 'change account role');
    }
    return { roles: [role] };
  }
}

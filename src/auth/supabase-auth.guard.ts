import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import { mapAuthError } from './auth-error.mapper';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token)
      throw new UnauthorizedException('A valid bearer token is required');

    const { data, error } =
      await this.supabase.publicClient.auth.getUser(token);
    if (error) throw mapAuthError(error, 'verify_token');
    if (!data.user)
      throw new UnauthorizedException('Invalid or expired access token');

    const { data: assignments, error: rolesError } =
      await this.supabase.adminClient
        .from('user_roles')
        .select('role_id')
        .eq('user_id', data.user.id);
    if (rolesError) throw mapDatabaseError(rolesError, 'load account roles');

    request.user = {
      id: data.user.id,
      email: data.user.email,
      roles: assignments.map(({ role_id }: { role_id: string }) => role_id),
    };
    return true;
  }
}

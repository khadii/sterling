import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { mapDatabaseError } from '../supabase/database-error.mapper';

@Injectable()
export class PlatformIconGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    const roles =
      user?.roles.filter((role) => role === 'admin' || role === 'superadmin') ??
      [];
    if (!roles.length)
      throw new ForbiddenException('Platform administrator access required');
    const { data, error } = await this.supabase.adminClient
      .from('role_permissions')
      .select('role_id')
      .in('role_id', roles)
      .eq('permission_id', 'department_icons.manage')
      .limit(1);
    if (error) throw mapDatabaseError(error, 'check icon permissions');
    if (!data?.length)
      throw new ForbiddenException(
        'Department icon management permission required',
      );
    return true;
  }
}

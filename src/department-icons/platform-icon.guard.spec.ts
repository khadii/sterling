import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PlatformIconGuard } from './platform-icon.guard';

describe('PlatformIconGuard', () => {
  const context = (roles: string[]) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as unknown as ExecutionContext;
  it.each([['employer'], ['job_seeker'], ['organisation_admin'], []])(
    'rejects non-platform roles %j',
    async (...roles) => {
      const guard = new PlatformIconGuard({} as SupabaseService);
      await expect(
        guard.canActivate(context(roles as string[])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it.each(['admin', 'superadmin'])(
    'requires a trusted permission for %s',
    async (role) => {
      const query = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      const supabase = {
        adminClient: { from: jest.fn().mockReturnValue(query) },
      } as unknown as SupabaseService;
      const guard = new PlatformIconGuard(supabase);
      await expect(guard.canActivate(context([role]))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      query.limit.mockResolvedValue({ data: [{ role_id: role }], error: null });
      await expect(guard.canActivate(context([role]))).resolves.toBe(true);
      expect(query.eq).toHaveBeenCalledWith(
        'permission_id',
        'department_icons.manage',
      );
    },
  );
});

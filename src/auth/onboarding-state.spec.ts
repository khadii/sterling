import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
function setup(status: string, members: string[]) {
  const from = jest.fn((table: string) => {
    const data =
      table === 'organization_members'
        ? members.map((organization_id) => ({
            organization_id,
            organization: {
              id: organization_id,
              name: `Workspace ${organization_id}`,
            },
          }))
        : { status, organization_id: 'owned', completed_at: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve),
    };
    return chain;
  });
  return new AuthService(
    { adminClient: { from } } as unknown as SupabaseService,
    {} as ConfigService,
  );
}
it('routes invited members to their workspace without employer setup', async () => {
  expect(
    await setup('not_started', ['invited']).me({ id: 'u', roles: [] }),
  ).toMatchObject({
    onboardingComplete: true,
    employerWorkspaceSetupComplete: false,
    hasWorkspaceAccess: true,
    organizationId: 'invited',
    organizationName: 'Workspace invited',
    organizations: [{ id: 'invited', name: 'Workspace invited' }],
    nextAction: 'dashboard',
  });
});
it('keeps employer account selection distinct from workspace setup', async () => {
  expect(
    await setup('not_started', []).me({ id: 'u', roles: ['employer'] }),
  ).toMatchObject({
    accountOnboardingComplete: true,
    onboardingComplete: false,
    nextAction: 'company_setup',
  });
});
it('does not choose an arbitrary workspace for multiple memberships', async () => {
  expect(
    await setup('completed', ['a', 'b']).me({ id: 'u', roles: ['employer'] }),
  ).toMatchObject({
    organizationId: null,
    organizationName: null,
    organizations: [
      { id: 'a', name: 'Workspace a' },
      { id: 'b', name: 'Workspace b' },
    ],
    requiresWorkspaceSelection: true,
    nextAction: 'select_workspace',
  });
});
it('does not grant access from a stale onboarding organization ID', async () => {
  expect(
    await setup('completed', []).me({ id: 'u', roles: ['employer'] }),
  ).toMatchObject({
    organizationId: null,
    hasWorkspaceAccess: false,
    onboardingComplete: false,
  });
});

import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

describe('Supabase database conflict delivery', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['admin', 'public', 'user'] as const)(
    '%s client returns a conflict after exactly one request',
    async (kind) => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'PT409',
              message: 'Stale revision',
              details: null,
              hint: null,
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      );
      const service = new SupabaseService(
        new ConfigService({
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
          SUPABASE_SECRET_KEY: 'sb_secret_test',
        }),
      );
      const client =
        kind === 'admin'
          ? service.adminClient
          : kind === 'public'
            ? service.publicClient
            : service.createUserClient('test-access-token');

      const result = await client.rpc('workflow_mutate');
      expect(result.status).toBe(409);
      expect(result.error?.code).toBe('PT409');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

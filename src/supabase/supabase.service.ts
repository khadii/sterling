import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { supabaseFetch } from './request-timeout';

type AppSupabaseClient = ReturnType<typeof createClient>;

@Injectable()
export class SupabaseService {
  readonly publicClient: AppSupabaseClient;
  readonly adminClient: AppSupabaseClient;
  private readonly url: string;
  private readonly publishableKey: string;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow<string>('SUPABASE_URL');
    this.publishableKey = config.getOrThrow<string>('SUPABASE_PUBLISHABLE_KEY');
    const auth = {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    };
    this.publicClient = createClient(this.url, this.publishableKey, {
      auth,
      // Business conflicts must reach callers without replaying stale mutations.
      db: { retry: false },
      global: { fetch: supabaseFetch },
    });
    this.adminClient = createClient(
      this.url,
      config.getOrThrow<string>('SUPABASE_SECRET_KEY'),
      { auth, db: { retry: false }, global: { fetch: supabaseFetch } },
    );
  }

  createUserClient(accessToken: string): AppSupabaseClient {
    return createClient(this.url, this.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      db: { retry: false },
      global: {
        fetch: supabaseFetch,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
  }
}

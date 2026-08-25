import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

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
    this.publicClient = createClient(this.url, this.publishableKey, { auth });
    this.adminClient = createClient(
      this.url,
      config.getOrThrow<string>('SUPABASE_SECRET_KEY'),
      { auth },
    );
  }

  createUserClient(accessToken: string): AppSupabaseClient {
    return createClient(this.url, this.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}

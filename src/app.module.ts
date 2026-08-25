import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        API_PREFIX: Joi.string().default('api/v1'),
        CORS_ORIGIN: Joi.string().required(),
        SWAGGER_PATH: Joi.string().default('docs'),
        ENABLE_SWAGGER: Joi.boolean().default(true),
        THROTTLE_ENABLED: Joi.boolean().when('NODE_ENV', {
          is: 'production',
          then: Joi.boolean().default(true),
          otherwise: Joi.boolean().default(false),
        }),
        THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60_000),
        THROTTLE_GLOBAL_LIMIT: Joi.number().integer().min(1).default(100),
        SUPABASE_URL: Joi.string()
          .uri()
          .custom((value: string, helpers) => {
            const url = new URL(value);
            if (url.pathname !== '/' || url.search || url.hash) {
              return helpers.message({
                custom:
                  'SUPABASE_URL must contain only the project origin, without /rest/v1, /auth/v1, query parameters, or a fragment',
              });
            }
            return url.origin;
          })
          .required(),
        SUPABASE_PUBLISHABLE_KEY: Joi.string().required(),
        SUPABASE_SECRET_KEY: Joi.string().required(),
        EMAIL_CONFIRM_REDIRECT_URL: Joi.string().uri().required(),
        PASSWORD_RESET_REDIRECT_URL: Joi.string().uri().required(),
        SMTP_HOST: Joi.string().allow('').optional(),
        SMTP_PORT: Joi.number().port().default(587),
        SMTP_SECURE: Joi.boolean().default(false),
        SMTP_USER: Joi.string().allow('').optional(),
        SMTP_PASSWORD: Joi.string().allow('').optional(),
        MAIL_FROM: Joi.string().email().required(),
        MAIL_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.getOrThrow<number>('THROTTLE_TTL_MS'),
          limit: config.getOrThrow<number>('THROTTLE_GLOBAL_LIMIT'),
          skipIf: () => !config.getOrThrow<boolean>('THROTTLE_ENABLED'),
        },
      ],
    }),
    SupabaseModule,
    AuthModule,
    MailModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

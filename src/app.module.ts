import { HrModule } from './hr/hr.module';
import { NotificationModule } from './notifications/notification.module';
import { RecruitmentModule } from './recruitment/recruitment.module';
import { EmployeeModule } from './employee/employee.module';
import { LeaveModule } from './leave/leave.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as Joi from 'joi';
import { AuthModule } from './auth/auth.module';
import { DepartmentIconsModule } from './department-icons/department-icons.module';
import { EmployerOnboardingModule } from './employer-onboarding/employer-onboarding.module';
import { EmployerWorkspaceModule } from './employer-workspace/employer-workspace.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { ReferenceModule } from './reference/reference.module';
import { SupabaseModule } from './supabase/supabase.module';
import { WorkflowModule } from './organization-workflow/workflow.module';

const productionFrontendUrl = (value: string, helpers: Joi.CustomHelpers) => {
  const hostname = new URL(value).hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]'
  ) {
    return helpers.error('any.invalid');
  }
  return value;
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        // Vercel may provide a Unix socket path instead of a numeric TCP port.
        PORT: Joi.alternatives()
          .try(Joi.number().port(), Joi.string().min(1))
          .empty('')
          .default(3000),
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
        EMAIL_CONFIRM_REDIRECT_URL: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .custom(productionFrontendUrl)
            .required(),
          otherwise: Joi.string().uri().required(),
        }),
        PASSWORD_RESET_REDIRECT_URL: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .custom(productionFrontendUrl)
            .required(),
          otherwise: Joi.string().uri().required(),
        }),
        CRON_SECRET: Joi.string().min(32).optional(),
        NOTIFICATION_WORKER_SECRET: Joi.string().min(32).optional(),
        NOTIFICATION_FRONTEND_URL: Joi.when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .uri({ scheme: ['https'] })
            .custom(productionFrontendUrl),
          otherwise: Joi.string().uri(),
        }).optional(),
        ZOOM_WORKSPACES_JSON: Joi.string().optional(),
        // Recruitment provider integrations. Every value is optional: the API
        // only ever exposes these through the providers that consume them, and
        // the hiring flows work without them until a vendor is configured.
        PUBLIC_JOB_BOARD_URL: Joi.string().uri().empty('').optional(),
        INTERVIEW_SCHEDULING_PROVIDER: Joi.string().max(60).empty('').optional(),
        INTERVIEW_SCHEDULING_BASE_URL: Joi.string().uri().empty('').optional(),
        JOB_SYNDICATION_PROVIDER: Joi.string().max(60).empty('').optional(),
        JOB_SYNDICATION_API_KEY: Joi.string().allow('').optional(),
        JOB_SYNDICATION_FEED_URL: Joi.string().uri().empty('').optional(),
        AI_PROVIDER: Joi.string().max(60).empty('').optional(),
        AI_API_KEY: Joi.string().allow('').optional(),
        AI_MODEL: Joi.string().max(120).empty('').optional(),
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
    DepartmentIconsModule,
    EmployerOnboardingModule,
    EmployerWorkspaceModule,
    WorkflowModule,
    ReferenceModule,
    MailModule,
    NotificationModule,
    HrModule,
    RecruitmentModule,
    EmployeeModule,
    LeaveModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

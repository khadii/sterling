import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  NotificationController,
  NotificationWorkerController,
} from './notification.controller';
import { NotificationService } from './notification.service';
import { WorkflowService } from '../organization-workflow/workflow.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';

it('publishes invitation and preference schemas while keeping the worker out of Swagger', async () => {
  const module = await Test.createTestingModule({
    controllers: [NotificationController, NotificationWorkerController],
    providers: [
      NotificationService,
      WorkflowService,
      SupabaseService,
      ConfigService,
    ].map((provide) => ({ provide, useValue: {} })),
  }).compile();
  const app = module.createNestApplication();
  try {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Notifications').build(),
    );
    expect(doc.paths['/organization/invitations'].post).toBeDefined();
    expect(doc.paths['/organization/invitations/accept'].post).toBeDefined();
    expect(
      doc.paths['/organization/departments/{departmentId}/members'].put,
    ).toBeDefined();
    expect(doc.paths['/internal/notifications/process']).toBeUndefined();
    const schemas = doc.components!.schemas!;
    expect(schemas.NotificationPreferencesDto).toMatchObject({
      properties: {
        reminders: { type: 'boolean' },
        activityEmail: { type: 'string', enum: ['immediate', 'daily', 'off'] },
      },
    });
    expect(schemas.OrganizationInvitationDto).toMatchObject({
      required: ['email', 'roleIds'],
      properties: { roleIds: { type: 'array', items: { type: 'string' } } },
    });
    expect(schemas.InvitationResponseDto).toMatchObject({
      properties: { emailStatus: { example: 'queued' } },
    });
  } finally {
    await app.close();
  }
});

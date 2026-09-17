import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { TaskAttachmentsService } from './task-attachments.service';
import { EmployerWorkspaceService } from '../employer-workspace/employer-workspace.service';
import { SupabaseService } from '../supabase/supabase.service';

it('publishes the role wizard, file field, partial updates and response schemas', async () => {
  const module = await Test.createTestingModule({
    controllers: [WorkflowController],
    providers: [
      WorkflowService,
      TaskAttachmentsService,
      EmployerWorkspaceService,
      SupabaseService,
    ].map((provide) => ({ provide, useValue: {} })),
  }).compile();
  const app = module.createNestApplication();
  try {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').build(),
    );
    expect(document.paths['/organization/roles'].post).toBeDefined();
    expect(
      document.paths['/organization/members/{userId}/roles'].post,
    ).toBeDefined();
    const schemas = document.components!.schemas!;
    expect(schemas.CreateRoleDto).toMatchObject({ required: ['name'] });
    expect(schemas.UpdateRoleDto).not.toHaveProperty('required');
    expect(schemas.RoleRequirementsDto).toMatchObject({
      properties: { minYears: { type: 'number', minimum: 0 } },
    });
    expect(
      document.paths['/organization/tasks/{taskId}/attachments'].post!
        .requestBody,
    ).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
      },
    });
    expect(
      document.paths['/organization/roles/{roleId}'].get!.responses['200'],
    ).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/WorkflowRoleResponseDto' },
        },
      },
    });
  } finally {
    await app.close();
  }
});

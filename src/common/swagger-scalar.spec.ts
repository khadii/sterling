import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as icons from '../department-icons/icon.dto';
import * as workspace from '../employer-workspace/dto/employer-workspace.dto';
import * as responses from '../employer-workspace/dto/employer-workspace-response.dto';
import * as reference from '../reference/dto/reference-query.dto';
import * as geography from '../reference/dto/geography-response.dto';
import * as workflow from '../organization-workflow/workflow.dto';
import { CompanyDraftDto } from '../employer-onboarding/dto/company-draft.dto';

it('documents scalar defaults and nullable values without Object schemas', async () => {
  const module = await Test.createTestingModule({}).compile();
  const app = module.createNestApplication();
  try {
    const extraModels = [
      CompanyDraftDto,
      ...Object.values({
        ...icons,
        ...workspace,
        ...responses,
        ...reference,
        ...geography,
        ...workflow,
      }).filter(
        (value): value is typeof CompanyDraftDto => typeof value === 'function',
      ),
    ];
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Schema regression').build(),
      { extraModels },
    );
    const schemas = document.components!.schemas!;
    for (const name of [
      'IconQueryDto',
      'IndustryQueryDto',
      'WorkflowQueryDto',
    ]) {
      expect(schemas[name]).toMatchObject({
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      });
    }
    for (const name of ['ActivityQueryDto', 'SuggestionQueryDto']) {
      expect(schemas[name]).toMatchObject({
        properties: { limit: { type: 'integer' } },
      });
    }
    expect(schemas.CreateCalendarEventDto).toMatchObject({
      properties: { allDay: { type: 'boolean', default: false } },
    });
    expect(schemas.DepartmentQueryDto).toMatchObject({
      properties: { includeArchived: { type: 'boolean', default: false } },
    });
    expect(schemas.IconResponseDto).toMatchObject({
      properties: { url: { type: 'string', nullable: true } },
    });
    expect(schemas.CompanyDraftDto).toMatchObject({
      properties: { website: { type: 'string', nullable: true } },
    });
    expect(schemas.DepartmentMetricsResponseDto).toMatchObject({
      properties: {
        headcount: { type: 'number', example: 0 },
        attendancePercent: { type: 'number', nullable: true },
      },
    });
    expect(schemas.CountryReferenceDto).toMatchObject({
      properties: { phoneCode: { type: 'string', nullable: true } },
    });
    expect(schemas.RoleRequirementsDto).toMatchObject({ type: 'object' });
    expect(JSON.stringify(schemas)).not.toContain(
      '#/components/schemas/Object',
    );
  } finally {
    await app.close();
  }
});

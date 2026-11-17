import { Test } from '@nestjs/testing';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Server } from 'node:http';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RequestWithUser } from '../common/types/request-with-user.type';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

const actor = '8a53bff5-a952-4ad7-b466-730659020a8e';
const org = '2cd538d0-441c-42f3-816c-92495ad508f5';
const id = 'c1b1a1c4-1111-4222-8333-444455556666';

describe('Leave setup HTTP and Swagger', () => {
  it('routes policy lookup and partial saves with workspace context and documents all setup fields', async () => {
    const organization = jest.fn().mockResolvedValue(org);
    const policy = jest
      .fn()
      .mockResolvedValue({ id, name: 'Annual leave', daysPerYear: 0 });
    const settings = jest.fn().mockResolvedValue({
      organizationId: org,
      isConfigured: false,
      carryForwardStartMonth: null,
    });
    const saveSettings = jest.fn().mockResolvedValue({
      organizationId: org,
      isConfigured: true,
      managerNotifications: false,
    });
    const module = await Test.createTestingModule({
      controllers: [LeaveController],
      providers: [
        {
          provide: LeaveService,
          useValue: { organization, policy, settings, saveSettings },
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          ctx.switchToHttp().getRequest<RequestWithUser>().user = {
            id: actor,
            roles: [],
          };
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    try {
      const server = app.getHttpServer() as Server;
      await request(server)
        .get('/api/v1/employer/leave/policies/' + id)
        .set('X-Organization-Id', org)
        .expect(200)
        .expect(({ body }: { body: unknown }) => {
          expect(body).toMatchObject({ id, daysPerYear: 0 });
        });
      expect(policy).toHaveBeenCalledWith(actor, org, id);
      expect(organization).toHaveBeenCalledWith(actor, org);
      await request(server).get('/api/v1/employer/leave/settings').expect(200);
      await request(server)
        .patch('/api/v1/employer/leave/settings')
        .send({ managerNotifications: false, carryForwardEnabled: false })
        .expect(200);
      expect(saveSettings).toHaveBeenCalledWith(actor, org, {
        managerNotifications: false,
        carryForwardEnabled: false,
      });
      await request(server)
        .get('/api/v1/employer/leave/policies/invalid-id')
        .expect(400);
      await request(server)
        .patch('/api/v1/employer/leave/settings')
        .send({ carryForwardStartMonth: 13 })
        .expect(400);
      await request(server)
        .patch('/api/v1/employer/leave/settings')
        .send({ unknownToggle: true })
        .expect(400);
      expect(saveSettings).toHaveBeenCalledTimes(1);
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      expect(
        doc.paths['/api/v1/employer/leave/policies/{id}'].get,
      ).toBeDefined();
      expect(doc.components?.schemas?.LeaveSettingsDto).toMatchObject({
        properties: {
          carryForwardStartMonth: { minimum: 1, maximum: 12, nullable: true },
          carryForwardEndDay: { minimum: 1, maximum: 31 },
        },
      });
      expect(doc.components?.schemas?.LeaveSettingsResponseDto).toMatchObject({
        properties: {
          isConfigured: { type: 'boolean' },
          carryForwardEndMonth: { nullable: true },
        },
      });
    } finally {
      await app.close();
    }
  });
});

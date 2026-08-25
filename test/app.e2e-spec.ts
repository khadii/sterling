import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// Supertest's CommonJS export is callable when TypeScript esModuleInterop is disabled.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { Server } from 'node:http';
import { HealthModule } from '../src/health/health.module';

describe('Health (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  it('/health (GET)', () =>
    request(app.getHttpServer() as Server)
      .get('/health')
      .expect(200)
      .expect(({ body }: { body: { status: string } }) => {
        expect(body.status).toBe('ok');
      }));
});

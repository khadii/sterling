import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Vercel's file tracer cannot infer Swagger UI's dynamically resolved assets.
// Literal require.resolve calls keep the files inside the serverless bundle.
const swaggerUiAssets = [
  require.resolve('swagger-ui-dist/swagger-ui.css'),
  require.resolve('swagger-ui-dist/swagger-ui-bundle.js'),
  require.resolve('swagger-ui-dist/swagger-ui-standalone-preset.js'),
];
void swaggerUiAssets;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');

  app.use(helmet());
  const corsOrigins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  });
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.get<boolean>('ENABLE_SWAGGER', true)) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Sterling API')
        .setDescription('Recruitment platform API')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(
      config.get<string>('SWAGGER_PATH', 'docs'),
      app,
      document,
    );
  }
  await app.listen(config.get<number | string>('PORT', 3000));
}

bootstrap().catch((error: unknown) => {
  Logger.error(error, 'Application failed to start', 'Bootstrap');
  process.exit(1);
});

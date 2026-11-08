import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { AppError } from './common/errors.js';
import { AppExceptionFilter } from './common/http-exception.filter.js';
import { loadConfig } from './config/env.js';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
  const http = app.getHttpAdapter().getInstance() as { disable: (name: string) => void };
  http.disable('x-powered-by');
  app.use((request: Request & { requestId?: string }, _response: Response, next: NextFunction) => {
    const incoming = request.header('x-request-id');
    request.requestId = incoming && /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new AppError(400, 'validation_failed', 'Request validation failed.', {
          fields: errors.map((error) => error.property).join(','),
        }),
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Beekle Bridge adapter')
      .setDescription(
        'Local orchestration API for Bridge transfers. This is not the Bridge API. ' +
          'Account eligibility and commercial corridors are unconfirmed. The fake provider does not settle funds.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  app.getHttpAdapter().get('/openapi.json', (_request: unknown, response: { json: (body: unknown) => void }) => {
    response.json(document);
  });
  await app.init();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = loadConfig();
  await app.listen(config.port, '0.0.0.0');
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void bootstrap();
}

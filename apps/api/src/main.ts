import type { Request, Response } from 'express';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupSwagger } from './common/config/swagger';
import { logStartupReport } from './common/config/startup-report';
import { allowLargeLogoBody } from './common/config/body-limits';
import { applySecurityHeaders } from './common/config/security-headers';
import { ThrottleExceptionFilter } from './common/filters/throttle-exception.filter';
import { initSentry } from './common/sentry/sentry.setup';
import { SentryGlobalFilter } from './common/sentry/sentry-exception.filter';
import { SentryPerformanceInterceptor } from './common/sentry/sentry-performance.interceptor';
import { ApiLoggingInterceptor } from './common/interceptors/api-logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // Initialize Sentry before app creation
  initSentry();

  const app = await NestFactory.create(AppModule);
  // Security headers (helmet) before every route.
  applySecurityHeaders(app);
  // Logo (base64 ≈ 700,000 characters) — a larger body limit for that route only.
  allowLargeLogoBody(app);

  // Trust proxy (Railway/Render)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global filters & interceptors
  app.useGlobalFilters(new SentryGlobalFilter(), new ThrottleExceptionFilter());
  app.useGlobalInterceptors(new SentryPerformanceInterceptor(), new ApiLoggingInterceptor());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');

  // Health check for Railway (before Nest routing)
  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

  // Swagger — in production only with SWAGGER_ENABLED=true (common/config/swagger.ts)
  const swaggerOn = setupSwagger(app);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`🚀 API listening on http://localhost:${port}/api`);
  if (swaggerOn) logger.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  // The environment, Swagger, registration and a warning about a development setting.
  logStartupReport(logger);
}

bootstrap();

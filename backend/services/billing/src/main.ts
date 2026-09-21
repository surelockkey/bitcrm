import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing, installGracefulShutdown, runBootstrap } from '@bitcrm/shared';
initTracing('billing-service');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Nest's own body parser is replaced so the JSON limit can be raised.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  // Template saves carry the whole block tree.
  app.use(json({ limit: '4mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  // Client IPs for the portal rate limiter come from X-Forwarded-For.
  app.set('trust proxy', true);

  // `/portal/:token` is the redirect for portal links sent before the portal had its own domain.
  app.setGlobalPrefix('api/billing', { exclude: ['portal/:token'] });
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Billing Service')
    .setDescription(
      'Invoices, estimates, document templates + PDF rendering, business profile and the client portal',
    )
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/billing/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/billing/openapi', app, document);

  const port = process.env.BILLING_SERVICE_PORT || 4008;
  await app.listen(port);
  app.get(Logger).log(`Billing service running on http://localhost:${port}`);

  installGracefulShutdown(app);
}
runBootstrap(bootstrap);

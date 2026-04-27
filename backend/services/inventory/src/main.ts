import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing, shutdownTracing } from '@bitcrm/shared';
initTracing('inventory-service');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/inventory');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Inventory Service')
    .setDescription('Inventory and parts management')
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/inventory/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/inventory/openapi', app, document);

  const port = process.env.INVENTORY_SERVICE_PORT || 4004;
  await app.listen(port);
  app.get(Logger).log(`Inventory service running on http://localhost:${port}`);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      await app.close();
      await shutdownTracing();
      process.exit(0);
    });
  }
}
bootstrap();

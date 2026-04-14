import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/crm');
  app.enableCors();
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('CRM Service')
    .setDescription('Customer relationship management')
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use(
    '/api/crm/docs',
    apiReference({ spec: { content: document } }),
  );

  SwaggerModule.setup('api/crm/openapi', app, document);

  const port = process.env.CRM_SERVICE_PORT || 4002;
  await app.listen(port);
  app.get(Logger).log(`CRM service running on http://localhost:${port}`);
}
bootstrap();

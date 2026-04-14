import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/deals');
  app.enableCors();
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Deal Service')
    .setDescription('Deal management and tracking')
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/deals/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/deals/openapi', app, document);

  const port = process.env.DEAL_SERVICE_PORT || 4003;
  await app.listen(port);
  app.get(Logger).log(`Deal service running on http://localhost:${port}`);
}
bootstrap();

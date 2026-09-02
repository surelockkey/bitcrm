import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing,
  installGracefulShutdown,
  runBootstrap,
} from '@bitcrm/shared';
initTracing('search-service');

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/search');
  app.enableCors();
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Search Service')
    .setDescription('Global search across all BitCRM entities')
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/search/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/search/openapi', app, document);

  const port = process.env.SEARCH_SERVICE_PORT || 4005;
  await app.listen(port);
  app.get(Logger).log(`Search service running on http://localhost:${port}`);

  // Bounded: a half-open keep-alive connection can make app.close()
  // wait forever, and in a --watch loop nothing follows up with a kill.
  installGracefulShutdown(app);
}
runBootstrap(bootstrap);

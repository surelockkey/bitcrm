import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing,
  installGracefulShutdown,
  runBootstrap,
} from '@bitcrm/shared';
initTracing('messaging-service');

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

  app.setGlobalPrefix('api/messaging');
  app.enableCors();
  // Registered from day one (unlike crm/search/telephony) so every DTO
  // decorator is live and query numerics arrive coerced — see CLAUDE.md §10.
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Messaging Service')
    .setDescription(
      'Client inbox and team chat — SMS/MMS, email and in-app conversations, templates, opt-outs',
    )
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/messaging/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/messaging/openapi', app, document);

  const port = process.env.MESSAGING_SERVICE_PORT || 4007;
  await app.listen(port);
  app.get(Logger).log(`Messaging service running on http://localhost:${port}`);

  // Bounded: a half-open keep-alive connection can make app.close()
  // wait forever, and in a --watch loop nothing follows up with a kill.
  installGracefulShutdown(app);
}
runBootstrap(bootstrap);

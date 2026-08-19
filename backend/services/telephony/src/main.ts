import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing,
  installGracefulShutdown,
  runBootstrap,
} from '@bitcrm/shared';
initTracing('telephony-service');

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/telephony');
  app.enableCors();
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Telephony Service')
    .setDescription('Twilio voice — browser softphone tokens, inbound/outbound TwiML, call lifecycle')
    .setVersion('1.0')
    .addServer(process.env.API_GATEWAY_URL || 'http://localhost:4000')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  app.use('/api/telephony/docs', apiReference({ spec: { content: document } }));
  SwaggerModule.setup('api/telephony/openapi', app, document);

  const port = process.env.TELEPHONY_SERVICE_PORT || 4006;
  await app.listen(port);
  app.get(Logger).log(`Telephony service running on http://localhost:${port}`);

  // Bounded: a half-open keep-alive connection can make app.close()
  // wait forever, and in a --watch loop nothing follows up with a kill.
  installGracefulShutdown(app);
}
runBootstrap(bootstrap);

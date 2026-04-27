import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { initTracing, shutdownTracing } from '@bitcrm/shared';
initTracing('user-service');

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { apiReference } from "@scalar/nestjs-api-reference";
import { HttpExceptionFilter } from "@bitcrm/shared";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix("api/users");
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle("User Service")
    .setDescription("Users, roles, permissions, technician profiles")
    .setVersion("1.0")
    .addServer(process.env.API_GATEWAY_URL || "http://localhost:4000")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // Scalar API docs for this service
  app.use("/api/users/docs", apiReference({ spec: { content: document } }));

  // Raw OpenAPI JSON
  SwaggerModule.setup("api/users/openapi", app, document);

  const port = process.env.USER_SERVICE_PORT || 4001;
  await app.listen(port);
  app.get(Logger).log(`User service running on http://localhost:${port}`);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      await app.close();
      await shutdownTracing();
      process.exit(0);
    });
  }
}
bootstrap();

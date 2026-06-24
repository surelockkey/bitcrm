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

  // Unified /api/docs — same approach as backend/gateway/docs.html (the local
  // docker-compose gateway). Uses Scalar.createApiReference() directly against
  // the CDN-served @scalar/api-reference v1, which supports multi-source mode
  // out of the box. The browser fetches each /api/<svc>/openapi-json from the
  // same origin so ALB routes them to the right service.
  app.use("/api/docs", (_req: import("express").Request, res: import("express").Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
<head>
  <title>BitCRM API Docs</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>
    const baseUrl = window.location.origin;
    Scalar.createApiReference('#app', {
      sources: [
        { url: baseUrl + '/api/users/openapi-json',     title: 'User Service',      slug: 'users' },
        { url: baseUrl + '/api/crm/openapi-json',       title: 'CRM Service',       slug: 'crm' },
        { url: baseUrl + '/api/deals/openapi-json',     title: 'Deal Service',      slug: 'deals' },
        { url: baseUrl + '/api/inventory/openapi-json', title: 'Inventory Service', slug: 'inventory' },
      ],
      theme: 'default',
    });
  </script>
</body>
</html>`);
  });

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

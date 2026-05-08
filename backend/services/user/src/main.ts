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

  // Unified /api/docs — landing page linking to each per-service Scalar UI.
  // Multi-source mode in @scalar/nestjs-api-reference v0.3 doesn't line up
  // with the CDN'd @scalar/api-reference v1.x runtime, so we keep this
  // simple and reliable: each service's own /api/<svc>/docs already has the
  // full Scalar Try-It-Out experience.
  app.use("/api/docs", (_req: import("express").Request, res: import("express").Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BitCRM API</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
           max-width: 720px; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.5; }
    h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
    p.lead { color: #666; margin-top: 0; }
    ul { list-style: none; padding: 0; }
    li { margin: .5rem 0; }
    a.svc { display: flex; justify-content: space-between; align-items: center;
            padding: .85rem 1rem; background: #f6f6f6; border: 1px solid #e2e2e2;
            border-radius: 8px; text-decoration: none; color: inherit; }
    a.svc:hover { background: #ececec; }
    a.svc small { color: #888; font-family: ui-monospace, monospace; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: .9em; }
    @media (prefers-color-scheme: dark) {
      body { background: #11131e; color: #eee; }
      a.svc { background: #1c2132; border-color: #2f354a; }
      a.svc:hover { background: #242a40; }
      code { background: #1c2132; }
    }
  </style>
</head>
<body>
  <h1>BitCRM API</h1>
  <p class="lead">Pick a service to view its OpenAPI docs (full Scalar UI with Try-It-Out):</p>
  <ul>
    <li><a class="svc" href="/api/users/docs"><span>Users service</span><small>/api/users</small></a></li>
    <li><a class="svc" href="/api/crm/docs"><span>CRM service</span><small>/api/crm</small></a></li>
    <li><a class="svc" href="/api/deals/docs"><span>Deal service</span><small>/api/deals</small></a></li>
    <li><a class="svc" href="/api/inventory/docs"><span>Inventory service</span><small>/api/inventory</small></a></li>
  </ul>
  <p>Authenticate with a Cognito JWT in <code>Authorization: Bearer &lt;IdToken&gt;</code>.</p>
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

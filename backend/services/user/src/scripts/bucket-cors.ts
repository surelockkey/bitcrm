import type { CORSConfiguration } from '@aws-sdk/client-s3';

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Browser origins allowed to talk to the local uploads bucket directly
 * (presigned PUT uploads, logo/attachment GETs): `CORS_ORIGINS` and
 * `WEB_ORIGIN`, both comma-separated, else the local web app.
 */
export function corsOrigins(env: Record<string, string | undefined>): string[] {
  const origins = [env.CORS_ORIGINS, env.WEB_ORIGIN]
    .flatMap((v) => (v ?? '').split(','))
    .map((o) => o.trim())
    .filter(Boolean);
  const unique = [...new Set(origins)];
  return unique.length ? unique : [...DEFAULT_ORIGINS];
}

/** The whole CORS document — PutBucketCors replaces it, so re-running is idempotent. */
export function bucketCorsConfiguration(origins: string[]): CORSConfiguration {
  return {
    CORSRules: [
      {
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3000,
      },
    ],
  };
}

import { bucketCorsConfiguration, corsOrigins } from 'src/scripts/bucket-cors';

describe('local S3 bucket CORS', () => {
  it('defaults to the local web app origins', () => {
    expect(corsOrigins({})).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('reads comma-separated CORS_ORIGINS and WEB_ORIGIN, trimmed and deduplicated', () => {
    expect(
      corsOrigins({ CORS_ORIGINS: ' http://a.test , http://b.test,', WEB_ORIGIN: 'http://b.test,http://c.test' }),
    ).toEqual(['http://a.test', 'http://b.test', 'http://c.test']);
    expect(corsOrigins({ WEB_ORIGIN: 'http://web.test' })).toEqual(['http://web.test']);
    expect(corsOrigins({ CORS_ORIGINS: ' , ' })).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('allows browser GET/PUT/HEAD uploads with any header and exposes ETag', () => {
    expect(bucketCorsConfiguration(['http://localhost:3000'])).toEqual({
      CORSRules: [
        {
          AllowedOrigins: ['http://localhost:3000'],
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000,
        },
      ],
    });
  });
});

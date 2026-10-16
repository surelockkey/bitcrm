import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service } from '@bitcrm/shared';
import { PushModule } from '../../../src/push/push.module';
import { PushRepository } from '../../../src/push/push.repository';
import { PushTokensController } from '../../../src/push/push-tokens.controller';
import { PushTokensService } from '../../../src/push/push-tokens.service';

/** The platform globals AppModule provides (see outbound.module.spec.ts). */
@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send: jest.fn().mockResolvedValue({}) } } },
    { provide: S3Service, useValue: {} },
    { provide: RedisService, useValue: { client: { publish: jest.fn().mockResolvedValue(1), duplicate: jest.fn() } } },
    { provide: PermissionCacheReader, useValue: { get: jest.fn().mockResolvedValue(null) } },
  ],
  exports: [DynamoDbService, S3Service, RedisService, PermissionCacheReader],
})
class FakePlatformModule {}

describe('PushModule wiring', () => {
  it('resolves with only the platform globals and serves the token routes', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, PushModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(PushRepository)).toBeInstanceOf(PushRepository);
    expect(moduleRef.get(PushTokensService)).toBeInstanceOf(PushTokensService);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PushModule)).toContain(PushTokensController);

    await moduleRef.close();
  });

  it('is part of the messaging app', () => {
    const app = readFileSync(join(__dirname, '../../../src/app.module.ts'), 'utf8');
    expect(app).toMatch(/import \{ PushModule \} from '\.\/push\/push\.module';/);
    expect(app).toMatch(/^\s+PushModule,$/m);
  });
});

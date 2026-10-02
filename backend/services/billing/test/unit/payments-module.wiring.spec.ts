/* eslint-disable @typescript-eslint/no-explicit-any */
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service } from '@bitcrm/shared';
import { IntegrationsModule } from 'src/integrations/integrations.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { PaymentsService } from 'src/payments/payments.service';
import { StripeModule } from 'src/payments/stripe/stripe.module';
import { TerminalService } from 'src/payments/terminal/terminal.service';

/** The platform the real app gets from @bitcrm/shared, as inert stand-ins: nothing here may touch AWS or Redis. */
@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send: jest.fn() } } },
    { provide: RedisService, useValue: { client: { set: jest.fn(), get: jest.fn() } } },
    { provide: S3Service, useValue: {} },
    { provide: PermissionCacheReader, useValue: { getPermissions: jest.fn() } },
  ],
  exports: [DynamoDbService, RedisService, S3Service, PermissionCacheReader],
})
class PlatformStubs {}

/**
 * PaymentsModule as app.module composes it. Terminal pulls estimates,
 * companies and signatures into it — this proves Nest can resolve every
 * provider with those imports, and that none of them closes a module cycle.
 */
describe('PaymentsModule wiring', () => {
  it('resolves TerminalService with its estimates, companies and signatures', async () => {
    const mod = await Test.createTestingModule({
      imports: [PlatformStubs, IntegrationsModule, StripeModule.forRootAsync(), PaymentsModule],
    }).compile();
    const terminal = mod.get(TerminalService);
    expect(terminal).toBeInstanceOf(TerminalService);
    // The optional collaborators are really there, not silently undefined.
    expect((terminal as any).estimates).toBeDefined();
    expect((terminal as any).profiles).toBeDefined();
    expect((terminal as any).signatures).toBeDefined();
    await mod.close();
  });

  it('gives PaymentsService the companies (the receipt names the business)', async () => {
    const mod = await Test.createTestingModule({
      imports: [PlatformStubs, IntegrationsModule, StripeModule.forRootAsync(), PaymentsModule],
    }).compile();
    const payments = mod.get(PaymentsService);
    expect((payments as any).profiles).toBeDefined();
    expect((payments as any).messaging).toBeDefined();
    await mod.close();
  });
});

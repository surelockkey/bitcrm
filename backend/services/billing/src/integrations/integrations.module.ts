import { Global, Module } from '@nestjs/common';
import { CrmClient } from './crm.client';
import { DealClient } from './deal.client';
import { BillingEventsPublisher } from './billing-events.publisher';

@Global()
@Module({
  providers: [DealClient, CrmClient, BillingEventsPublisher],
  exports: [DealClient, CrmClient, BillingEventsPublisher],
})
export class IntegrationsModule {}

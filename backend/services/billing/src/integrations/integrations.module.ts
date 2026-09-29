import { Global, Module } from '@nestjs/common';
import { CrmClient } from './crm.client';
import { DealClient } from './deal.client';
import { BillingEventsPublisher } from './billing-events.publisher';
import { MessagingClient } from './messaging.client';

@Global()
@Module({
  providers: [DealClient, CrmClient, MessagingClient, BillingEventsPublisher],
  exports: [DealClient, CrmClient, MessagingClient, BillingEventsPublisher],
})
export class IntegrationsModule {}

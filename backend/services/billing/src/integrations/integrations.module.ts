import { Global, Module } from '@nestjs/common';
import { CrmClient } from './crm.client';
import { DealClient } from './deal.client';
import { BillingEventsPublisher } from './billing-events.publisher';
import { MessagingClient } from './messaging.client';
import { UserClient } from './user.client';

@Global()
@Module({
  providers: [DealClient, CrmClient, UserClient, MessagingClient, BillingEventsPublisher],
  exports: [DealClient, CrmClient, UserClient, MessagingClient, BillingEventsPublisher],
})
export class IntegrationsModule {}

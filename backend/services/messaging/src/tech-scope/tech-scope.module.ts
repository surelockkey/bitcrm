import { Module } from '@nestjs/common';
import { DealReadService } from '../api/access/deal-read.service';
import { TechScopeRepository } from './tech-scope.repository';
import { TechScopeService } from './tech-scope.service';

/**
 * The stored technician inbox scope (C4). Its own module, needing only the
 * platform's `DynamoDbService`, so the REST access layer (`AccessModule`)
 * and the event consumers (automations' job events, contact merges) share
 * one `TechScopeService` without pulling each other in. It keeps its own
 * `DealReadService` (stateless but for a 60 s cache; its writes read fresh).
 */
@Module({
  providers: [DealReadService, TechScopeRepository, TechScopeService],
  exports: [TechScopeService],
})
export class TechScopeModule {}

import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityRepository } from './activity.repository';
import { ActivityCountsRepository } from './activity-counts.repository';
import { ActivitySourceMiddleware } from './activity-source';

/**
 * Workiz Reports → Activity. Global so the timeline writer — provided in
 * DealsModule and elsewhere — can tick the day counters without every module
 * that writes a timeline event importing this one.
 */
@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityService, ActivityRepository, ActivityCountsRepository],
  exports: [ActivityCountsRepository],
})
export class ActivityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Where each request came from (web / mobile) — what a timeline event records.
    consumer.apply(ActivitySourceMiddleware).forRoutes('*');
  }
}

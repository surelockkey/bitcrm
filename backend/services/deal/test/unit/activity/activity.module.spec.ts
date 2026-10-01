import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, RedisService } from '@bitcrm/shared';
import { ActivityModule } from 'src/activity/activity.module';
import { ActivityController } from 'src/activity/activity.controller';
import { ActivityCountsRepository } from 'src/activity/activity-counts.repository';
import { TimelineRepository } from 'src/timeline/timeline.repository';
import { DealTotalsModule } from 'src/deal-totals/deal-totals.module';
import { DealTotalsController } from 'src/deal-totals/deal-totals.controller';
import { createMockTimelineEntry } from '../mocks';

const send = jest.fn(async () => ({}));

@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send } } },
    { provide: RedisService, useValue: { client: { get: jest.fn(), set: jest.fn() } } },
  ],
  exports: [DynamoDbService, RedisService],
})
class FakePlatformModule {}

/** A module elsewhere in the service that writes timeline events, as DealsModule does. */
@Module({ providers: [TimelineRepository], exports: [TimelineRepository] })
class WriterModule {}

describe('ActivityModule — the Nest wiring', () => {
  it('reaches the timeline writer in another module, so every event ticks its day', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakePlatformModule, ActivityModule, DealTotalsModule, WriterModule],
    }).compile();

    expect(moduleRef.get(ActivityController)).toBeDefined();
    expect(moduleRef.get(DealTotalsController)).toBeDefined();
    const writer = moduleRef.get(TimelineRepository);
    const counts = moduleRef.get(ActivityCountsRepository);
    const add = jest.spyOn(counts, 'add');

    await writer.addEntry(createMockTimelineEntry({ timestamp: '2026-09-30T14:00:00.000Z' }));

    expect(add).toHaveBeenCalledWith('2026-09-30', 1);
  });
});

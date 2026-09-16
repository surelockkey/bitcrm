import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { CountersRecountController } from '../../../src/counters/counters-recount.controller';
import { InternalGuard } from '../../../src/common/guards/internal.guard';
import { type CountersRecountService, type RecountResult } from '../../../src/counters/counters-recount.service';

const RESULT: RecountResult = {
  totalConversations: 42_657,
  totalByKind: { client: 42_423, team: 234 },
  archivedConversations: 2,
  recountedAt: '2026-09-16T12:00:00.000Z',
  partitions: 84,
  queries: 91,
  consumedRcu: 1_312.5,
  seconds: 4.2,
};

describe('CountersRecountController', () => {
  it('POST internal/counters/recount is internal: public to Cognito, gated by the internal secret', () => {
    const handler = CountersRecountController.prototype.post;
    expect(Reflect.getMetadata(PATH_METADATA, CountersRecountController)).toBe('internal/counters');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('recount');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([InternalGuard]);
  });

  it('answers with the rebuilt totals and what the rebuild cost', async () => {
    const recount = jest.fn().mockResolvedValue(RESULT);
    const controller = new CountersRecountController({ recount } as unknown as CountersRecountService);

    expect(await controller.post()).toEqual({ success: true, data: RESULT });
    expect(recount).toHaveBeenCalledTimes(1);
    // No body, no options: the operator cannot ask it to count a subset and
    // publish a partial total by accident.
    expect(recount).toHaveBeenCalledWith();
  });

  it('is callable again without a reset — the endpoint carries no state of its own', async () => {
    const recount = jest.fn().mockResolvedValue(RESULT);
    const controller = new CountersRecountController({ recount } as unknown as CountersRecountService);

    const a = await controller.post();
    const b = await controller.post();
    expect(a).toEqual(b);
    expect(recount).toHaveBeenCalledTimes(2);
  });
});

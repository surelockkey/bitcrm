import { PresenceService } from '../../src/presence/presence.service';
import { RedisService } from '@bitcrm/shared';

/** Minimal in-memory stand-in for the ioredis sorted-set commands we use. */
class FakeRedis {
  private zset = new Map<string, number>();
  async zadd(_key: string, score: number, member: string) {
    this.zset.set(member, score);
  }
  async zrem(_key: string, member: string) {
    this.zset.delete(member);
  }
  async zremrangebyscore(_key: string, min: number, max: number) {
    for (const [member, score] of this.zset) {
      if (score >= min && score <= max) this.zset.delete(member);
    }
  }
  async zrange(_key: string, _start: number, _stop: number) {
    return [...this.zset.keys()];
  }
}

function makeService() {
  const fake = new FakeRedis();
  const redis = { client: fake } as unknown as RedisService;
  return { service: new PresenceService(redis), fake };
}

describe('PresenceService', () => {
  it('lists an agent after they come online', async () => {
    const { service } = makeService();
    await service.setOnline('agent-1', 1000);
    expect(await service.listOnline(1500)).toEqual(['agent-1']);
  });

  it('drops an agent after their heartbeat expires', async () => {
    const { service } = makeService();
    await service.setOnline('agent-1', 1000); // expires at 1000 + ttl (5 min)
    // now well past expiry
    expect(await service.listOnline(1000 + 5 * 60_000 + 1)).toEqual([]);
  });

  it('removes an agent on explicit offline', async () => {
    const { service } = makeService();
    await service.setOnline('agent-1', 1000);
    await service.setOffline('agent-1');
    expect(await service.listOnline(1500)).toEqual([]);
  });
});

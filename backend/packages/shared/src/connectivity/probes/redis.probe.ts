import type Redis from 'ioredis';
import { Probe, ProbeKind, ProbeOutcome } from '../connectivity.types';

export class RedisProbe implements Probe {
  readonly name = 'redis';
  readonly kind: ProbeKind = 'redis';

  constructor(private readonly client: Pick<Redis, 'ping'>) {}

  async run(): Promise<ProbeOutcome> {
    const pong = await this.client.ping();
    if (pong !== 'PONG') {
      return { ok: false, error: `unexpected response: ${pong}` };
    }
    return { ok: true, message: 'PONG' };
  }
}

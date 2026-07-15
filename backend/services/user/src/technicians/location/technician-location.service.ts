import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type TechnicianLocation } from '@bitcrm/types';

const PREFIX = 'tech:location:';
/**
 * How long a fix stays "live". After this, the key expires and the technician
 * drops off the map back to their derived position — so someone who closed the
 * app doesn't hang frozen on the last spot they were seen.
 */
const TTL_SECONDS = 120;

export interface LocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Live technician positions, self-reported while online. Ephemeral by design —
 * stored in Redis with a short TTL, never in the durable profile. The dispatch
 * map reads these and falls back to the derived position when a technician has
 * none.
 */
@Injectable()
export class TechnicianLocationService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async setLocation(
    userId: string,
    input: LocationInput,
  ): Promise<TechnicianLocation> {
    const location: TechnicianLocation = {
      userId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      updatedAt: new Date().toISOString(),
    };

    await this.redis.client.set(
      this.key(userId),
      JSON.stringify(location),
      'EX',
      TTL_SECONDS,
    );

    return location;
  }

  async getLocation(userId: string): Promise<TechnicianLocation | null> {
    const raw = await this.redis.client.get(this.key(userId));
    return raw ? (JSON.parse(raw) as TechnicianLocation) : null;
  }

  async clearLocation(userId: string): Promise<void> {
    await this.redis.client.del(this.key(userId));
  }

  /** Every technician currently online, for the dispatch map. */
  async listLocations(): Promise<TechnicianLocation[]> {
    const keys = await this.redis.client.keys(`${PREFIX}*`);
    if (keys.length === 0) return [];

    const raw = await this.redis.client.mget(...keys);
    return raw
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as TechnicianLocation);
  }
}

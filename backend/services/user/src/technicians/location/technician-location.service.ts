import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type TechnicianLocation } from '@bitcrm/types';
import { TechniciansService } from '../technicians.service';

const PREFIX = 'tech:location:';

/**
 * How long the last fix outlives the last report. The dispatch map dims a pin
 * after 90 s and prints "Last seen" with where it was, so the expiry decides
 * nothing about online vs. away: it keeps a technician's last known position
 * through nights and weekends (owner, 2026-10-15 — "when and where he was
 * last") and lets one who stopped working leave the map by themselves. Still
 * one position per technician, never a history.
 */
export const LOCATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Keys per SCAN round trip — a hint to Redis, not a cap. */
const SCAN_COUNT = 200;

export interface LocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Technician positions, self-reported while the app is open.
 *
 * Every write and every read goes through one rule — the card's "Track
 * location", never a subcontractor (`TechniciansService.isLocationTracked`):
 * a fix from someone who is not tracked is accepted and dropped, and a key
 * that lingers for them is never listed.
 */
@Injectable()
export class TechnicianLocationService {
  constructor(
    private readonly redis: RedisService,
    private readonly technicians: TechniciansService,
  ) {}

  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  /**
   * Store the newest fix. `null` when the person is not tracked: nothing is
   * stored, and an earlier fix of theirs goes — a phone on an old build keeps
   * posting after the manager turns tracking off, and its last pin must not
   * sit on the map until it expires.
   */
  async setLocation(
    userId: string,
    input: LocationInput,
  ): Promise<TechnicianLocation | null> {
    if (!(await this.technicians.isLocationTracked(userId))) {
      await this.redis.client.del(this.key(userId));
      return null;
    }

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
      LOCATION_TTL_SECONDS,
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

  /** Every tracked technician with a live fix, for the dispatch map. */
  async listLocations(): Promise<TechnicianLocation[]> {
    const keys = await this.scanKeys();
    if (keys.length === 0) return [];

    const raw = await this.redis.client.mget(...keys);
    const stored = raw
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as TechnicianLocation);

    const tracked = await Promise.all(
      stored.map((location) => this.technicians.isLocationTracked(location.userId)),
    );
    return stored.filter((_, i) => tracked[i]);
  }

  /**
   * Every live-location key, a page at a time. KEYS walks the whole keyspace
   * in one call and blocks Redis for everyone while it does; SCAN may hand a
   * key back twice across pages, so the result is a set.
   */
  private async scanKeys(): Promise<string[]> {
    const found = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        `${PREFIX}*`,
        'COUNT',
        SCAN_COUNT,
      );
      for (const key of keys) found.add(key);
      cursor = next;
    } while (cursor !== '0');
    return [...found];
  }
}

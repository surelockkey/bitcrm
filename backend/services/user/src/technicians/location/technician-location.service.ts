import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import {
  type TechnicianLocation,
  type TechnicianLocationPoint,
} from '@bitcrm/types';
import { TechnicianLocationRepository } from './technician-location.repository';
import { TimeClockService } from '../timeclock/timeclock.service';
import { shouldKeepPoint, type TrackSample } from './technician-location.util';

const PREFIX = 'tech:location:';
const LAST_KEPT_PREFIX = 'tech:track:last:';

export interface LocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Technician positions, self-reported while online.
 *
 * Two things live here, answering different questions:
 *
 *  - **Presence** (Redis): the last known fix, kept indefinitely until the next
 *    one overwrites it, so the dispatch map always shows where a technician was
 *    last seen and how long ago. "Online" vs "last seen" is a question the
 *    reader answers from the timestamp — the record itself doesn't expire.
 *  - **Track** (DynamoDB, 30-day TTL): a sampled trail of where he has been,
 *    written only while he is clocked in. Off the clock nothing is persisted —
 *    the company has a reason to know where its paid hours went, and none to
 *    keep a map of the rest of a man's day.
 */
@Injectable()
export class TechnicianLocationService {
  private readonly logger = new Logger(TechnicianLocationService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly repository: TechnicianLocationRepository,
    private readonly timeClock: TimeClockService,
  ) {}

  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private lastKeptKey(userId: string): string {
    return `${LAST_KEPT_PREFIX}${userId}`;
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

    // No expiry — the last location is kept until a newer one replaces it.
    await this.redis.client.set(this.key(userId), JSON.stringify(location));

    await this.maybeKeepPoint(userId, location);

    return location;
  }

  async getLocation(userId: string): Promise<TechnicianLocation | null> {
    const raw = await this.redis.client.get(this.key(userId));
    return raw ? (JSON.parse(raw) as TechnicianLocation) : null;
  }

  async clearLocation(userId: string): Promise<void> {
    await this.redis.client.del(this.key(userId));
    // The sampling marker describes the live stream, not the stored trail:
    // dropping it means the next shift starts with a point instead of waiting
    // out an interval measured from yesterday.
    await this.redis.client.del(this.lastKeptKey(userId));
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

  /** One technician's stored trail over [from, to] (ISO instants), oldest first. */
  async listHistory(
    userId: string,
    from: string,
    to: string,
  ): Promise<TechnicianLocationPoint[]> {
    return this.repository.listInRange(userId, from, to);
  }

  /**
   * Decide whether this fix earns a stored row, and store it if so.
   *
   * The sampling marker lives in Redis so the decision costs no DynamoDB read
   * on the hot path — this endpoint is hit every few seconds per technician,
   * while the write below happens at most once a minute. The time-clock lookup
   * is paid only by fixes that survived sampling, so it is bounded by the same
   * rate.
   *
   * The marker is advanced whether or not the fix was stored, including when it
   * was dropped because the technician is off the clock. Otherwise a man who
   * leaves the app running after his shift never advances it, every ping looks
   * like the first fix of a shift, and the clock lookup below runs on every
   * ping instead of once a minute — a DynamoDB read every few seconds, per
   * technician, for a row we will not write. It also means a write that failed
   * is not retried on the next tick: one missing breadcrumb out of a sampled
   * trail is cheaper than hammering a throttled table every few seconds.
   *
   * A failure here never fails the presence update: the map is what dispatch is
   * looking at right now, and it must not go dark because a breadcrumb missed.
   */
  private async maybeKeepPoint(
    userId: string,
    location: TechnicianLocation,
  ): Promise<void> {
    try {
      const last = await this.readLastKept(userId);
      if (!shouldKeepPoint(last, location, location.updatedAt)) return;

      await this.markSampled(userId, location);

      const timeClockEntryId = await this.timeClock.openEntryId(userId);
      if (!timeClockEntryId) return;

      await this.repository.append({
        userId,
        recordedAt: location.updatedAt,
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        timeClockEntryId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record location point for ${userId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Remember where and when sampling last looked. This is the live stream's
   * own bookkeeping, not the stored trail: it holds the position Redis already
   * holds for presence, and nothing about a man off the clock reaches DynamoDB
   * because of it.
   */
  private async markSampled(
    userId: string,
    location: TechnicianLocation,
  ): Promise<void> {
    const marker: TrackSample = {
      lat: location.lat,
      lng: location.lng,
      at: location.updatedAt,
    };
    await this.redis.client.set(this.lastKeptKey(userId), JSON.stringify(marker));
  }

  private async readLastKept(userId: string): Promise<TrackSample | null> {
    const raw = await this.redis.client.get(this.lastKeptKey(userId));
    return raw ? (JSON.parse(raw) as TrackSample) : null;
  }
}

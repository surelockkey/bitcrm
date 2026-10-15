import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type TechnicianLocation } from '@bitcrm/types';
import { TechniciansService } from '../technicians.service';

const PREFIX = 'tech:location:';
/**
 * The phone's location setting, beside the position. Not a sub-key of
 * `tech:location:` on purpose: neither SCAN pattern may pick up the other's
 * keys (`tech:location:*` does not match `tech:location-state:…`).
 */
const STATE_PREFIX = 'tech:location-state:';

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

/** What the OS lets the app do with location: Expo's `PermissionStatus`. */
export const LOCATION_PERMISSIONS = ['granted', 'denied', 'undetermined'] as const;
export type LocationPermission = (typeof LOCATION_PERMISSIONS)[number];

export interface LocationStateInput {
  permission: LocationPermission;
  /** False when the phone gives only an approximate position (iOS "Precise Location" off). */
  precise?: boolean;
  /** Whether the app may read the location in the background ("Always"). */
  background?: boolean;
}

/**
 * Whether a technician's phone lets the app read its location (owner,
 * 2026-10-15): the dispatch map says "Location off on the phone" instead of
 * leaving a pin that simply stopped moving for the dispatcher to puzzle over.
 */
export interface TechnicianLocationState extends LocationStateInput {
  userId: string;
  /**
   * When the phone's state last CHANGED — a phone repeating the same state on
   * every launch keeps it, so "Location off · 25 min ago" counts from when it
   * went off.
   */
  updatedAt: string;
}

function sameState(a: LocationStateInput, b: LocationStateInput): boolean {
  return a.permission === b.permission && a.precise === b.precise && a.background === b.background;
}

/**
 * Technician positions, self-reported while the app is open — and, beside
 * them, whether the phone lets the app read its location at all.
 *
 * Every write and every read goes through one rule — the card's "Track
 * location", never a subcontractor (`TechniciansService.isLocationTracked`):
 * a fix (or a phone state) from someone who is not tracked is accepted and
 * dropped, and a key that lingers for them is never listed.
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

  private stateKey(userId: string): string {
    return `${STATE_PREFIX}${userId}`;
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

  /**
   * Go offline (sign-out): the position goes, and the phone's state with it —
   * signed out, the phone shares nothing for a reason that is not its
   * setting, and the map must not keep saying "Location off on the phone".
   */
  async clearLocation(userId: string): Promise<void> {
    await this.redis.client.del(this.key(userId), this.stateKey(userId));
  }

  /** Every tracked technician with a live fix, for the dispatch map. */
  async listLocations(): Promise<TechnicianLocation[]> {
    return this.listTracked<TechnicianLocation>(PREFIX);
  }

  /**
   * Store what the phone says about its location setting, kept as long as a
   * position (`LOCATION_TTL_SECONDS` after the last report). `null` when the
   * person is not tracked — a subcontractor, or Track location off: nothing
   * is stored and an earlier state of theirs goes, as with a fix.
   */
  async setLocationState(
    userId: string,
    input: LocationStateInput,
  ): Promise<TechnicianLocationState | null> {
    if (!(await this.technicians.isLocationTracked(userId))) {
      await this.redis.client.del(this.stateKey(userId));
      return null;
    }

    const previousRaw = await this.redis.client.get(this.stateKey(userId));
    const previous = previousRaw ? (JSON.parse(previousRaw) as TechnicianLocationState) : null;
    // Built field by field: only what the contract names is stored.
    const next: LocationStateInput = {
      permission: input.permission,
      ...(input.precise !== undefined && { precise: input.precise }),
      ...(input.background !== undefined && { background: input.background }),
    };
    const state: TechnicianLocationState = {
      userId,
      ...next,
      updatedAt:
        previous && sameState(previous, next) ? previous.updatedAt : new Date().toISOString(),
    };

    await this.redis.client.set(
      this.stateKey(userId),
      JSON.stringify(state),
      'EX',
      LOCATION_TTL_SECONDS,
    );

    return state;
  }

  /** Every tracked technician's phone state, for the dispatch map. */
  async listLocationStates(): Promise<TechnicianLocationState[]> {
    return this.listTracked<TechnicianLocationState>(STATE_PREFIX);
  }

  /**
   * Every value under a prefix whose owner is tracked: a key that lingers for
   * someone who no longer is (Track location switched off, a subcontractor)
   * is never listed.
   */
  private async listTracked<T extends { userId: string }>(prefix: string): Promise<T[]> {
    const keys = await this.scanKeys(prefix);
    if (keys.length === 0) return [];

    const raw = await this.redis.client.mget(...keys);
    const stored = raw.filter((v): v is string => v !== null).map((v) => JSON.parse(v) as T);

    const tracked = await Promise.all(
      stored.map((value) => this.technicians.isLocationTracked(value.userId)),
    );
    return stored.filter((_, i) => tracked[i]);
  }

  /**
   * Every key under a prefix, a page at a time. KEYS walks the whole keyspace
   * in one call and blocks Redis for everyone while it does; SCAN may hand a
   * key back twice across pages, so the result is a set.
   */
  private async scanKeys(prefix: string): Promise<string[]> {
    const found = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        SCAN_COUNT,
      );
      for (const key of keys) found.add(key);
      cursor = next;
    } while (cursor !== '0');
    return [...found];
  }
}

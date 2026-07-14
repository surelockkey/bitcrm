import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * The two address shapes in the platform differ (deals use `street`/`unit`,
 * technician home addresses use `line1`/`line2`), so callers flatten to this.
 */
export interface GeocodableAddress {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
}

const CACHE_PREFIX = 'geo:';
/** Addresses don't move. Long TTL keeps the backfill and re-saves off the meter. */
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
/**
 * Failures are cached too, or a typo'd address re-bills us on every save and on
 * every backfill pass. Short, because the miss may be a transient API blip and a
 * corrected address should be retried soon.
 */
const NEGATIVE_CACHE_TTL_SECONDS = 60 * 60;
const NEGATIVE = 'none';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Collapse case and whitespace so trivially different spellings share a cache entry. */
export function formatAddress(address: GeocodableAddress): string {
  return [address.street, address.unit, address.city, address.state, address.zip]
    .filter((part) => part && part.trim())
    .map((part) => part!.trim())
    .join(', ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Address → coordinates, via the Google Geocoding API, cached in Redis.
 *
 * Never throws: an address that cannot be resolved yields `null`. Geocoding is
 * an enrichment, not a precondition — a deal with an unresolvable address must
 * still save, it just won't appear on the dispatch map.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(private readonly redis: RedisService) {}

  async geocode(address: GeocodableAddress): Promise<Coordinates | null> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY is not set — skipping geocoding');
      return null;
    }

    const formatted = formatAddress(address);
    if (!formatted) return null;

    const cacheKey = `${CACHE_PREFIX}${formatted}`;
    const cached = await this.readCache(cacheKey);
    if (cached === NEGATIVE) return null;
    if (cached) return cached;

    const coords = await this.lookup(formatted, apiKey);
    if (!coords) {
      await this.writeCache(cacheKey, NEGATIVE, NEGATIVE_CACHE_TTL_SECONDS);
      return null;
    }

    await this.writeCache(cacheKey, coords, CACHE_TTL_SECONDS);
    return coords;
  }

  private async lookup(
    formatted: string,
    apiKey: string,
  ): Promise<Coordinates | null> {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(formatted)}&key=${apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(
          `Geocoding failed for "${formatted}": HTTP ${response.status}`,
        );
        return null;
      }

      const body = (await response.json()) as {
        status: string;
        results?: Array<{ geometry?: { location?: Coordinates } }>;
      };

      const location = body.results?.[0]?.geometry?.location;
      if (body.status !== 'OK' || !location) {
        this.logger.warn(
          `Geocoding returned ${body.status} for "${formatted}"`,
        );
        return null;
      }

      return { lat: location.lat, lng: location.lng };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Geocoding errored for "${formatted}": ${message}`);
      return null;
    }
  }

  /** Coordinates, the NEGATIVE sentinel for a known-unresolvable address, or null on a miss. */
  private async readCache(
    key: string,
  ): Promise<Coordinates | typeof NEGATIVE | null> {
    try {
      const hit = await this.redis.client.get(key);
      if (!hit) return null;
      if (hit === NEGATIVE) return NEGATIVE;
      return JSON.parse(hit) as Coordinates;
    } catch {
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: Coordinates | typeof NEGATIVE,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      const payload = value === NEGATIVE ? NEGATIVE : JSON.stringify(value);
      await this.redis.client.set(key, payload, 'EX', ttlSeconds);
    } catch {
      // A cold cache is a cost problem, not a correctness one.
    }
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, tryNormalizePhone } from '@bitcrm/shared';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';
import { NumbersService } from '../numbers/numbers.service';

/**
 * Workspace telephony settings. ONE row, deliberately.
 *
 *   PK = 'TELEPHONY#SETTINGS', SK = 'METADATA'
 *
 * "Only one number may be the technician line" is a constraint that is far
 * easier to hold as a shape than to enforce: a single row can only name a
 * single number, so setting a new one clears the old one without a sweep, a
 * transaction, or a uniqueness index that could drift. The account's fallback
 * number (Workiz's "Fallback Number" on the Call flows tab) sits on the same
 * row for the same reason.
 */
const SETTINGS_PK = 'TELEPHONY#SETTINGS';
const SETTINGS_SK = 'METADATA';

/**
 * Short. This is read on the inbound hot path, so it must not be a round trip
 * per call — but an operator who has just designated a line should see it take
 * effect while they are still looking at the screen.
 */
const CACHE_TTL_MS = 30_000;

export interface TelephonySettings {
  /** The shared line technicians dial in on, E.164, or null when unset. */
  technicianLine: string | null;
  /**
   * Where a call goes when its flow ends unanswered, or when a number with no
   * usable flow finds nobody online — E.164, or null when unset. Any phone
   * number: calls LEAVE to it, so it is not one of ours by design.
   */
  fallbackNumber: string | null;
}

@Injectable()
export class TelephonySettingsService {
  private readonly logger = new Logger(TelephonySettingsService.name);
  private cache: { value: TelephonySettings; expiresAt: number } | null = null;

  constructor(
    private readonly dynamoDb: DynamoDbService,
    private readonly numbers: NumbersService,
  ) {}

  async get(): Promise<TelephonySettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;

    try {
      const res = await this.dynamoDb.client.send(
        new GetCommand({
          TableName: CALLS_TABLE,
          Key: { PK: SETTINGS_PK, SK: SETTINGS_SK },
        }),
      );
      const value: TelephonySettings = {
        technicianLine: (res.Item?.technicianLine as string | undefined) ?? null,
        fallbackNumber: (res.Item?.fallbackNumber as string | undefined) ?? null,
      };
      this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } catch (error) {
      this.logger.warn(
        `Could not read telephony settings: ${error instanceof Error ? error.message : error}`,
      );
      // Serve the last known answer rather than silently "unset" — treating a
      // blip as "there is no technician line" would send callers down the
      // ring-everyone fallback the guard exists to prevent.
      return this.cache?.value ?? { technicianLine: null, fallbackNumber: null };
    }
  }

  /** The shared technician line, or null. */
  async technicianLine(): Promise<string | null> {
    return (await this.get()).technicianLine;
  }

  /** The account's fallback number, or null. */
  async fallbackNumber(): Promise<string | null> {
    return (await this.get()).fallbackNumber;
  }

  /**
   * Designate a number as the technician line, or clear it with null.
   *
   * Validated against the numbers the workspace actually owns: caller id is
   * never checked at dial time, so a number we do not hold would surface weeks
   * later as a technician whose call simply fails.
   */
  async setTechnicianLine(phoneNumber: string | null): Promise<TelephonySettings> {
    let normalized: string | null = null;

    if (phoneNumber) {
      normalized = tryNormalizePhone(phoneNumber);
      if (!normalized) {
        throw new BadRequestException(`${phoneNumber} is not a valid phone number`);
      }
      const owned = await this.numbers.listOwned().catch(() => []);
      if (owned.length && !owned.some((n) => n.phoneNumber === normalized)) {
        throw new BadRequestException(
          'That number does not belong to this workspace',
        );
      }
    }

    await this.write('technicianLine', normalized);
    this.logger.log(
      normalized
        ? `Technician line set to ${normalized}`
        : 'Technician line cleared',
    );
    return { ...(await this.get()), technicianLine: normalized };
  }

  /**
   * Set the account's fallback number, or clear it with null. Not checked
   * against the owned numbers — it is the owner's mobile or an answering
   * service, somewhere calls go OUT to.
   */
  async setFallbackNumber(phoneNumber: string | null): Promise<TelephonySettings> {
    let normalized: string | null = null;
    if (phoneNumber) {
      normalized = tryNormalizePhone(phoneNumber);
      if (!normalized) {
        throw new BadRequestException(`${phoneNumber} is not a valid phone number`);
      }
    }

    await this.write('fallbackNumber', normalized);
    this.logger.log(
      normalized ? `Fallback number set to ${normalized}` : 'Fallback number cleared',
    );
    return { ...(await this.get()), fallbackNumber: normalized };
  }

  /** One attribute of the row, set or removed, with the memo dropped. */
  private async write(
    attribute: 'technicianLine' | 'fallbackNumber',
    value: string | null,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: CALLS_TABLE,
        Key: { PK: SETTINGS_PK, SK: SETTINGS_SK },
        ...(value
          ? {
              UpdateExpression: `SET ${attribute} = :n, updatedAt = :now`,
              ExpressionAttributeValues: {
                ':n': value,
                ':now': new Date().toISOString(),
              },
            }
          : {
              UpdateExpression: `REMOVE ${attribute} SET updatedAt = :now`,
              ExpressionAttributeValues: { ':now': new Date().toISOString() },
            }),
      }),
    );
    this.cache = null;
  }

  /** Drop the memo — used after a number is released out from under us. */
  forget(): void {
    this.cache = null;
  }
}

import { Injectable, Logger } from '@nestjs/common';

const DEAL_SERVICE_URL =
  process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

export interface CallLinkRecord {
  callSid: string;
  linked: boolean;
  actorId: string;
  actorName?: string;
  details: Record<string, unknown>;
}

/**
 * Tells a job that a call was attached to it, so the call shows up in the
 * job's activity feed next to everything else that happened — recording
 * included.
 *
 * Best-effort by design: the link itself lives on the call record, so a
 * deal-service hiccup costs a timeline entry, not the link.
 */
@Injectable()
export class DealLinkService {
  private readonly logger = new Logger(DealLinkService.name);

  async record(dealId: string, entry: CallLinkRecord): Promise<void> {
    if (!dealId) return;
    try {
      const res = await fetch(
        `${DEAL_SERVICE_URL}/api/deals/${dealId}/call-link`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify(entry),
        },
      );
      if (!res.ok) {
        this.logger.warn(`call-link on deal ${dealId} returned ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `call-link on deal ${dealId} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

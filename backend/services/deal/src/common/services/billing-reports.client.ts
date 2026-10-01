import { BadGatewayException, Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { BusinessMetricsService } from '@bitcrm/shared';
import { BILLING_SERVICE_URL, INTERNAL_SERVICE_SECRET } from '../constants/services.constants';

const TIMEOUT_MS = 30_000;

/**
 * Billing's internal reads for the deal service's reports:
 *   GET /api/billing/reports/internal/paid-by-job?from&to → [{ dealId, paid }]
 *
 * Unlike the company list, a report cannot carry on without its numbers: a
 * failed read is a 502, never an empty (and silently wrong) Paid tab.
 */
@Injectable()
export class BillingReportsClient {
  private readonly logger = new Logger(BillingReportsClient.name);
  private readonly client: AxiosInstance;

  constructor(@Optional() private readonly businessMetrics?: BusinessMetricsService) {
    this.client = axios.create({
      baseURL: BILLING_SERVICE_URL,
      headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET },
      timeout: TIMEOUT_MS,
    });
  }

  async paidByJob(from: string, to: string): Promise<Array<{ dealId: string; paid: number }>> {
    const timer = this.businessMetrics?.internalHttpDuration?.startTimer({ target_service: 'billing', operation: 'paidByJob' });
    try {
      const res = await this.client.get('/api/billing/reports/internal/paid-by-job', { params: { from, to } });
      return (res?.data?.data ?? []) as Array<{ dealId: string; paid: number }>;
    } catch (error) {
      this.businessMetrics?.internalHttpErrors?.inc({ target_service: 'billing', operation: 'paidByJob' });
      this.logger.warn(`Billing paid-by-job unavailable: ${(error as Error).message}`);
      throw new BadGatewayException('Payments are unavailable right now — try again');
    } finally {
      timer?.();
    }
  }
}

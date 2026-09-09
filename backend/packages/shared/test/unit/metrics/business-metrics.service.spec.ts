import { BusinessMetricsService } from '../../../src/metrics/business-metrics.service';
import { MetricsService } from '../../../src/metrics/metrics.service';

describe('BusinessMetricsService', () => {
  let metrics: MetricsService;
  let business: BusinessMetricsService;

  beforeEach(() => {
    metrics = new MetricsService('test-service');
    business = new BusinessMetricsService(metrics);
  });

  const scrape = () => metrics.getMetrics();

  /** Matches one sample regardless of label order (the registry prepends
   *  its default `service` label, so positions are not stable). */
  const sample = (out: string, name: string, labels: Record<string, string>) =>
    out
      .split('\n')
      .filter((l) => l.startsWith(`${name}{`))
      .find((l) =>
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)),
      );

  describe('search metrics', () => {
    // SearchService already calls `searchQueryDuration.startTimer()`; before
    // this existed the call was cast through `any` and silently did nothing,
    // so search latency never reached Prometheus.
    it('records query duration by mode', async () => {
      const done = business.searchQueryDuration.startTimer({ mode: 'quick' });
      done();

      const out = await scrape();
      expect(out).toContain('bitcrm_search_query_duration_seconds_count');
      expect(out).toContain('mode="quick"');
    });

    it('counts query errors by mode', async () => {
      business.searchQueryErrors.inc({ mode: 'full' });

      expect(
        sample(await scrape(), 'bitcrm_search_query_errors_total', {
          mode: 'full',
        }),
      ).toMatch(/ 1$/);
    });

    it('counts index operations by type, operation and status', async () => {
      business.searchIndexOperations.inc({
        type: 'deal',
        operation: 'upsert',
        status: 'success',
      });

      const out = await scrape();
      expect(out).toContain('bitcrm_search_index_operations_total');
      expect(out).toContain('type="deal"');
      expect(out).toContain('operation="upsert"');
      expect(out).toContain('status="success"');
    });
  });

  describe('telephony metrics', () => {
    it('counts answered calls by direction', async () => {
      business.callsAnswered.inc({ direction: 'inbound' });

      expect(
        sample(await scrape(), 'bitcrm_calls_answered_total', {
          direction: 'inbound',
        }),
      ).toMatch(/ 1$/);
    });

    it('counts completed calls by direction and status', async () => {
      business.callsCompleted.inc({ direction: 'outbound', status: 'no-answer' });

      const out = await scrape();
      expect(out).toContain('bitcrm_calls_completed_total');
      expect(out).toContain('direction="outbound"');
      expect(out).toContain('status="no-answer"');
    });

    it('observes call talk time by direction', async () => {
      business.callDuration.observe({ direction: 'inbound' }, 42);

      expect(
        sample(await scrape(), 'bitcrm_call_duration_seconds_sum', {
          direction: 'inbound',
        }),
      ).toMatch(/ 42$/);
    });

    // Call talk time runs to minutes, not the sub-second web-request range the
    // prom-client default buckets cover, so it gets its own buckets.
    it('uses call-length buckets rather than the sub-second defaults', async () => {
      business.callDuration.observe({ direction: 'inbound' }, 300);

      const out = await scrape();
      expect(out).toContain('bitcrm_call_duration_seconds_bucket');
      expect(out).toContain('le="600"');
    });
  });

  it('keeps the pre-existing metrics registered', async () => {
    business.entityCreated.inc({ entity_type: 'deal' });
    business.eventsPublished.inc({ event_type: 'deal.created' });
    business.stockDeductions.inc();

    const out = await scrape();
    expect(out).toContain('bitcrm_entity_created_total');
    expect(out).toContain('bitcrm_events_published_total');
    expect(out).toContain('bitcrm_stock_deductions_total');
  });
});

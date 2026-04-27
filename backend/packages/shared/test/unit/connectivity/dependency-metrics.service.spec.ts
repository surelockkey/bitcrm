import { DependencyMetricsService } from '../../../src/connectivity/dependency-metrics.service';
import { MetricsService } from '../../../src/metrics/metrics.service';
import { ProbeResult } from '../../../src/connectivity/connectivity.types';

const makeMetricsService = (): MetricsService =>
  new MetricsService('test-service');

const readGauge = async (
  metrics: MetricsService,
  metricName: string,
  matchLabels: Record<string, string>,
): Promise<number | undefined> => {
  const json = await metrics.registry.getMetricsAsJSON();
  const m = json.find((x) => x.name === metricName);
  if (!m) return undefined;
  const value = (m.values as Array<{ value: number; labels: Record<string, string> }>).find(
    (v) =>
      Object.entries(matchLabels).every(([k, val]) => v.labels[k] === val),
  );
  return value?.value;
};

describe('DependencyMetricsService', () => {
  it('sets up=1 for ok probes without resources', async () => {
    const metrics = makeMetricsService();
    const dep = new DependencyMetricsService(metrics);

    const results: ProbeResult[] = [
      { name: 'redis', kind: 'redis', ok: true, durationMs: 5, message: 'PONG' },
    ];
    dep.update('inventory-service', results);

    const v = await readGauge(metrics, 'bitcrm_dependency_up', {
      service: 'inventory-service',
      name: 'redis',
      kind: 'redis',
      resource: '',
    });
    expect(v).toBe(1);
  });

  it('sets up=0 for failed probes', async () => {
    const metrics = makeMetricsService();
    const dep = new DependencyMetricsService(metrics);

    dep.update('inventory-service', [
      { name: 'redis', kind: 'redis', ok: false, durationMs: 12, error: 'down' },
    ]);

    const v = await readGauge(metrics, 'bitcrm_dependency_up', {
      service: 'inventory-service',
      name: 'redis',
      kind: 'redis',
      resource: '',
    });
    expect(v).toBe(0);
  });

  it('emits one up gauge per resource when probe reports resources', async () => {
    const metrics = makeMetricsService();
    const dep = new DependencyMetricsService(metrics);

    dep.update('inventory-service', [
      {
        name: 'sqs',
        kind: 'sqs',
        ok: false,
        durationMs: 5,
        resources: [
          { resource: 'q-good', present: true },
          { resource: 'q-missing', present: false, details: 'NotFound' },
        ],
      },
    ]);

    expect(
      await readGauge(metrics, 'bitcrm_dependency_up', {
        service: 'inventory-service',
        name: 'sqs',
        kind: 'sqs',
        resource: 'q-good',
      }),
    ).toBe(1);
    expect(
      await readGauge(metrics, 'bitcrm_dependency_up', {
        service: 'inventory-service',
        name: 'sqs',
        kind: 'sqs',
        resource: 'q-missing',
      }),
    ).toBe(0);
  });

  it('records last-check timestamp and increments check counter', async () => {
    const metrics = makeMetricsService();
    const dep = new DependencyMetricsService(metrics);

    dep.update('user-service', [
      { name: 'redis', kind: 'redis', ok: true, durationMs: 3 },
    ]);

    const ts = await readGauge(metrics, 'bitcrm_dependency_last_check_timestamp', {
      service: 'user-service',
      name: 'redis',
      kind: 'redis',
    });
    expect(ts).toBeGreaterThan(1_700_000_000);

    const json = await metrics.registry.getMetricsAsJSON();
    const counter = json.find((m) => m.name === 'bitcrm_dependency_checks_total');
    expect(counter).toBeDefined();
    const okCount = (counter!.values as Array<{ value: number; labels: Record<string, string> }>).find(
      (v) => v.labels.status === 'ok',
    );
    expect(okCount?.value).toBe(1);
  });
});

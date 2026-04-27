import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import { ProbeResult } from './connectivity.types';

@Injectable()
export class DependencyMetricsService {
  private readonly up: Gauge;
  private readonly duration: Histogram;
  private readonly lastCheck: Gauge;
  private readonly checks: Counter;

  constructor(metrics: MetricsService) {
    this.up = metrics.createGauge(
      'bitcrm_dependency_up',
      'Dependency reachable (1) or unreachable / required resource missing (0)',
      ['service', 'name', 'kind', 'resource'],
    );
    this.duration = metrics.createHistogram(
      'bitcrm_dependency_check_duration_seconds',
      'Connectivity probe duration in seconds',
      ['service', 'name', 'kind'],
    );
    this.lastCheck = metrics.createGauge(
      'bitcrm_dependency_last_check_timestamp',
      'Unix timestamp of the last connectivity probe',
      ['service', 'name', 'kind'],
    );
    this.checks = metrics.createCounter(
      'bitcrm_dependency_checks_total',
      'Total connectivity probe runs',
      ['service', 'name', 'kind', 'status'],
    );
  }

  update(service: string, results: ProbeResult[]): void {
    const now = Math.floor(Date.now() / 1000);
    for (const r of results) {
      const baseLabels = { service, name: r.name, kind: r.kind };
      this.lastCheck.set(baseLabels, now);
      this.duration.observe(baseLabels, r.durationMs / 1000);
      this.checks.inc({ ...baseLabels, status: r.ok ? 'ok' : 'fail' });

      if (r.resources && r.resources.length > 0) {
        for (const res of r.resources) {
          this.up.set(
            { ...baseLabels, resource: res.resource },
            res.present ? 1 : 0,
          );
        }
      } else {
        this.up.set({ ...baseLabels, resource: '' }, r.ok ? 1 : 0);
      }
    }
  }
}

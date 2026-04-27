import { Injectable, Inject } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';
import { METRICS_SERVICE_NAME } from './metrics.constants';

@Injectable()
export class MetricsService {
  public readonly registry: Registry;

  constructor(@Inject(METRICS_SERVICE_NAME) serviceName: string) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: serviceName });
    collectDefaultMetrics({ register: this.registry });
  }

  createCounter(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Counter {
    return new Counter({ name, help, labelNames, registers: [this.registry] });
  }

  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[],
  ): Histogram {
    return new Histogram({
      name,
      help,
      labelNames,
      ...(buckets && { buckets }),
      registers: [this.registry],
    });
  }

  createGauge(
    name: string,
    help: string,
    labelNames: string[] = [],
  ): Gauge {
    return new Gauge({ name, help, labelNames, registers: [this.registry] });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}

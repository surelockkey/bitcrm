import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  ConnectivityOptions,
  Probe,
  ProbeKind,
  ProbeResult,
} from './connectivity.types';
import { DependencyMetricsService } from './dependency-metrics.service';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 30_000;

@Injectable()
export class ConnectivityCheckService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Connectivity');
  private timer: NodeJS.Timeout | null = null;
  private lastResults: ProbeResult[] = [];
  private lastRunAt: number | null = null;

  constructor(
    private readonly probes: Probe[],
    private readonly options: Partial<ConnectivityOptions> = {},
    private readonly metrics?: DependencyMetricsService,
  ) {}

  async runAll(): Promise<ProbeResult[]> {
    const timeoutMs = this.options.probeTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const results = await Promise.all(
      this.probes.map((p) => this.runOne(p, timeoutMs)),
    );
    this.lastResults = results;
    this.lastRunAt = Date.now();
    return results;
  }

  getSnapshot(): { results: ProbeResult[]; lastRunAt: number | null } {
    return { results: this.lastResults, lastRunAt: this.lastRunAt };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.probes.length === 0) return;
    const results = await this.runAll();
    this.logSummary(results);
    this.metrics?.update(this.options.serviceName ?? 'unknown', results);
    this.failFastIfNeeded(results);
    this.startPeriodic();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startPeriodic(): void {
    const intervalMs = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = setInterval(async () => {
      try {
        const results = await this.runAll();
        this.metrics?.update(this.options.serviceName ?? 'unknown', results);
        const downCount = results.filter((r) => !r.ok).length;
        if (downCount > 0) {
          this.logger.warn(
            `Periodic check: ${downCount}/${results.length} dependencies degraded`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Periodic connectivity check failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }, intervalMs);
    this.timer.unref?.();
  }

  private failFastIfNeeded(results: ProbeResult[]): void {
    const failFast = this.options.failFast ?? [];
    if (failFast.length === 0) return;
    const fatal = results.filter(
      (r) => !r.ok && failFast.includes(r.kind as ProbeKind),
    );
    if (fatal.length === 0) return;

    const summary = fatal
      .map((f) => `${f.kind}/${f.name} (${f.error ?? 'down'})`)
      .join(', ');
    this.logger.error(
      `Required dependency unreachable, refusing to start: ${summary}`,
    );
    process.exit(1);
  }

  private logSummary(results: ProbeResult[]): void {
    const service = this.options.serviceName ?? 'unknown';
    const lines: string[] = [];
    lines.push('');
    lines.push(`┌─ Connectivity Report (${service}) ${'─'.repeat(30)}`);
    for (const r of results) {
      const icon = r.ok ? '✓' : '✗';
      const dur = `${r.durationMs}ms`.padStart(7);
      const detail = r.ok ? r.message ?? '' : r.error ?? r.message ?? '';
      lines.push(
        `│ ${icon} ${r.kind.padEnd(8)} ${dur}  ${r.name.padEnd(12)} ${detail}`,
      );
      if (r.resources) {
        for (const res of r.resources) {
          if (!res.present) {
            const why = res.details ? ` (${res.details})` : '';
            lines.push(`│     ✗ missing: ${res.resource}${why}`);
          }
        }
      }
    }
    lines.push(`└${'─'.repeat(60)}`);
    const issues = results.filter((r) => !r.ok).length;
    lines.push(
      `Boot status: ${
        issues === 0 ? 'healthy' : `degraded (${issues} issue${issues === 1 ? '' : 's'})`
      }`,
    );
    if (issues === 0) {
      this.logger.log(lines.join('\n'));
    } else {
      this.logger.warn(lines.join('\n'));
    }
  }

  private async runOne(probe: Probe, timeoutMs: number): Promise<ProbeResult> {
    const start = Date.now();
    let timer: NodeJS.Timeout | null = null;

    try {
      const outcome = await Promise.race([
        probe.run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      return {
        name: probe.name,
        kind: probe.kind,
        durationMs: Date.now() - start,
        ...outcome,
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      return {
        name: probe.name,
        kind: probe.kind,
        durationMs: Date.now() - start,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

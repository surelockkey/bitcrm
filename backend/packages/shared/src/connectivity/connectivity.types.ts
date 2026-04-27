export type ProbeKind = 'dynamodb' | 'redis' | 's3' | 'sns' | 'sqs' | 'http';

export interface ProbeResourceStatus {
  resource: string;
  present: boolean;
  details?: string;
}

export interface ProbeOutcome {
  ok: boolean;
  message?: string;
  error?: string;
  resources?: ProbeResourceStatus[];
}

export interface ProbeResult extends ProbeOutcome {
  name: string;
  kind: ProbeKind;
  durationMs: number;
}

export interface Probe {
  readonly name: string;
  readonly kind: ProbeKind;
  run(): Promise<ProbeOutcome>;
}

export interface HttpServiceTarget {
  name: string;
  url: string;
}

export interface ConnectivityOptions {
  serviceName: string;
  failFast?: ProbeKind[];
  intervalMs?: number;
  probeTimeoutMs?: number;
  dynamodb?: { tables?: string[]; endpoint?: string; region?: string };
  redis?: boolean | { url?: string };
  s3?: { buckets: string[]; endpoint?: string; region?: string };
  sns?: { topics: string[]; endpoint?: string; region?: string };
  sqs?: { queues: string[]; endpoint?: string; region?: string };
  httpServices?: HttpServiceTarget[];
}

export const CONNECTIVITY_OPTIONS = Symbol('CONNECTIVITY_OPTIONS');
export const CONNECTIVITY_PROBES = Symbol('CONNECTIVITY_PROBES');

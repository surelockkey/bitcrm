export type ProbeKind =
  | 'dynamodb'
  | 'redis'
  | 's3'
  | 'sns'
  | 'sqs'
  | 'http'
  | 'opensearch';

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
  /**
   * Peer services boot alongside this one, so at boot an `http` probe often
   * fails only because the peer is not listening yet. When peers are the only
   * failures, the boot report is held and they are re-probed every
   * `peerSettleIntervalMs` until they answer or `peerSettleTimeoutMs` passes.
   */
  peerSettleIntervalMs?: number;
  peerSettleTimeoutMs?: number;
  dynamodb?: { tables?: string[]; endpoint?: string; region?: string };
  redis?: boolean | { url?: string };
  s3?: { buckets: string[]; endpoint?: string; region?: string };
  sns?: { topics: string[]; endpoint?: string; region?: string };
  sqs?: { queues: string[]; endpoint?: string; region?: string };
  opensearch?: { url?: string; indices?: string[] };
  httpServices?: HttpServiceTarget[];
}

export const CONNECTIVITY_OPTIONS = Symbol('CONNECTIVITY_OPTIONS');
export const CONNECTIVITY_PROBES = Symbol('CONNECTIVITY_PROBES');

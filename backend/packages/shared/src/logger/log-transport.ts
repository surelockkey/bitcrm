/** Shape pino accepts for `transport` — a single target or a fan-out. */
export interface LogTransport {
  target?: string;
  options?: Record<string, unknown>;
  targets?: { target: string; options: Record<string, unknown>; level?: string }[];
}

export interface LogTransportEnv {
  isProduction: boolean;
  /** LOKI_URL. Unset (or blank) leaves logs on stdout only. */
  lokiUrl?: string;
  /**
   * LOKI_USERNAME / LOKI_PASSWORD. Grafana Cloud authenticates with the numeric
   * instance id as the username and an access-policy token as the password.
   * The local docker Loki has no auth, and sending it an empty credential makes
   * it reject the push — so both halves must be present or neither is sent.
   */
  lokiUsername?: string;
  lokiPassword?: string;
}

const PRETTY = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    singleLine: false,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
  },
};

/**
 * Grafana has had a Loki datasource — with Tempo→logs correlation wired to it —
 * since the monitoring stack went in, but nothing ever pushed to it. This is
 * the push side.
 *
 * Opt-in on LOKI_URL so a service started without the monitoring profile
 * behaves exactly as before.
 */
export function buildLogTransport(
  serviceName: string,
  env: LogTransportEnv,
): LogTransport | undefined {
  const lokiUrl = env.lokiUrl?.trim();

  if (!lokiUrl) {
    return env.isProduction ? undefined : PRETTY;
  }

  const username = env.lokiUsername?.trim();
  const password = env.lokiPassword?.trim();
  const basicAuth =
    username && password ? { basicAuth: { username, password } } : {};

  const loki = {
    target: 'pino-loki',
    options: {
      host: lokiUrl,
      ...basicAuth,
      // `service` is the stream label every dashboard and the Tempo→Loki
      // correlation filters on, so it must be a label, not a log field.
      labels: { service: serviceName },
      batching: true,
      interval: 5,
      // A log shipper must never be able to take a service down. pino-loki
      // rethrows by default, and Loki not running is the normal local state.
      silenceErrors: true,
    },
  };

  return { targets: env.isProduction ? [loki] : [PRETTY, loki] };
}

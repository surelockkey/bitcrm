import { buildLogTransport } from '../../../src/logger/log-transport';

describe('buildLogTransport', () => {
  /** Find a target by name — index shifted once stdout was added, and asserting
   *  on position made three unrelated specs fail for no real reason. */
  const targetNamed = (t: any, name: string) =>
    (t?.targets ?? []).find((x: any) => x.target === name);

  it('pretty-prints in development when Loki is not configured', () => {
    const t = buildLogTransport('crm-service', { isProduction: false });

    expect(t).toEqual({
      target: 'pino-pretty',
      options: expect.objectContaining({ colorize: true }),
    });
  });

  it('emits raw JSON in production when Loki is not configured', () => {
    expect(
      buildLogTransport('crm-service', { isProduction: true }),
    ).toBeUndefined();
  });

  it('ships to Loki alongside pretty printing in development', () => {
    const t = buildLogTransport('crm-service', {
      isProduction: false,
      lokiUrl: 'http://localhost:3100',
    });

    expect(t?.targets).toHaveLength(2);
    expect(t?.targets?.map((x: any) => x.target)).toEqual([
      'pino-pretty',
      'pino-loki',
    ]);
  });

  it('ships to stdout and Loki in production', () => {
    const t = buildLogTransport('crm-service', {
      isProduction: true,
      lokiUrl: 'http://loki:3100',
    });

    expect(t?.targets?.map((x: any) => x.target)).toEqual(['pino/file', 'pino-loki']);
    expect(targetNamed(t, 'pino-loki').options.host).toBe('http://loki:3100');
  });

  // The service label is what every Grafana dashboard and the Tempo→Loki
  // correlation filter on, so it has to be a stream label, not just a field.
  it('labels each stream with the service name', () => {
    const t = buildLogTransport('telephony-service', {
      isProduction: true,
      lokiUrl: 'http://loki:3100',
    });

    expect(targetNamed(t, 'pino-loki').options.labels).toEqual({
      service: 'telephony-service',
    });
  });

  // A logging sidecar must never be able to take a service down: pino-loki
  // rethrows transport failures by default, and Loki being unreachable is the
  // normal state locally (the monitoring profile is opt-in).
  it('batches and swallows Loki transport errors', () => {
    const t = buildLogTransport('crm-service', {
      isProduction: true,
      lokiUrl: 'http://loki:3100',
    });

    expect(targetNamed(t, 'pino-loki').options).toEqual(
      expect.objectContaining({ batching: true, silenceErrors: true }),
    );
  });

  it('treats a blank LOKI_URL as unset', () => {
    const t = buildLogTransport('crm-service', {
      isProduction: true,
      lokiUrl: '   ',
    });

    expect(t).toBeUndefined();
  });

  /**
   * Grafana Cloud's Loki is authenticated: the numeric instance id is the
   * username and a Cloud Access Policy token is the password. Without this the
   * push is a silent 401 — pino-loki has silenceErrors on, so a misconfigured
   * credential looks exactly like a working one with no logs.
   */
  describe('authenticated Loki', () => {
    const cloud = {
      isProduction: true,
      lokiUrl: 'https://logs-prod-012.grafana.net/loki/api/v1/push',
      lokiUsername: '123456',
      lokiPassword: 'glc_token',
    };

    it('sends basic auth when a username and password are given', () => {
      const t = buildLogTransport('crm-service', cloud);

      expect(targetNamed(t, 'pino-loki').options.basicAuth).toEqual({
        username: '123456',
        password: 'glc_token',
      });
    });

    it('keeps the labels and failure-tolerance settings alongside auth', () => {
      const t = buildLogTransport('crm-service', cloud);

      expect(targetNamed(t, 'pino-loki').options).toEqual(
        expect.objectContaining({
          // The fixture is the full push URL Grafana Cloud documents; the
          // transport normalizes it to the base host pino-loki expects.
          host: 'https://logs-prod-012.grafana.net',
          labels: { service: 'crm-service' },
          batching: true,
          silenceErrors: true,
        }),
      );
    });

    // The local docker Loki has no auth at all; sending an empty credential
    // makes it reject the push.
    it('omits basic auth entirely for an unauthenticated Loki', () => {
      const t = buildLogTransport('crm-service', {
        isProduction: true,
        lokiUrl: 'http://localhost:3100',
      });

      expect(targetNamed(t, 'pino-loki').options).not.toHaveProperty('basicAuth');
    });

    /**
     * Half a credential is a misconfiguration, not a request to push
     * anonymously. Shipping anyway earns a 401 that silenceErrors swallows —
     * which is exactly what the first deployment did: SSM supplied LOKI_URL and
     * LOKI_USERNAME to every task while LOKI_PASSWORD, which rides with the
     * token, was absent. Refusing to ship is the honest failure.
     */
    it('does not ship to Loki at all when only one half of the credential is present', () => {
      const onlyUser = buildLogTransport('crm-service', {
        isProduction: true,
        lokiUrl: 'https://logs.grafana.net',
        lokiUsername: '123456',
      });
      const onlyPass = buildLogTransport('crm-service', {
        isProduction: true,
        lokiUrl: 'https://logs.grafana.net',
        lokiPassword: 'glc_token',
      });

      expect(onlyUser).toBeUndefined();
      expect(onlyPass).toBeUndefined();
    });

    it('still pretty-prints in development when the credential is half-set', () => {
      const t = buildLogTransport('crm-service', {
        isProduction: false,
        lokiUrl: 'https://logs.grafana.net',
        lokiUsername: '123456',
      });

      expect(t).toEqual({
        target: 'pino-pretty',
        options: expect.objectContaining({ colorize: true }),
      });
    });

    it('still pretty-prints alongside an authenticated push in development', () => {
      const t = buildLogTransport('crm-service', { ...cloud, isProduction: false });

      expect(t?.targets?.map((x: any) => x.target)).toEqual([
        'pino-pretty',
        'pino-loki',
      ]);
      expect(targetNamed(t, 'pino-loki').options.basicAuth).toBeDefined();
    });
  });

  /**
   * Both of these were live bugs, and together they lost every application log
   * line for a day: production wrote only to Loki (so awslogs/CloudWatch went
   * empty) while the Loki push itself 404'd (so nothing arrived there either).
   * silenceErrors meant no trace of it anywhere.
   */
  describe('production keeps stdout', () => {
    const cloud = {
      isProduction: true,
      lokiUrl: 'https://logs-prod-012.grafana.net',
      lokiUsername: '123456',
      lokiPassword: 'glc_token',
    };

    it('writes to stdout as well as Loki', () => {
      const t = buildLogTransport('crm-service', cloud);

      const targets = t?.targets?.map((x: any) => x.target);
      expect(targets).toContain('pino/file');
      expect(targets).toContain('pino-loki');
    });

    // awslogs is the log path that already worked; Loki is additive, never a
    // replacement. A Loki outage must not blind CloudWatch too.
    it('points the stdout target at fd 1', () => {
      const t = buildLogTransport('crm-service', cloud);
      const stdout = t?.targets?.find((x: any) => x.target === 'pino/file');

      expect(stdout?.options).toEqual({ destination: 1 });
    });

    it('still writes to stdout when Loki is not configured', () => {
      // No transport at all means pino's own default, which is stdout.
      expect(buildLogTransport('crm-service', { isProduction: true })).toBeUndefined();
    });
  });

  describe('Loki host normalization', () => {
    // Grafana Cloud's connection page shows the full push URL, and pino-loki
    // appends /loki/api/v1/push to whatever host it is given — so pasting the
    // documented value produced .../push/loki/api/v1/push and a silent 404.
    const auth = { lokiUsername: '1', lokiPassword: 'x', isProduction: true };
    const hostOf = (url: string) =>
      (buildLogTransport('svc', { ...auth, lokiUrl: url })?.targets ?? [])
        .find((t: any) => t.target === 'pino-loki')?.options.host;

    it('strips a full push path down to the base host', () => {
      expect(hostOf('https://logs-prod-012.grafana.net/loki/api/v1/push')).toBe(
        'https://logs-prod-012.grafana.net',
      );
    });

    it('leaves a base host alone', () => {
      expect(hostOf('https://logs-prod-012.grafana.net')).toBe(
        'https://logs-prod-012.grafana.net',
      );
    });

    it('strips a trailing slash', () => {
      expect(hostOf('http://localhost:3100/')).toBe('http://localhost:3100');
    });

    it('handles the push path with a trailing slash', () => {
      expect(hostOf('https://logs.grafana.net/loki/api/v1/push/')).toBe(
        'https://logs.grafana.net',
      );
    });
  });
});

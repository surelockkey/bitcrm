import { buildLogTransport } from '../../../src/logger/log-transport';

describe('buildLogTransport', () => {
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

  it('ships only to Loki in production', () => {
    const t = buildLogTransport('crm-service', {
      isProduction: true,
      lokiUrl: 'http://loki:3100',
    });

    expect(t?.targets).toHaveLength(1);
    expect(t?.targets?.[0].target).toBe('pino-loki');
    expect(t?.targets?.[0].options.host).toBe('http://loki:3100');
  });

  // The service label is what every Grafana dashboard and the Tempo→Loki
  // correlation filter on, so it has to be a stream label, not just a field.
  it('labels each stream with the service name', () => {
    const t = buildLogTransport('telephony-service', {
      isProduction: true,
      lokiUrl: 'http://loki:3100',
    });

    expect(t?.targets?.[0].options.labels).toEqual({
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

    expect(t?.targets?.[0].options).toEqual(
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

      expect(t?.targets?.[0].options.basicAuth).toEqual({
        username: '123456',
        password: 'glc_token',
      });
    });

    it('keeps the labels and failure-tolerance settings alongside auth', () => {
      const t = buildLogTransport('crm-service', cloud);

      expect(t?.targets?.[0].options).toEqual(
        expect.objectContaining({
          host: cloud.lokiUrl,
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

      expect(t?.targets?.[0].options).not.toHaveProperty('basicAuth');
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
      expect(t?.targets?.[1].options.basicAuth).toBeDefined();
    });
  });
});

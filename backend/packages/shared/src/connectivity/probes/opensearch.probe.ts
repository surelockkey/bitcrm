import {
  Probe,
  ProbeKind,
  ProbeOutcome,
  ProbeResourceStatus,
} from '../connectivity.types';

/**
 * Cluster reachability for the search read model. Plain HTTP rather than the
 * OpenSearch client so @bitcrm/shared stays free of that dependency — every
 * service links this package, only one talks to OpenSearch.
 *
 * Unsigned, so this is for the local container and a basic-auth-free managed
 * domain. Serverless (`aoss`) needs SigV4; leave the probe unconfigured there.
 */
export class OpenSearchProbe implements Probe {
  readonly name = 'opensearch';
  readonly kind: ProbeKind = 'opensearch';

  constructor(
    private readonly url: string,
    private readonly requiredIndices: string[] = [],
  ) {}

  private get base(): string {
    return this.url.replace(/\/+$/, '');
  }

  async run(): Promise<ProbeOutcome> {
    const res = await fetch(`${this.base}/_cluster/health`);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const body = (await res.json()) as { status?: string };
    const status = body?.status ?? 'unknown';

    // A single-node dev cluster is yellow forever — its replicas have nowhere
    // to be placed. Only red (an unassigned *primary*) means data is missing.
    if (status === 'red') {
      return { ok: false, error: `cluster status red` };
    }

    // Index lookups only once the cluster answered: against a down cluster
    // they would all fail and bury the real cause under N missing resources.
    const resources: ProbeResourceStatus[] = await Promise.all(
      this.requiredIndices.map(async (index) => {
        try {
          const r = await fetch(`${this.base}/${index}/_alias`);
          return r.ok
            ? { resource: index, present: true }
            : { resource: index, present: false, details: `HTTP ${r.status}` };
        } catch (err) {
          return {
            resource: index,
            present: false,
            details: (err as Error)?.message,
          };
        }
      }),
    );

    const present = resources.filter((r) => r.present).length;
    return {
      ok: resources.length === 0 || present === resources.length,
      message:
        resources.length === 0
          ? `cluster status ${status}`
          : `cluster status ${status}, ${present}/${resources.length} indices present`,
      ...(resources.length > 0 && { resources }),
    };
  }
}

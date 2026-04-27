import { Probe, ProbeKind, ProbeOutcome } from '../connectivity.types';

export class HttpProbe implements Probe {
  readonly kind: ProbeKind = 'http';

  constructor(
    public readonly name: string,
    private readonly url: string,
  ) {}

  async run(): Promise<ProbeOutcome> {
    const res = await fetch(this.url);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, message: `HTTP ${res.status}` };
  }
}

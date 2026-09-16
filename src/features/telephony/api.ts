import { http } from '../../lib/api/http';
import type { StartedBridge } from '../jobs/types';

/**
 * Place a masked call to a job's client.
 *
 * The body is a **descriptor, never a number**: the server resolves the
 * client's phone itself and the carrier dials it, so the handset — and
 * therefore the technician — never holds it
 * (calls.controller.ts:755-817, docs/ARCHITECTURE.md §1.6).
 *
 * The route carries no `@RequirePermission`; it checks the job's technician
 * roster instead, which is how a technician calls a client despite
 * `calls.view: false` on their role.
 */
export const startBridge = (body: {
  dealId: string;
  contactId: string;
  /** Which of the contact's numbers to dial. Defaults to the first. */
  phoneIndex?: number;
  /**
   * On a phone this is always `cell`: the technician's own handset rings, and
   * the client is dialled once they pick up. `softphone` is a browser leg.
   */
  via?: 'cell' | 'softphone';
}): Promise<StartedBridge> =>
  http.post<StartedBridge>('/telephony/calls/bridge', body);

/** Abandon a bridge while the technician's own handset is still ringing. */
export const cancelBridge = (
  bridgeId: string,
): Promise<{ cancelled: boolean }> =>
  http.delete<{ cancelled: boolean }>(`/telephony/calls/bridge/${bridgeId}`);

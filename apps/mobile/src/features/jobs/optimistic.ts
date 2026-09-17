import type { OutboxKind } from '../../lib/queue/types';
import type { Deal } from './types';
import type { ArrivedPayload, StatusPayload } from '../queue/transport';

/**
 * What the screen should show the instant the technician taps, before the
 * server has heard about it.
 *
 * Every one of these actions is queued rather than awaited — the phone may be
 * on one bar, or none — so the optimistic patch is not a nicety, it is the only
 * feedback there is until the queue drains. Kept pure so "what does Arrived
 * change?" is a test rather than a trace through a mutation.
 *
 * Actions that change nothing visible on the job (a note, the two automatic
 * texts) return an empty patch; their feedback is the queue badge.
 */
export function optimisticPatch(
  kind: OutboxKind,
  payload: unknown,
  nowIso: string,
  actorId?: string,
): Partial<Deal> {
  switch (kind) {
    case 'confirm':
      return { techConfirmedAt: nowIso, ...(actorId ? { techConfirmedBy: actorId } : {}) };
    case 'arrived': {
      const fix = payload as ArrivedPayload;
      return {
        arrivedAt: nowIso,
        ...(actorId ? { arrivedBy: actorId } : {}),
        ...(typeof fix?.lat === 'number' && typeof fix?.lng === 'number'
          ? {
              arrivedLocation: {
                lat: fix.lat,
                lng: fix.lng,
                ...(typeof fix.accuracy === 'number' ? { accuracy: fix.accuracy } : {}),
              },
            }
          : {}),
      };
    }
    case 'status': {
      const body = payload as StatusPayload;
      return {
        superStatus: body.superStatus,
        // The server picks its own sub-status on some moves; guessing one here
        // would show a label that is about to change. Clearing it is honest.
        subStatusId: body.subStatusId,
        statusChangedAt: nowIso,
      };
    }
    default:
      return {};
  }
}

/** Apply a patch to whichever row of a cached day list holds this job. */
export function applyPatchToList(
  list: Deal[] | undefined,
  id: string,
  patch: Partial<Deal>,
): Deal[] | undefined {
  if (!list) return list;
  let changed = false;
  const next = list.map((deal) => {
    if (deal.id !== id) return deal;
    changed = true;
    return { ...deal, ...patch };
  });
  // Returning the same reference when nothing matched keeps react-query from
  // re-rendering every job card on a list this job is not even in.
  return changed ? next : list;
}

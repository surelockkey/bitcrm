import { type TechnicianProfile, type User } from '@bitcrm/types';

/**
 * Whether a person's live position may be stored and shown on the dispatch
 * map. The one rule behind every live-location write and read.
 *
 * Two gates, both the manager's: the card's "Track location", and the user
 * type — a subcontractor is never tracked (Workiz: "You will not be able to
 * enable location tracking for subcontractors"), even when a card still says
 * so. The type is the user record's; a card from before the type moved there
 * speaks when the record has none.
 *
 * Nobody has turned tracking off for a person without a card yet, so they
 * count as tracked — the card seeds the flag the moment it appears.
 */
export function isLocationTracked(
  profile: Pick<TechnicianProfile, 'gpsTrackingEnabled' | 'technicianType'> | null | undefined,
  user: Pick<Partial<User>, 'id' | 'userType'> | null | undefined,
): boolean {
  const type = user?.userType ?? profile?.technicianType ?? 'regular';
  if (type === 'subcontractor') return false;
  return profile ? profile.gpsTrackingEnabled === true : true;
}

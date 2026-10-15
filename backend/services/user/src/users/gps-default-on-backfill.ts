import type { TechnicianProfile, User } from '@bitcrm/types';

/**
 * One card's part of `backfill:gps-default-on`: whether its Track location
 * goes on. Track location became on by default on 2026-10-15; until the day
 * before, the flag was stored but read by nothing at runtime, so every "off"
 * on a card is the old default rather than a manager's decision. A
 * subcontractor is never tracked. Pure — the script reads and writes.
 */
export function planGpsDefaultOn(
  user: Pick<Partial<User>, 'userType'>,
  profile: Partial<Pick<TechnicianProfile, 'gpsTrackingEnabled' | 'technicianType'>> | null | undefined,
): boolean {
  if (!profile) return false;
  const type = user.userType ?? profile.technicianType ?? 'regular';
  if (type === 'subcontractor') return false;
  return profile.gpsTrackingEnabled !== true;
}

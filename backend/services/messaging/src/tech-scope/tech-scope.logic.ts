import { type DealForMessaging } from '../api/access/deal-read.service';

/**
 * The `assigned_only` inbox rule, as pure functions shared by the live path
 * (`ConversationScopeService.assignedConversations` reading deal-service on
 * every request) and the stored projection (`TechScopeService`), so both
 * derive exactly the same thing:
 *
 *   the jobs deal-service lists for the technician (`GET /deals/internal/
 *   by-tech/:id` — the 100 most recent on TechIndex, active only), kept when
 *   their roster names the technician  →  each job's contact, then company,
 *   first occurrence wins.
 *
 * The technician's own team thread and their groups are NOT part of it —
 * those are messaging's own rows and are read live (`CONVOF#user#<id>`,
 * `MEMBEROF#<id>`).
 */

/** The slice of a job the projection keeps: who the job is with. */
export interface TechScopeDeal {
  id: string;
  contactId?: string;
  companyId?: string;
}

export interface TechScopeParty {
  kind: 'contact' | 'company';
  id: string;
}

const compactDeal = (d: Pick<DealForMessaging, 'id' | 'contactId' | 'companyId'>): TechScopeDeal => ({
  id: d.id,
  ...(d.contactId && { contactId: d.contactId }),
  ...(d.companyId && { companyId: d.companyId }),
});

/** The by-tech answer → the jobs whose roster names the technician, in deal-service's order. */
export function scopeDealsOf(deals: DealForMessaging[], userId: string): TechScopeDeal[] {
  return deals.filter((d) => (d.assignedTechIds ?? []).includes(userId)).map(compactDeal);
}

/** Jobs → the parties whose threads they open, in order, deduplicated. */
export function jobPartiesOf(deals: TechScopeDeal[]): TechScopeParty[] {
  const parties = new Map<string, TechScopeParty>();
  for (const deal of deals) {
    if (deal.contactId && !parties.has(`contact:${deal.contactId}`)) {
      parties.set(`contact:${deal.contactId}`, { kind: 'contact', id: deal.contactId });
    }
    if (deal.companyId && !parties.has(`company:${deal.companyId}`)) {
      parties.set(`company:${deal.companyId}`, { kind: 'company', id: deal.companyId });
    }
  }
  return [...parties.values()];
}

/**
 * The job an event is about, read fresh from deal-service, laid over the
 * by-tech answer: TechIndex is a GSI and may not show the assignment the
 * event announces yet, while the job itself is current. Still on it and not
 * deleted → in (in its place, or in front when the index has not caught up);
 * otherwise → out. No fresh read → unchanged.
 */
export function mergeEventDeal(
  deals: TechScopeDeal[],
  fresh: DealForMessaging | null,
  userId: string,
): TechScopeDeal[] {
  if (!fresh) return deals;
  const keep = fresh.status !== 'deleted' && (fresh.assignedTechIds ?? []).includes(userId);
  const at = deals.findIndex((d) => d.id === fresh.id);
  if (!keep) return at < 0 ? deals : deals.filter((d) => d.id !== fresh.id);
  const entry = compactDeal(fresh);
  if (at < 0) return [entry, ...deals];
  return deals.map((d, i) => (i === at ? entry : d));
}

/** A CRM merge: the duplicate contact's jobs now belong to the survivor (deal-service re-points them too). */
export function renameContact(deals: TechScopeDeal[], fromContactId: string, toContactId: string): TechScopeDeal[] {
  return deals.map((d) => (d.contactId === fromContactId ? { ...d, contactId: toContactId } : d));
}

/** Is the stored row already right about this job? (Then an event about it changes nothing.) */
export function agreesWith(deals: TechScopeDeal[], fresh: DealForMessaging, userId: string): boolean {
  const keep = fresh.status !== 'deleted' && (fresh.assignedTechIds ?? []).includes(userId);
  const stored = deals.find((d) => d.id === fresh.id);
  if (!keep) return !stored;
  return !!stored && stored.contactId === (fresh.contactId || undefined) && stored.companyId === (fresh.companyId || undefined);
}

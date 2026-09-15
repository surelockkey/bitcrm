import { SearchType } from '@bitcrm/types';

/** eventType → which index doc it touches and how. */
export interface EventRoute {
  eventType: string;
  type: SearchType;
  op: 'upsert' | 'delete';
  idField: string;
}

/**
 * Every event the `search-index` queue receives that maps to one document.
 * An upsert re-fetches the authoritative entity over internal HTTP and
 * reindexes it (see IndexerEventHandler); a delete removes the doc.
 */
export const EVENT_ROUTES: EventRoute[] = [
  // deal-events
  { eventType: 'deal.created', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.updated', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.status_changed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.completed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.tech_assigned', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.tech_unassigned', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.product_added', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.product_removed', type: 'deal', op: 'upsert', idField: 'dealId' },
  { eventType: 'deal.deleted', type: 'deal', op: 'delete', idField: 'dealId' },
  // contact-events (crm)
  { eventType: 'contact.created', type: 'contact', op: 'upsert', idField: 'contactId' },
  { eventType: 'contact.updated', type: 'contact', op: 'upsert', idField: 'contactId' },
  { eventType: 'contact.deleted', type: 'contact', op: 'delete', idField: 'contactId' },
  { eventType: 'company.created', type: 'company', op: 'upsert', idField: 'companyId' },
  { eventType: 'company.updated', type: 'company', op: 'upsert', idField: 'companyId' },
  { eventType: 'company.deleted', type: 'company', op: 'delete', idField: 'companyId' },
  // user-events
  { eventType: 'user.activated', type: 'user', op: 'upsert', idField: 'userId' },
  { eventType: 'user.role-changed', type: 'user', op: 'upsert', idField: 'userId' },
  { eventType: 'tech.approved', type: 'technician', op: 'upsert', idField: 'technicianId' },
  { eventType: 'tech.updated', type: 'technician', op: 'upsert', idField: 'technicianId' },
  // inventory-events (topic added in Phase 2 — inert until inventory publishes)
  { eventType: 'product.created', type: 'product', op: 'upsert', idField: 'productId' },
  { eventType: 'product.updated', type: 'product', op: 'upsert', idField: 'productId' },
  { eventType: 'product.deleted', type: 'product', op: 'delete', idField: 'productId' },
  { eventType: 'warehouse.created', type: 'warehouse', op: 'upsert', idField: 'warehouseId' },
  { eventType: 'warehouse.updated', type: 'warehouse', op: 'upsert', idField: 'warehouseId' },
  { eventType: 'container.created', type: 'container', op: 'upsert', idField: 'containerId' },
  { eventType: 'container.updated', type: 'container', op: 'upsert', idField: 'containerId' },
  { eventType: 'transfer.created', type: 'transfer', op: 'upsert', idField: 'transferId' },
  // message-events (messaging design §7.3–7.4). Every message event names its
  // conversation, and the document is the conversation (party, last messages,
  // jobs) — so all four rebuild the same doc. Messaging emits
  // `conversation.updated` on every change; the message events are routed too
  // so a status flip or a late-arriving message never leaves the doc stale.
  { eventType: 'conversation.updated', type: 'conversation', op: 'upsert', idField: 'conversationId' },
  { eventType: 'message.received', type: 'conversation', op: 'upsert', idField: 'conversationId' },
  { eventType: 'message.sent', type: 'conversation', op: 'upsert', idField: 'conversationId' },
  { eventType: 'message.status_changed', type: 'conversation', op: 'upsert', idField: 'conversationId' },
];

/**
 * Custom-field definition events (deal-service). Not entity routes — the
 * `searchable` toggle lives on the definition, so any change invalidates the
 * cached defs and rebuilds every deal doc.
 */
export const CUSTOM_FIELD_EVENTS = [
  'custom-field.created',
  'custom-field.updated',
  'custom-field.archived',
  'custom-field.deleted',
];

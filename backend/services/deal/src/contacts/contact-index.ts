/**
 * GSI10 ContactActivityIndex — the client card's History and Files.
 *
 * One sparse index on the deals table, two kinds of rows, told apart by the
 * partition prefix so a page of history never contains a file and vice versa:
 *
 *   DEAL#<dealId>       / TIMELINE#<ts>#<id>   GSI10PK = CONTACT#<contactId>       GSI10SK = <timestamp>#<id>
 *   DEAL#<dealId>       / ATTACH#<id>          GSI10PK = CONTACTFILE#<contactId>   GSI10SK = <uploadedAt>#<id>
 *   CONTACT#<contactId> / ATTACH#<id>          GSI10PK = CONTACTFILE#<contactId>   GSI10SK = <uploadedAt>#<id>
 *
 * A row carries the keys only when the writer knew the job's client (the
 * deal's `contactId`); rows written before the index need
 * `npm run backfill:contact-index -w backend/services/deal`. The import's
 * client-level events (`CLIENT#<contactId>` / `ACT#…`) are not in this index
 * — they are read off their own partition and merged into the history.
 *
 * 10 because 8 and 9 are the Activity report's indexes; the numbers only
 * have to be unique.
 */
export const CONTACT_ACTIVITY_INDEX = 'ContactActivityIndex';
export const CONTACT_INDEX_PK = 'GSI10PK';
export const CONTACT_INDEX_SK = 'GSI10SK';

export const contactActivityPk = (contactId: string) => `CONTACT#${contactId}`;
export const contactFilePk = (contactId: string) => `CONTACTFILE#${contactId}`;
export const contactIndexSk = (timestamp: string, id: string) => `${timestamp}#${id}`;

export interface ContactIndexKeys {
  GSI10PK: string;
  GSI10SK: string;
}

/** The keys that file a job's event under its client. */
export function timelineContactKeys(contactId: string, timestamp: string, id: string): ContactIndexKeys {
  return { GSI10PK: contactActivityPk(contactId), GSI10SK: contactIndexSk(timestamp, id) };
}

/** The keys that file a job's or a client's file under the client. */
export function attachmentContactKeys(contactId: string, uploadedAt: string, id: string): ContactIndexKeys {
  return { GSI10PK: contactFilePk(contactId), GSI10SK: contactIndexSk(uploadedAt, id) };
}

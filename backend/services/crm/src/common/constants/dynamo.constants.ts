export const CONTACTS_TABLE = process.env.CONTACTS_TABLE || 'BitCRM_Contacts';
export const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'BitCRM_Companies';

export const CONTACTS_GSI1_NAME = 'CompanyIndex';
export const COMPANIES_GSI1_NAME = 'ClientTypeIndex';

// Company compliance documents (W-9 / COI): PK=COMPANY#<id>, SK=DOC#<docType>.
export const COMPANY_DOC_SK_PREFIX = 'DOC#';
export const companyDocS3Key = (companyId: string, docType: string) =>
  `companies/${companyId}/${docType}`;

// Work orders live in the companies table: PK=WORKORDER#<id>, SK=METADATA.
// The registry lists via GSI1 (ClientTypeIndex): GSI1PK='WORKORDER#ALL',
// GSI1SK='<date>#<id>' (date-sorted). Filter by company/status in the service.
export const WORK_ORDER_GSI_PK = 'WORKORDER#ALL';
export const workOrderS3Key = (workOrderId: string) => `work-orders/${workOrderId}`;

// Client notes (the client card's Notes panel) live beside the contact in the
// contacts table: PK=CONTACT#<contactId>, SK=NOTE#<createdAt>#<noteId>. The
// ISO timestamp in the sort key is what makes "newest first" a reverse Query;
// the id after it keeps two notes written in the same millisecond apart. The
// contact list's Scan pins `SK = METADATA`, so these rows never reach it.
export const CONTACT_NOTE_SK_PREFIX = 'NOTE#';
export const contactNoteSk = (createdAt: string, noteId: string) =>
  `${CONTACT_NOTE_SK_PREFIX}${createdAt}#${noteId}`;

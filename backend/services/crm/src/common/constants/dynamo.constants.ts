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

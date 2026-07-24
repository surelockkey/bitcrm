// Single-table design: technician items live in the same table as users.
export const TECHNICIANS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';

// GSI3 — lists technician profiles; partition is a constant so a single Query
// returns all technicians, and begins_with(GSI3SK, '<status>#') filters by status.
export const GSI3_NAME = 'TechnicianIndex';
export const TECHNICIAN_GSI_PK = 'TECHNICIAN';

// Sort-key discriminator for the profile item under PK=USER#<id>.
export const PROFILE_SK = 'TECH_PROFILE';

// Assignment items under PK=USER#<id>. The catalog id IS the sort key, so a
// technician can hold each job type / service area at most once.
//   SK = JOBTYPE#<jobTypeId>  |  SK = AREA#<serviceAreaId>
export const JOB_TYPE_SK_PREFIX = 'JOBTYPE#';
export const SERVICE_AREA_SK_PREFIX = 'AREA#';

// GSI4 — lists assignment proposals by status across all technicians (manager
// dashboard / SLA). GSI4PK = <KIND>_STATUS#<status>, GSI4SK = <userId>#<catalogId>.
//
// The physical index name still says "Skill": renaming a GSI forces DynamoDB to
// rebuild it, so only the partition VALUES changed in the job-types migration.
// Renaming the index itself is a deliberate follow-up.
export const GSI4_NAME = 'SkillStatusIndex';
export const jobTypeStatusGsiPk = (status: string) => `JOBTYPE_STATUS#${status}`;
export const serviceAreaStatusGsiPk = (status: string) => `AREA_STATUS#${status}`;

// Commission config items (versioned): SK = COMMISSION#<effectiveDateISO>.
export const COMMISSION_SK_PREFIX = 'COMMISSION#';

// Calendar events (time off / lunch / break / appointment) under PK=USER#<id>.
//   SK = CAL#<startDate>#<id>   (startDate 'YYYY-MM-DD' → lexical == chronological)
// A range query over [from,to] must widen the low bound by MAX_EVENT_DAYS,
// because an all-day event may START before `from` yet still overlap it.
export const CAL_SK_PREFIX = 'CAL#';
export const calSk = (startDate: string, id: string) =>
  `${CAL_SK_PREFIX}${startDate}#${id}`;
export const MAX_EVENT_DAYS = 60;

// Sensitive document metadata: SK = DOC#<docType> under PK=USER#<id>.
export const DOC_SK_PREFIX = 'DOC#';

// Encrypted sensitive fields (SSN, bank account) on a single item.
export const SENSITIVE_SK = 'TECH_SENSITIVE';

// Append-only access audit log: PK = AUDIT#<userId>, SK = <ISO>#<uuid>.
export const auditPk = (userId: string) => `AUDIT#${userId}`;

// S3 object key for a technician document.
export const documentS3Key = (userId: string, docType: string) =>
  `technicians/${userId}/${docType}`;

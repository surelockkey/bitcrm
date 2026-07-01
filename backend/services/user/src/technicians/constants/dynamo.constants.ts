// Single-table design: technician items live in the same table as users.
export const TECHNICIANS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';

// GSI3 — lists technician profiles; partition is a constant so a single Query
// returns all technicians, and begins_with(GSI3SK, '<status>#') filters by status.
export const GSI3_NAME = 'TechnicianIndex';
export const TECHNICIAN_GSI_PK = 'TECHNICIAN';

// Sort-key discriminator for the profile item under PK=USER#<id>.
export const PROFILE_SK = 'TECH_PROFILE';

// Skill items: SK = SKILL#<skillId> under PK=USER#<id>.
export const SKILL_SK_PREFIX = 'SKILL#';

// GSI4 — lists skill proposals by status across all technicians (manager
// dashboard / SLA). GSI4PK = SKILL_STATUS#<status>, GSI4SK = <userId>#<skillId>.
export const GSI4_NAME = 'SkillStatusIndex';
export const skillStatusGsiPk = (status: string) => `SKILL_STATUS#${status}`;

// Commission config items (versioned): SK = COMMISSION#<effectiveDateISO>.
export const COMMISSION_SK_PREFIX = 'COMMISSION#';

// Sensitive document metadata: SK = DOC#<docType> under PK=USER#<id>.
export const DOC_SK_PREFIX = 'DOC#';

// Encrypted sensitive fields (SSN, bank account) on a single item.
export const SENSITIVE_SK = 'TECH_SENSITIVE';

// Append-only access audit log: PK = AUDIT#<userId>, SK = <ISO>#<uuid>.
export const auditPk = (userId: string) => `AUDIT#${userId}`;

// S3 object key for a technician document.
export const documentS3Key = (userId: string, docType: string) =>
  `technicians/${userId}/${docType}`;

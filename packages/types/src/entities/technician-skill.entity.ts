/**
 * A skill a technician proposes and a manager reviews. Two kinds:
 *  - job_type:    what they can do (Locksmith, Rekeying, …)
 *  - service_area: where they can work (Atlanta, North Georgia, …)
 *
 * Stored under PK=USER#<userId>, SK=SKILL#<skillId>, and indexed for
 * cross-technician status queries via SkillStatusIndex (GSI4).
 */
export type SkillType = 'job_type' | 'service_area';
export type SkillStatus = 'pending' | 'approved' | 'rejected';

export interface TechnicianSkill {
  skillId: string;
  userId: string;
  type: SkillType;
  value: string;
  status: SkillStatus;
  proposedBy: string;
  proposedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comments?: string;
}

import { IntersectionType } from '@nestjs/swagger';
import { UpdateTechnicianProfileDto } from './update-technician-profile.dto';
import { UpdateTechnicianOperationalDto } from './update-technician-operational.dto';

/**
 * Full PUT body. Self-fill fields (from {@link UpdateTechnicianProfileDto}) may
 * be set by the technician themselves; operational fields (from
 * {@link UpdateTechnicianOperationalDto}) require a privileged caller. The split
 * is enforced in TechniciansService.updateProfile.
 */
export class UpdateTechnicianDto extends IntersectionType(
  UpdateTechnicianProfileDto,
  UpdateTechnicianOperationalDto,
) {}

/** Operational fields — editing any of these requires a Manager+ caller. */
export const OPERATIONAL_FIELDS = [
  'laborCostPerHour',
  'callMaskingEnabled',
  'gpsTrackingEnabled',
  'mobileAppInstalled',
  'status',
] as const;

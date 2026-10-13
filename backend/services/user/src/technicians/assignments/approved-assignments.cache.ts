import { type Logger } from '@nestjs/common';
import { type RedisService } from '@bitcrm/shared';
import { type TechnicianJobType, type TechnicianServiceArea } from '@bitcrm/types';
import {
  type TechnicianAssignment,
  type TechnicianAssignmentsRepository,
} from './technician-assignments.repository';

/**
 * Every technician's approved job types + service areas, shared across tasks
 * and readers: the Team list (`GET /technicians/assignments/approved`) and the
 * dispatch roster (`GET /users/internal/technicians/assignable`). Deleted by
 * every write in `TechnicianAssignmentsService` (propose / assign / approve /
 * reject / revoke); the TTL is the backstop for a write made outside it
 * (`migrate-technician-skills`).
 */
export const APPROVED_ASSIGNMENTS_CACHE_KEY = 'technicians:assignments:approved';
export const APPROVED_ASSIGNMENTS_TTL_SECONDS = 300;

export interface TechnicianAssignments {
  jobTypes: TechnicianJobType[];
  serviceAreas: TechnicianServiceArea[];
}

/**
 * The approved sets, from the cache when it holds them, else from the
 * approved-status partitions of SkillStatusIndex (and then cached). A broken
 * Redis costs the cache, never the answer.
 */
export async function readApprovedAssignments(
  repository: Pick<TechnicianAssignmentsRepository, 'listAllApproved'>,
  redis: RedisService | undefined,
  logger: Pick<Logger, 'warn'>,
): Promise<TechnicianAssignments> {
  if (redis) {
    try {
      const raw = await redis.client.get(APPROVED_ASSIGNMENTS_CACHE_KEY);
      if (raw) return JSON.parse(raw) as TechnicianAssignments;
    } catch (err) {
      logger.warn(`approved-assignments cache read failed: ${(err as Error)?.message}`);
    }
  }
  const [jobTypes, serviceAreas] = await Promise.all([
    repository.listAllApproved('job_type'),
    repository.listAllApproved('service_area'),
  ]);
  const answer = { jobTypes: jobTypes.map(toJobType), serviceAreas: serviceAreas.map(toServiceArea) };
  if (redis) {
    try {
      await redis.client.set(
        APPROVED_ASSIGNMENTS_CACHE_KEY,
        JSON.stringify(answer),
        'EX',
        APPROVED_ASSIGNMENTS_TTL_SECONDS,
      );
    } catch (err) {
      logger.warn(`approved-assignments cache write failed: ${(err as Error)?.message}`);
    }
  }
  return answer;
}

// --- storage → public entity mappers ---

export function toJobType(a: TechnicianAssignment): TechnicianJobType {
  const { kind, catalogId, ...rest } = a;
  return { ...rest, jobTypeId: catalogId };
}

export function toServiceArea(a: TechnicianAssignment): TechnicianServiceArea {
  const { kind, catalogId, ...rest } = a;
  return { ...rest, serviceAreaId: catalogId };
}

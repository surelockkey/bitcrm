import { Injectable } from '@nestjs/common';
import { UserContainerAccess } from '@bitcrm/types';
import { UserContainersRepository } from './user-containers.repository';
import { ContainersRepository } from '../containers/containers.repository';

/**
 * The one answer to "which container does this user work from" — behind the
 * job-line deduct/restore (deal-service passes the technician's id), "my
 * container", the containers `assigned_only` scope and the Stock popup.
 *
 * The user's assignment row decides whenever it exists: `container` names the
 * van, "All locations" and "No access" name none — even if a container row
 * still carries that user as its `technicianId`. Only a user with no row at
 * all falls back to that legacy link, which is what dev holds until
 * `backfill:user-containers` has run.
 */
/** Which containers a user works from: one, or every one ("All locations"), or none. */
export interface ContainerAssignment {
  allLocations: boolean;
  /** The one container, when there is one. */
  containerId?: string;
}

@Injectable()
export class ContainerAssignmentResolver {
  constructor(
    private readonly assignments: UserContainersRepository,
    private readonly containers: ContainersRepository,
  ) {}

  async containerIdForUser(userId: string): Promise<string | undefined> {
    return (await this.assignmentFor(userId)).containerId;
  }

  /**
   * The whole answer, for the data scopes: `allLocations` is Workiz "All
   * locations" — no one van, but every van visible even under
   * `assigned_only`. "No access" is neither a van nor all of them.
   */
  async assignmentFor(userId: string): Promise<ContainerAssignment> {
    const row = await this.assignments.findByUser(userId);
    if (row) {
      if (row.access === UserContainerAccess.ALL) return { allLocations: true };
      return row.access === UserContainerAccess.CONTAINER && row.containerId
        ? { allLocations: false, containerId: row.containerId }
        : { allLocations: false };
    }
    const legacy = await this.containers.findByTechnicianId(userId);
    return legacy ? { allLocations: false, containerId: legacy.id } : { allLocations: false };
  }
}

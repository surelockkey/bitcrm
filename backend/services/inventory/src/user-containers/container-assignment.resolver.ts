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
@Injectable()
export class ContainerAssignmentResolver {
  constructor(
    private readonly assignments: UserContainersRepository,
    private readonly containers: ContainersRepository,
  ) {}

  async containerIdForUser(userId: string): Promise<string | undefined> {
    const row = await this.assignments.findByUser(userId);
    if (row) {
      return row.access === UserContainerAccess.CONTAINER ? row.containerId : undefined;
    }
    const legacy = await this.containers.findByTechnicianId(userId);
    return legacy?.id;
  }
}

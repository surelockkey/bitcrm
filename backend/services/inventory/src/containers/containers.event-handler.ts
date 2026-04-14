import { Injectable, Logger } from '@nestjs/common';
import { ContainersService } from './containers.service';

interface UserEventPayload {
  userId: string;
  roleId: string;
  department: string;
  firstName: string;
  lastName: string;
}

// Technician role ID — matches default-roles.ts in user service
const TECHNICIAN_ROLE_IDS = ['role-technician'];

@Injectable()
export class ContainersEventHandler {
  private readonly logger = new Logger(ContainersEventHandler.name);

  constructor(private readonly containersService: ContainersService) {}

  async handleUserEvent(payload: UserEventPayload): Promise<void> {
    if (!TECHNICIAN_ROLE_IDS.includes(payload.roleId)) {
      this.logger.debug(
        `Skipping container creation for non-technician role: ${payload.roleId}`,
      );
      return;
    }

    this.logger.log(
      `Creating container for technician ${payload.userId}`,
    );

    await this.containersService.ensureContainer({
      technicianId: payload.userId,
      technicianName: `${payload.firstName} ${payload.lastName}`.trim(),
      department: payload.department,
    });
  }
}

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import {
  type JwtUser,
  type CommissionConfig,
  type CommissionBreakdown,
  UserEventType,
} from '@bitcrm/types';
import { CommissionRepository } from './commission.repository';
import { RolesService } from '../../roles/roles.service';
import { SetCommissionDto } from './dto/set-commission.dto';
import { calculateCommission, type DealInputs } from './commission.calc';

const TECHNICIAN_ROLE_ID = 'role-technician';
const USER_EVENTS_TOPIC = 'user-events';

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(
    private readonly repository: CommissionRepository,
    private readonly rolesService: RolesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async getConfig(userId: string, caller: JwtUser): Promise<CommissionConfig> {
    await this.assertCanView(caller, userId);
    const config = await this.repository.getLatest(userId);
    if (!config) throw new NotFoundException('No commission config for this technician');
    return config;
  }

  async getHistory(userId: string, caller: JwtUser): Promise<CommissionConfig[]> {
    await this.assertCanView(caller, userId);
    return this.repository.listHistory(userId);
  }

  async setConfig(
    userId: string,
    dto: SetCommissionDto,
    caller: JwtUser,
  ): Promise<CommissionConfig> {
    await this.assertManager(caller);

    const now = new Date().toISOString();
    const config: CommissionConfig = {
      userId,
      baseRatePct: dto.baseRatePct,
      creditCardFeePct: dto.creditCardFeePct ?? 3,
      achFeePct: dto.achFeePct ?? 0,
      effectiveDate: dto.effectiveDate ?? now,
      createdBy: caller.id,
      createdAt: now,
    };
    await this.repository.create(config);
    this.logger.log(
      `Commission set for ${userId}: base ${config.baseRatePct}% by ${caller.id}`,
    );

    this.publish(UserEventType.COMMISSION_UPDATED, {
      technicianId: userId,
      baseRatePct: config.baseRatePct,
      effectiveDate: config.effectiveDate,
    });
    this.publish(UserEventType.TECH_UPDATED, { technicianId: userId, changedFields: ['commission'] });
    return config;
  }

  async calculate(
    userId: string,
    deal: DealInputs,
    caller: JwtUser,
  ): Promise<CommissionBreakdown> {
    await this.assertCanView(caller, userId);
    const config = await this.repository.getLatest(userId);
    if (!config) throw new NotFoundException('No commission config for this technician');
    return calculateCommission(config, deal);
  }

  // --- helpers ---

  private async assertCanView(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only view your own commission');
  }

  private async assertManager(caller: JwtUser): Promise<void> {
    if (!(await this.isPrivileged(caller))) {
      throw new ForbiddenException('Only managers can set commission');
    }
  }

  private async isPrivileged(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    const callerRole = await this.rolesService.findById(caller.roleId);
    if (callerRole.isSystem && callerRole.name === 'Super Admin') return true;
    const techRole = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return callerRole.priority > techRole.priority;
  }

  private publish(eventType: string, payload: Record<string, unknown>): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish(USER_EVENTS_TOPIC, eventType, payload)
      .catch((err) => this.logger.warn(`Failed to publish ${eventType}: ${err.message}`));
  }
}

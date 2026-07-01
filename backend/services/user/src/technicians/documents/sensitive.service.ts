import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { KmsService, SnsPublisherService } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { SensitiveRepository } from './sensitive.repository';
import { AuditRepository } from './audit.repository';
import { RolesService } from '../../roles/roles.service';
import { SetSensitiveDto } from './dto/set-sensitive.dto';

const TECHNICIAN_ROLE_ID = 'role-technician';
const ADMIN_ROLE_ID = 'role-admin';
const USER_EVENTS_TOPIC = 'user-events';

export interface SensitiveView {
  ssn: string | null;
  bankAccount: string | null;
  masked: boolean;
}

@Injectable()
export class SensitiveService {
  private readonly logger = new Logger(SensitiveService.name);

  constructor(
    private readonly kms: KmsService,
    private readonly repository: SensitiveRepository,
    private readonly audit: AuditRepository,
    private readonly rolesService: RolesService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async setSensitive(
    userId: string,
    dto: SetSensitiveDto,
    caller: JwtUser,
  ): Promise<{ updated: string[] }> {
    if (caller.id !== userId) {
      throw new ForbiddenException('You can only set your own sensitive data');
    }
    const fields: { ssnEncrypted?: string; bankAccountEncrypted?: string } = {};
    const updated: string[] = [];
    if (dto.ssn !== undefined) {
      fields.ssnEncrypted = await this.kms.encrypt(dto.ssn);
      updated.push('ssn');
    }
    if (dto.bankAccount !== undefined) {
      fields.bankAccountEncrypted = await this.kms.encrypt(dto.bankAccount);
      updated.push('bankAccount');
    }
    await this.repository.upsert(userId, fields);
    await this.writeAudit(userId, caller.id, 'sensitive.updated', updated.join(','));
    this.logger.log(`Sensitive fields updated for ${userId} (${updated.join(',')}) by ${caller.id}`);
    return { updated };
  }

  async getSensitive(userId: string, caller: JwtUser): Promise<SensitiveView> {
    await this.assertCanView(caller, userId);
    const stored = await this.repository.get(userId);
    if (!stored) return { ssn: null, bankAccount: null, masked: false };

    const ssn = stored.ssnEncrypted ? await this.kms.decrypt(stored.ssnEncrypted) : null;
    const bank = stored.bankAccountEncrypted
      ? await this.kms.decrypt(stored.bankAccountEncrypted)
      : null;

    const full = await this.isAdmin(caller);
    await this.writeAudit(userId, caller.id, 'sensitive.read', 'ssn,bankAccount');
    this.publish('sensitive.accessed', { technicianId: userId, actorId: caller.id, full });

    if (full) {
      return { ssn, bankAccount: bank, masked: false };
    }
    return {
      ssn: ssn ? this.kms.mask(ssn) : null,
      bankAccount: bank ? this.kms.mask(bank) : null,
      masked: true,
    };
  }

  /** Internal service-to-service decryption (payment-service). Audited. */
  async getBankAccountInternal(userId: string): Promise<string | null> {
    const stored = await this.repository.get(userId);
    if (!stored?.bankAccountEncrypted) return null;
    const bank = await this.kms.decrypt(stored.bankAccountEncrypted);
    await this.writeAudit(userId, 'internal:payment-service', 'sensitive.read', 'bankAccount');
    return bank;
  }

  // --- helpers ---

  private async writeAudit(
    userId: string,
    actorId: string,
    action: string,
    resource: string,
  ): Promise<void> {
    await this.audit
      .record({ userId, actorId, action, resource, timestamp: new Date().toISOString() })
      .catch((err) => this.logger.error(`Failed to write audit record: ${err.message}`));
  }

  private async assertCanView(caller: JwtUser, userId: string): Promise<void> {
    if (caller.id === userId) return;
    if (await this.isPrivileged(caller)) return;
    throw new ForbiddenException('You can only access your own sensitive data');
  }

  private async isPrivileged(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) throw new ForbiddenException('User has no roleId assigned');
    const role = await this.rolesService.findById(caller.roleId);
    if (role.isSystem && role.name === 'Super Admin') return true;
    const tech = await this.rolesService.findById(TECHNICIAN_ROLE_ID);
    return role.priority > tech.priority;
  }

  private async isAdmin(caller: JwtUser): Promise<boolean> {
    if (!caller.roleId) return false;
    const role = await this.rolesService.findById(caller.roleId);
    if (role.isSystem && role.name === 'Super Admin') return true;
    const admin = await this.rolesService.findById(ADMIN_ROLE_ID);
    return role.priority >= admin.priority;
  }

  private publish(eventType: string, payload: Record<string, unknown>): void {
    if (!this.snsPublisher) return;
    this.snsPublisher
      .publish(USER_EVENTS_TOPIC, eventType, payload)
      .catch((err) => this.logger.warn(`Failed to publish ${eventType}: ${err.message}`));
  }
}

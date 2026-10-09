import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { tryNormalizePhone } from '@bitcrm/shared';
import {
  CALL_DEVICE_LIMITS,
  CALL_DEVICE_TYPES,
  type CallDevice,
  type CallDeviceType,
} from '@bitcrm/types';
import { CallDevicesRepository } from './call-devices.repository';
import {
  type CreateCallDeviceDto,
  type UpdateCallDeviceDto,
} from './dto/call-device.dto';

/** `user@host` — enough to tell a SIP address from a typo; Twilio validates the rest. */
const SIP_ADDRESS = /^[^\s@]+@[^\s@]+$/;

/**
 * Workiz's Devices: the shop lines and desk phones a group or a Forward step
 * rings beside the softphones. A device is a name and a number (or a SIP
 * address). Nothing else is stored, so a renamed line is one edit, and
 * nothing is copied into the groups that ring it — they read the catalog at
 * ring time, the way members' numbers are read from the directory.
 *
 * Deleting one is allowed whatever names it: a group skips a device that is
 * gone (as it skips a deactivated user) and a flow that forwards to it falls
 * back to ringing everyone online, exactly as it does for a deleted group.
 */
@Injectable()
export class CallDevicesService {
  private readonly logger = new Logger(CallDevicesService.name);

  constructor(private readonly repository: CallDevicesRepository) {}

  /** How the device is rung: its number, or `sip:<address>`; null when it has neither. */
  static endpointOf(device: Pick<CallDevice, 'number' | 'sipAddress'>): string | null {
    if (device.number) return device.number;
    if (device.sipAddress) return `sip:${device.sipAddress}`;
    return null;
  }

  /* ------------------------------------------------------------ reading */

  async list(): Promise<CallDevice[]> {
    const devices = await this.repository.listAll();
    return devices.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<CallDevice> {
    const device = await this.repository.get(id);
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    return device;
  }

  /** The stored device, or null — what the runner reads mid-call, never a throw. */
  async findRaw(id: string): Promise<CallDevice | null> {
    return this.repository.get(id);
  }

  /* ------------------------------------------------------------ writing */

  async create(dto: CreateCallDeviceDto, caller: { id: string }): Promise<CallDevice> {
    const name = this.requireName(dto.name);
    await this.assertNameAvailable(name);
    const reach = this.reach(dto.number, dto.sipAddress);
    const type = this.type(dto.type);

    if ((await this.repository.listAll()).length >= CALL_DEVICE_LIMITS.maxDevices) {
      throw new BadRequestException(
        `A workspace can hold at most ${CALL_DEVICE_LIMITS.maxDevices} devices`,
      );
    }

    const now = new Date().toISOString();
    const device: CallDevice = {
      id: randomUUID(),
      name,
      ...reach,
      type,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(device);
    this.logger.log(`Device "${device.name}" created`);
    return device;
  }

  /**
   * `undefined` keeps a field, `null` clears the number or SIP address — but
   * never both at once: a device with nothing to ring is refused, as on create.
   */
  async update(
    id: string,
    dto: UpdateCallDeviceDto,
    caller: { id: string },
  ): Promise<CallDevice> {
    const existing = await this.findById(id);
    const name = dto.name === undefined ? existing.name : this.requireName(dto.name);
    if (dto.name !== undefined) await this.assertNameAvailable(name, id);

    const reach = this.reach(
      dto.number === undefined ? existing.number : dto.number,
      dto.sipAddress === undefined ? existing.sipAddress : dto.sipAddress,
    );
    const { number: _n, sipAddress: _s, ...rest } = existing;
    const updated: CallDevice = {
      ...rest,
      name,
      ...reach,
      type: dto.type === undefined ? existing.type : this.type(dto.type),
      active: dto.active ?? existing.active,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repository.delete(id);
  }

  /* --------------------------------------------------------- validation */

  private requireName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw new BadRequestException('A device needs a name');
    if (name.length > CALL_DEVICE_LIMITS.nameMaxLength) {
      throw new BadRequestException(
        `A device name can be at most ${CALL_DEVICE_LIMITS.nameMaxLength} characters`,
      );
    }
    return name;
  }

  /** Two devices called "Shop line" is a coin toss in every picker that offers them. */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const clash = (await this.repository.listAll()).find(
      (d) => d.id !== excludeId && d.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A device named "${clash.name}" already exists`);
    }
  }

  /** The number in E.164 and/or the SIP address — at least one of them. */
  private reach(
    rawNumber: string | null | undefined,
    rawSip: string | null | undefined,
  ): { number?: string; sipAddress?: string } {
    const out: { number?: string; sipAddress?: string } = {};
    if (rawNumber) {
      const number = tryNormalizePhone(rawNumber);
      if (!number) throw new BadRequestException(`${rawNumber} is not a valid phone number`);
      out.number = number;
    }
    const sip = typeof rawSip === 'string' ? rawSip.trim() : '';
    if (sip) {
      if (!SIP_ADDRESS.test(sip)) {
        throw new BadRequestException(`${sip} is not a SIP address (user@host)`);
      }
      out.sipAddress = sip;
    }
    if (!out.number && !out.sipAddress) {
      throw new BadRequestException(
        'A device needs a phone number or a SIP address to ring',
      );
    }
    return out;
  }

  private type(raw: unknown): CallDeviceType {
    if (raw === undefined) return 'desk_phone';
    if (!CALL_DEVICE_TYPES.includes(raw as CallDeviceType)) {
      throw new BadRequestException(
        `A device is one of ${CALL_DEVICE_TYPES.join(', ')}`,
      );
    }
    return raw as CallDeviceType;
  }
}

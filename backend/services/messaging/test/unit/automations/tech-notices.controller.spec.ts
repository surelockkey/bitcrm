import 'reflect-metadata';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { LateDto } from '../../../src/automations/dto/late.dto';
import { OnMyWayDto } from '../../../src/automations/dto/on-my-way.dto';
import { TechNoticesController } from '../../../src/automations/tech-notices.controller';
import { TECH, techPerms } from '../api/api-mocks';

describe('TechNoticesController', () => {
  it('answers 202 with the queued message in the envelope and hands the caller to the service', async () => {
    const service = {
      onMyWay: jest.fn(async () => ({ id: 'm1' })),
      late: jest.fn(async () => ({ id: 'm2' })),
    };
    const controller = new TechNoticesController(service as any);
    const perms = techPerms();
    expect(await controller.onMyWay({ dealId: 'd1', etaMinutes: 10 }, TECH, perms)).toEqual({ success: true, data: { id: 'm1' } });
    expect(service.onMyWay).toHaveBeenCalledWith({ dealId: 'd1', etaMinutes: 10 }, { user: TECH, perms });
    expect(await controller.late({ dealId: 'd1', minutes: 20 }, TECH, perms)).toEqual({ success: true, data: { id: 'm2' } });

    for (const method of ['onMyWay', 'late'] as const) {
      expect(Reflect.getMetadata(PERMISSION_KEY, TechNoticesController.prototype[method])).toEqual({ resource: 'messages', action: 'send' });
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, TechNoticesController.prototype[method])).toBe(202);
    }
  });

  it('validates the bodies', async () => {
    expect(await validate(plainToInstance(OnMyWayDto, { dealId: 'd1' }))).toHaveLength(0);
    expect(await validate(plainToInstance(OnMyWayDto, { dealId: 'd1', etaMinutes: 0 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(OnMyWayDto, { dealId: '', clientMessageId: 'nope' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(LateDto, { dealId: 'd1', minutes: 15 }))).toHaveLength(0);
    expect(await validate(plainToInstance(LateDto, { dealId: 'd1' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(LateDto, { dealId: 'd1', minutes: 601 }))).not.toHaveLength(0);
  });
});

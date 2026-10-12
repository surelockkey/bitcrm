import { ForbiddenException } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { DealsModule } from 'src/deals/deals.module';
import { ClientPhoneController } from 'src/deals/client-phone/client-phone.controller';
import { ChangeClientPhoneDto } from 'src/deals/client-phone/dto/change-client-phone.dto';
import { createMockDeal, createMockJwtUser } from '../mocks';

const perms = (permissions: Record<string, Record<string, boolean>>) => ({ permissions, dataScope: {} }) as never;

describe('ClientPhoneController — PUT /deals/:id/client-phone', () => {
  const service = { change: jest.fn() };
  const controller = new ClientPhoneController(service as never);
  const user = createMockJwtUser({ id: 'u-1' });

  beforeEach(() => service.change.mockReset().mockResolvedValue({ deal: createMockDeal(), otherJobsChanged: 0 }));

  it('is a deals route, gated by deals.edit', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers).toContain(ClientPhoneController);
    expect(Reflect.getMetadata(PATH_METADATA, ClientPhoneController.prototype.change)).toBe(':id/client-phone');
    expect(Reflect.getMetadata(PERMISSION_KEY, ClientPhoneController.prototype.change)).toEqual({
      resource: 'deals',
      action: 'edit',
    });
  });

  it('asks the client’s numbers grant: without it a number cannot be put on a job', async () => {
    await expect(
      controller.change('deal-1', { phone: '+14045550199', scope: 'job' }, user, perms({ deals: { edit: true } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.change).not.toHaveBeenCalled();
  });

  it('asks contacts.edit too when the number goes to the client profile', async () => {
    const noEdit = perms({ deals: { edit: true }, contacts: { view_numbers: true } });
    await expect(controller.change('deal-1', { phone: '+14045550199', scope: 'client' }, user, noEdit)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.change('deal-1', { phone: '+14045550199', scope: 'open_jobs' }, user, noEdit),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.change('deal-1', { phone: '+14045550199', scope: 'job' }, user, noEdit)).resolves.toBeTruthy();
  });

  it('answers the job and how many other jobs moved', async () => {
    const all = perms({ contacts: { view_numbers: true, edit: true } });
    await expect(controller.change('deal-1', { phone: '+14045550199', scope: 'client' }, user, all)).resolves.toEqual({
      success: true,
      data: { deal: expect.objectContaining({ id: 'deal-1' }), otherJobsChanged: 0 },
    });
    expect(service.change).toHaveBeenCalledWith('deal-1', { phone: '+14045550199', scope: 'client' }, user);
  });
});

describe('ChangeClientPhoneDto', () => {
  const errorsOf = async (payload: object) =>
    (await validate(plainToInstance(ChangeClientPhoneDto, payload), { whitelist: true, forbidNonWhitelisted: true })).map(
      (e) => e.property,
    );

  it('takes a number and one of the three scopes', async () => {
    for (const scope of ['job', 'client', 'open_jobs']) {
      expect(await errorsOf({ phone: '+14045550199', scope })).toEqual([]);
    }
  });

  it('refuses another scope, no number, or anything else', async () => {
    expect(await errorsOf({ phone: '+14045550199', scope: 'everywhere' })).toEqual(['scope']);
    expect(await errorsOf({ scope: 'job' })).toEqual(['phone']);
    expect(await errorsOf({ phone: '+14045550199', scope: 'job', previous: '+1' })).toEqual(['previous']);
  });
});

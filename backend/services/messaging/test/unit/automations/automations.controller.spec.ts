import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { AutomationsController } from '../../../src/automations/automations.controller';
import { UpdateAutomationDto } from '../../../src/automations/dto/update-automation.dto';
import { ADMIN } from '../api/api-mocks';

function makeController() {
  const service = {
    list: jest.fn(async () => [{ id: 'new-job-sms' }]),
    get: jest.fn(async (id: string) => ({ id })),
    update: jest.fn(async (id: string, dto: unknown, caller: { id: string }) => ({ id, ...(dto as object), updatedBy: caller.id })),
  };
  return { controller: new AutomationsController(service as any), service };
}

describe('AutomationsController', () => {
  it('wraps list / get / update in the envelope and passes the caller through', async () => {
    const { controller, service } = makeController();
    expect(await controller.list()).toEqual({ success: true, data: [{ id: 'new-job-sms' }] });
    expect(await controller.get('late')).toEqual({ success: true, data: { id: 'late' } });
    expect(await controller.update('late', { enabled: false }, ADMIN)).toEqual({
      success: true,
      data: { id: 'late', enabled: false, updatedBy: ADMIN.id },
    });
    expect(service.update).toHaveBeenCalledWith('late', { enabled: false }, ADMIN);
  });

  it('guards the routes with settings.view / settings.edit', () => {
    const perm = (method: string) => Reflect.getMetadata(PERMISSION_KEY, AutomationsController.prototype[method as keyof AutomationsController]);
    expect(perm('list')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('get')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('update')).toEqual({ resource: 'settings', action: 'edit' });
  });

  it('validates the patch body', async () => {
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: true, name: 'x' }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: 'yes' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { name: '' }))).not.toHaveLength(0);
  });
});

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
    migrate: jest.fn(async () => [
      { id: 'w1', name: 'Canceled job & techs', runnable: true, trigger: 'deal.status_changed', actions: ['send_sms:assigned_techs'], written: true },
      { id: 'w2', name: 'Invoice due', runnable: false, reason: 'invoices are not an automation entity', actions: [], written: false },
    ]),
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
    expect(perm('migrate')).toEqual({ resource: 'settings', action: 'edit' });
  });

  it('answers the coverage table on migrate, and writes nothing on a dry run', async () => {
    const { controller, service } = makeController();
    expect(await controller.migrate(ADMIN)).toEqual({
      success: true,
      data: { rules: 2, runnable: 1, written: 1, coverage: expect.any(Array) },
    });
    expect(service.migrate).toHaveBeenCalledWith(ADMIN, { dryRun: false });

    await controller.migrate(ADMIN, 'true');
    expect(service.migrate).toHaveBeenLastCalledWith(ADMIN, { dryRun: true });
  });

  it('validates the patch body', async () => {
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: true, name: 'x' }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: 'yes' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { name: '' }))).not.toHaveLength(0);
  });

  it('validates an edited spec down to its trigger, conditions and actions', async () => {
    const spec = {
      version: 1,
      trigger: { kind: 'deal.status_changed', to: ['done'] },
      conditions: [{ field: 'tag', op: 'in', values: ['t1'], labels: ['VIP'] }],
      actions: [{ type: 'send_sms', to: 'client', body: 'Hi {{first_name}}' }],
      timing: { delayMinutes: 60, quietHours: 'hold' },
    };
    expect(await validate(plainToInstance(UpdateAutomationDto, { spec }))).toHaveLength(0);

    for (const bad of [
      { ...spec, trigger: { kind: 'deal.exploded' } },
      { ...spec, conditions: [{ field: 'moonPhase', op: 'in' }] },
      { ...spec, actions: [{ type: 'launch_missile' }] },
      { ...spec, timing: { delayMinutes: 999999 } },
      { ...spec, actions: [{ type: 'send_sms', to: 'the_neighbour' }] },
    ]) {
      expect(await validate(plainToInstance(UpdateAutomationDto, { spec: bad }))).not.toHaveLength(0);
    }
  });
});

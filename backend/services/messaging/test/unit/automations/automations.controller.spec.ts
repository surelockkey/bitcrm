import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { AutomationsController } from '../../../src/automations/automations.controller';
import { CreateAutomationDto } from '../../../src/automations/dto/create-automation.dto';
import { DuplicateAutomationDto } from '../../../src/automations/dto/duplicate-automation.dto';
import {
  AUTOMATION_RUNS_PAGE_DEFAULT,
  AUTOMATION_RUNS_PAGE_MAX,
  ListAutomationRunsQueryDto,
} from '../../../src/automations/dto/list-automation-runs-query.dto';
import { InvalidCursorError } from '../../../src/common/cursor';
import { UpdateAutomationDto } from '../../../src/automations/dto/update-automation.dto';
import { ADMIN } from '../api/api-mocks';

function makeController() {
  const service = {
    list: jest.fn(async () => [{ id: 'new-job-sms' }]),
    get: jest.fn(async (id: string) => ({ id })),
    create: jest.fn(async (dto: { name: string }, caller: { id: string }) => ({ id: 'r-new', ...dto, createdBy: caller.id })),
    remove: jest.fn(async (id: string) => ({ id })),
    duplicate: jest.fn(async (id: string, name: string | undefined) => ({ id: 'r-copy', name: name ?? `${id} (copy)` })),
    update: jest.fn(async (id: string, dto: unknown, caller: { id: string }) => ({ id, ...(dto as object), updatedBy: caller.id })),
    migrate: jest.fn(async () => [
      { id: 'w1', name: 'Canceled job & techs', runnable: true, trigger: 'deal.status_changed', actions: ['send_sms:assigned_techs'], written: true },
      { id: 'w2', name: 'Invoice due', runnable: false, reason: 'invoices are not an automation entity', actions: [], written: false },
    ]),
  };
  const runs = {
    listByRule: jest.fn(async () => [{ id: 'run-1', ruleId: 'late', outcome: 'sent', actions: [] }]),
    listFeed: jest.fn(async () => ({ items: [{ id: 'run-1', ruleId: 'late', outcome: 'sent', actions: [] }], nextCursor: 'c2' })),
  };
  const engine = {
    testRun: jest.fn(async () => ({ id: 'run-2', ruleId: 'late', outcome: 'dry_run', actions: [] })),
    invalidate: jest.fn(),
  };
  return { controller: new AutomationsController(service as any, runs as any, engine as any), service, runs, engine };
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

  it('drops the engine\'s rule cache after an edit, so a switch takes effect at once', async () => {
    const { controller, engine } = makeController();
    await controller.update('late', { enabled: true }, ADMIN);
    expect(engine.invalidate).toHaveBeenCalledTimes(1);

    await controller.migrate(ADMIN);
    expect(engine.invalidate).toHaveBeenCalledTimes(2);
  });

  it('guards the routes with settings.view / settings.edit', () => {
    const perm = (method: string) => Reflect.getMetadata(PERMISSION_KEY, AutomationsController.prototype[method as keyof AutomationsController]);
    expect(perm('list')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('get')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('create')).toEqual({ resource: 'settings', action: 'edit' });
    expect(perm('remove')).toEqual({ resource: 'settings', action: 'edit' });
    expect(perm('duplicate')).toEqual({ resource: 'settings', action: 'edit' });
    expect(perm('update')).toEqual({ resource: 'settings', action: 'edit' });
    expect(perm('migrate')).toEqual({ resource: 'settings', action: 'edit' });
    expect(perm('listRuns')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('listRunsFeed')).toEqual({ resource: 'settings', action: 'view' });
    expect(perm('test')).toEqual({ resource: 'settings', action: 'edit' });
  });

  it('reads the firing log with a clamped limit', async () => {
    const { controller, runs } = makeController();
    expect(await controller.listRuns('late')).toEqual({ success: true, data: expect.any(Array) });
    expect(runs.listByRule).toHaveBeenCalledWith('late', 20);
    await controller.listRuns('late', '5');
    expect(runs.listByRule).toHaveBeenLastCalledWith('late', 5);
    await controller.listRuns('late', '5000');
    expect(runs.listByRule).toHaveBeenLastCalledWith('late', 50);
    await controller.listRuns('late', 'lots');
    expect(runs.listByRule).toHaveBeenLastCalledWith('late', 20);
  });

  it('declares GET runs before GET :id, or the feed would be read as a rule called "runs"', () => {
    const methods = Object.getOwnPropertyNames(AutomationsController.prototype);
    expect(methods.indexOf('listRunsFeed')).toBeLessThan(methods.indexOf('get'));
  });

  it('serves the account-wide feed and turns a bad cursor into a 400', async () => {
    const { controller, runs } = makeController();
    const query = Object.assign(new ListAutomationRunsQueryDto(), { ruleId: 'late', outcome: 'failed' });
    expect(await controller.listRunsFeed(query)).toEqual({
      success: true,
      data: { items: expect.any(Array), nextCursor: 'c2' },
    });
    expect(runs.listFeed).toHaveBeenCalledWith(query);
    expect(query.limit).toBe(50);

    runs.listFeed.mockRejectedValueOnce(new InvalidCursorError());
    await expect(controller.listRunsFeed(new ListAutomationRunsQueryDto())).rejects.toMatchObject({ status: 400 });
  });

  it('validates the feed query: limit, outcome, since and the cursor', async () => {
    const ok = (q: object) => validate(plainToInstance(ListAutomationRunsQueryDto, q));
    expect(await ok({})).toHaveLength(0);
    expect(await ok({ limit: '200', outcome: 'skipped', since: '2026-09-01T00:00:00.000Z', ruleId: 'w1', cursor: 'abc' })).toHaveLength(0);
    // The default and the ceiling of the page size (50 / 200).
    expect(plainToInstance(ListAutomationRunsQueryDto, {}).limit).toBe(AUTOMATION_RUNS_PAGE_DEFAULT);
    for (const bad of [{ limit: '0' }, { limit: String(AUTOMATION_RUNS_PAGE_MAX + 1) }, { outcome: 'exploded' }, { since: 'yesterday' }]) {
      expect(await ok(bad)).not.toHaveLength(0);
    }
  });

  it('runs a rule against a job without sending', async () => {
    const { controller, engine } = makeController();
    const result = await controller.test('late', { dealId: 'd1' });
    expect(result.data.outcome).toBe('dry_run');
    expect(engine.testRun).toHaveBeenCalledWith('late', 'd1');
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

  it('creates a rule, passes the caller through and drops the engine cache', async () => {
    const { controller, service, engine } = makeController();
    const body = { name: 'Job canceled', spec: { version: 1, trigger: { kind: 'deal.created' }, conditions: [], actions: [] } } as never;
    expect(await controller.create(body, ADMIN)).toEqual({
      success: true,
      data: { id: 'r-new', ...(body as object), createdBy: ADMIN.id },
    });
    expect(service.create).toHaveBeenCalledWith(body, ADMIN);
    expect(engine.invalidate).toHaveBeenCalledTimes(1);
  });

  it('deletes a rule and drops the engine cache so it stops firing at once', async () => {
    const { controller, service, engine } = makeController();
    expect(await controller.remove('w1', ADMIN)).toEqual({ success: true, data: { id: 'w1' } });
    expect(service.remove).toHaveBeenCalledWith('w1', ADMIN);
    expect(engine.invalidate).toHaveBeenCalledTimes(1);
  });

  it('duplicates a rule, with or without a name for the copy', async () => {
    const { controller, service } = makeController();
    expect(await controller.duplicate('w1', {}, ADMIN)).toEqual({ success: true, data: { id: 'r-copy', name: 'w1 (copy)' } });
    expect(service.duplicate).toHaveBeenCalledWith('w1', undefined, ADMIN);

    await controller.duplicate('w1', { name: 'Bronx cancellations' }, ADMIN);
    expect(service.duplicate).toHaveBeenLastCalledWith('w1', 'Bronx cancellations', ADMIN);

    expect(await validate(plainToInstance(DuplicateAutomationDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(DuplicateAutomationDto, { name: 'x' }))).toHaveLength(0);
    expect(await validate(plainToInstance(DuplicateAutomationDto, { name: '' }))).not.toHaveLength(0);
  });

  it('validates the create body: a name and a whole spec are required', async () => {
    const spec = {
      version: 1,
      trigger: { kind: 'deal.status_changed', to: ['canceled'] },
      conditions: [{ field: 'tag', op: 'in', values: ['t1'] }],
      actions: [{ type: 'send_sms', to: 'client', body: 'Hi' }],
    };
    expect(await validate(plainToInstance(CreateAutomationDto, { name: 'Rule', spec }))).toHaveLength(0);
    expect(
      await validate(plainToInstance(CreateAutomationDto, { name: 'Rule', spec, enabled: true, category: 'phone', description: 'x' })),
    ).toHaveLength(0);

    for (const bad of [
      { spec }, // no name
      { name: '', spec },
      { name: 'Rule' }, // no spec
      { name: 'Rule', spec: { ...spec, trigger: { kind: 'deal.exploded' } } },
      { name: 'Rule', spec: { ...spec, actions: [{ type: 'launch_missile' }] } },
      { name: 'Rule', spec, enabled: 'yes' },
    ]) {
      expect(await validate(plainToInstance(CreateAutomationDto, bad))).not.toHaveLength(0);
    }
  });

  it('validates the patch body', async () => {
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: true, name: 'x' }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { enabled: 'yes' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateAutomationDto, { name: '' }))).not.toHaveLength(0);
  });

  it('takes an OR group in the conditions, and still refuses a node that is neither', async () => {
    const spec = {
      version: 1,
      trigger: { kind: 'deal.status_changed', to: ['done'] },
      conditions: [
        { field: 'status', op: 'in', values: ['done'] },
        {
          any: [
            { field: 'source', op: 'in', values: ['src-1'], labels: ['Yelp'] },
            { field: 'source', op: 'in', values: ['src-2'], labels: ['GMB'] },
          ],
        },
      ],
      actions: [{ type: 'send_sms', to: 'client', body: 'Hi' }],
    };
    expect(await validate(plainToInstance(UpdateAutomationDto, { spec }))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateAutomationDto, { name: 'Bronx review', spec }))).toHaveLength(0);

    for (const conditions of [
      [{ any: [] }], // an empty group holds for nothing: a mistake, not a rule
      [{ any: [{ field: 'moonPhase', op: 'in' }] }], // an alternative is still a real condition
      [{ any: [{ any: [{ field: 'source', op: 'in', values: ['x'] }] }] }], // groups do not nest
      [{ values: ['x'] }], // neither a condition nor a group
      // An alternative that narrows nothing holds for everything, which makes
      // the whole group hold — the rule would fire for every source next to
      // the two that are spelled out.
      [{ any: [{ field: 'source', op: 'in', values: ['src-1'] }, { field: 'jobType', op: 'in' }] }],
      [{ any: [{ field: 'source', op: 'in', values: ['src-1'] }, { field: 'jobType', op: 'in', values: [] }] }],
    ]) {
      expect(await validate(plainToInstance(UpdateAutomationDto, { spec: { ...spec, conditions } }))).not.toHaveLength(0);
    }

    // `exists` / `not_exists` compare against nothing by design, and stay legal.
    expect(
      await validate(
        plainToInstance(UpdateAutomationDto, {
          spec: { ...spec, conditions: [{ any: [{ field: 'hasTechs', op: 'not_exists' }, { field: 'source', op: 'in', values: ['s'] }] }] },
        }),
      ),
    ).toHaveLength(0);
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

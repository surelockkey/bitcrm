import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MessageTemplatesService } from '../../../src/templates/message-templates.service';
import { createMockTemplate } from '../mocks';

function makeService(templates = [createMockTemplate()]) {
  const store = new Map(templates.map((t) => [t.id, t]));
  const repo = {
    create: jest.fn(async (t) => void store.set(t.id, t)),
    put: jest.fn(async (t) => void store.set(t.id, t)),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    list: jest.fn(async (opts: { includeInactive?: boolean } = {}) =>
      [...store.values()].filter((t) => opts.includeInactive || t.active),
    ),
    archive: jest.fn(async (id: string) => {
      const t = store.get(id);
      if (t) store.set(id, { ...t, active: false });
    }),
    remove: jest.fn(async (id: string) => void store.delete(id)),
  };
  const metrics = {
    entityCreated: { inc: jest.fn() },
    entityUpdated: { inc: jest.fn() },
    entityDeleted: { inc: jest.fn() },
  };
  return { service: new MessageTemplatesService(repo as any, metrics as any), repo, store, metrics };
}

const caller = { id: 'u9' };

describe('MessageTemplatesService', () => {
  describe('create', () => {
    it('fills id, audit fields and defaults, then counts the entity', async () => {
      const { service, repo, metrics } = makeService([]);
      const created = await service.create(
        { messageTemplateTitle: 'Review', messageTemplate: '<p>Rate us, {{first_name}}</p>', channel: 'sms' },
        caller,
      );
      expect(created).toMatchObject({
        messageTemplateTitle: 'Review',
        channel: 'sms',
        isDefault: false,
        active: true,
        createdBy: 'u9',
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.createdAt).toBe(created.updatedAt);
      expect(repo.create).toHaveBeenCalledWith(created);
      expect(metrics.entityCreated.inc).toHaveBeenCalledWith({ entity_type: 'message_template' });
    });

    it('rejects an sms template whose text exceeds 1 600 characters, measured after stripping HTML', async () => {
      const { service, repo } = makeService([]);
      const text = 'x'.repeat(1601);
      await expect(
        service.create({ messageTemplateTitle: 'Long', messageTemplate: `<p>${text}</p>`, channel: 'sms' }, caller),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();

      // 1 601 characters of markup around 1 600 of text is fine.
      await expect(
        service.create(
          { messageTemplateTitle: 'Fits', messageTemplate: `<p><strong>${'y'.repeat(1600)}</strong></p>`, channel: 'any' },
          caller,
        ),
      ).resolves.toMatchObject({ channel: 'any' });
    });

    it('lets an email template be longer than an SMS', async () => {
      const { service } = makeService([]);
      await expect(
        service.create({ messageTemplateTitle: 'Newsletter', messageTemplate: 'z'.repeat(5000), channel: 'email' }, caller),
      ).resolves.toMatchObject({ channel: 'email' });
    });

    it('keeps one default per channel, `any` overlapping both', async () => {
      const { service, repo, store } = makeService([
        createMockTemplate({ id: 'sms-default', channel: 'sms', isDefault: true }),
        createMockTemplate({ id: 'email-default', channel: 'email', isDefault: true }),
      ]);
      await service.create(
        { messageTemplateTitle: 'New default', messageTemplate: 'hi', channel: 'sms', isDefault: true },
        caller,
      );
      expect(store.get('sms-default')?.isDefault).toBe(false);
      expect(store.get('email-default')?.isDefault).toBe(true);
      expect(repo.put).toHaveBeenCalledTimes(1);

      await service.create({ messageTemplateTitle: 'Both', messageTemplate: 'hi', channel: 'any', isDefault: true }, caller);
      expect(store.get('email-default')?.isDefault).toBe(false);
      expect([...store.values()].filter((t) => t.isDefault)).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('sorts by title case-insensitively, then id, and hides archived rows by default', async () => {
      const { service } = makeService([
        createMockTemplate({ id: 'b', messageTemplateTitle: 'review' }),
        createMockTemplate({ id: 'a', messageTemplateTitle: 'Review' }),
        createMockTemplate({ id: 'c', messageTemplateTitle: 'Complaint response' }),
        createMockTemplate({ id: 'd', messageTemplateTitle: 'Archived', active: false }),
      ]);
      expect((await service.list()).map((t) => t.id)).toEqual(['c', 'a', 'b']);
      expect((await service.list({ includeInactive: true })).map((t) => t.id)).toEqual(['d', 'c', 'a', 'b']);
    });

    it('offers `any` templates on both channels', async () => {
      const { service } = makeService([
        createMockTemplate({ id: 's', channel: 'sms' }),
        createMockTemplate({ id: 'e', channel: 'email' }),
        createMockTemplate({ id: 'x', channel: 'any' }),
      ]);
      expect((await service.list({ channel: 'sms' })).map((t) => t.id).sort()).toEqual(['s', 'x']);
      expect((await service.list({ channel: 'email' })).map((t) => t.id).sort()).toEqual(['e', 'x']);
    });
  });

  describe('findById / update', () => {
    it('404s on an unknown id', async () => {
      const { service } = makeService();
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.update('nope', { messageTemplateTitle: 'x' }, caller)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('merges the partial body, keeps audit fields and bumps updatedAt', async () => {
      const { service, repo } = makeService();
      const updated = await service.update('t1', { messageTemplateTitle: 'On My Way!', category: 'Tech' }, caller);
      expect(updated).toMatchObject({
        id: 't1',
        messageTemplateTitle: 'On My Way!',
        messageTemplate: '<p>Hi {{first_name}}, on my way.</p>',
        category: 'Tech',
        createdBy: 'u1',
      });
      expect(updated.updatedAt > updated.createdAt).toBe(true);
      expect(repo.put).toHaveBeenCalledWith(updated);
    });

    it('re-checks the SMS length when the channel or body changes', async () => {
      const { service } = makeService([createMockTemplate({ channel: 'email', messageTemplate: 'z'.repeat(2000) })]);
      await expect(service.update('t1', { channel: 'sms' }, caller)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('restores an archived template with active: true', async () => {
      const { service } = makeService([createMockTemplate({ active: false })]);
      expect((await service.update('t1', { active: true }, caller)).active).toBe(true);
    });

    it('clears other defaults only when the template becomes the default', async () => {
      const { service, repo, store } = makeService([
        createMockTemplate({ id: 't1', isDefault: true }),
        createMockTemplate({ id: 't2' }),
      ]);
      await service.update('t1', { messageTemplateTitle: 'still default' }, caller);
      expect(repo.put).toHaveBeenCalledTimes(1);

      await service.update('t2', { isDefault: true }, caller);
      expect(store.get('t1')?.isDefault).toBe(false);
    });
  });

  describe('archive / remove', () => {
    it('archives through the repository and is idempotent', async () => {
      const { service, repo } = makeService();
      expect((await service.archive('t1', caller)).active).toBe(false);
      expect(repo.archive).toHaveBeenCalledWith('t1');
      await service.archive('t1', caller);
      expect(repo.archive).toHaveBeenCalledTimes(1);
    });

    it('refuses to delete an active template permanently', async () => {
      const { service, repo } = makeService();
      await expect(service.remove('t1', caller)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('deletes an archived template and counts it', async () => {
      const { service, repo, metrics } = makeService([createMockTemplate({ active: false })]);
      await service.remove('t1', caller);
      expect(repo.remove).toHaveBeenCalledWith('t1');
      expect(metrics.entityDeleted.inc).toHaveBeenCalledWith({ entity_type: 'message_template' });
      await expect(service.findById('t1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

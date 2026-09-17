jest.mock('src/documents/renderer', () => ({
  DOCUMENT_PRESETS: [{ id: 'classic', name: 'Classic', description: '' }],
  createTemplateContent: jest.fn((kind: string, presetId?: string) => ({
    page: { size: 'letter', preset: presetId ?? 'classic', kind },
    header: [],
    body: [{ id: 'r1', columns: [] }],
    footer: [],
    visibility: { quantity: true },
  })),
  validateTemplateContent: jest.fn((content: unknown) => ({ ok: true, value: content })),
  renderDocumentHtml: jest.fn(() => '<html></html>'),
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DocumentTemplate } from '@bitcrm/types';
import { TemplatesService } from 'src/templates/templates.service';
import { TemplateVersionConflictError } from 'src/templates/templates.repository';
import * as renderer from 'src/documents/renderer';
import { NOW, user } from './mocks';

function mockRepo() {
  const store = new Map<string, DocumentTemplate>();
  return {
    store,
    list: jest.fn(async () => [...store.values()]),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    createIfAbsent: jest.fn(async (t: DocumentTemplate) => {
      if (store.has(t.id)) return false;
      store.set(t.id, t);
      return true;
    }),
    replace: jest.fn(async (t: DocumentTemplate, expected: number) => {
      if (store.get(t.id)?.version !== expected) throw new TemplateVersionConflictError();
      store.set(t.id, t);
    }),
    setDefault: jest.fn(async (id: string, others: string[]) => {
      store.get(id)!.isDefault = true;
      for (const o of others) if (o !== id) store.get(o)!.isDefault = false;
    }),
    delete: jest.fn(async (id: string) => void store.delete(id)),
  };
}

describe('TemplatesService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let service: TemplatesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    service = new TemplatesService(repo as never);
  });
  afterEach(() => jest.useRealTimers());

  it('seeds the default invoice + estimate templates on first list, idempotently', async () => {
    const first = await service.list();
    expect(first.map((t) => t.id).sort()).toEqual(['tpl-default-estimate', 'tpl-default-invoice']);
    expect(first.every((t) => t.isDefault)).toBe(true);
    expect(renderer.createTemplateContent).toHaveBeenCalledWith('invoice', 'classic');
    expect(renderer.createTemplateContent).toHaveBeenCalledWith('estimate', 'classic');
    await service.list();
    expect(repo.store.size).toBe(2);
    // summaries don't carry the content
    expect((first[0] as unknown as Record<string, unknown>).body).toBeUndefined();
  });

  it('creates from a preset or copies another template', async () => {
    const created = await service.create({ name: 'Modern', kind: 'invoice', presetId: 'modern' }, user());
    expect(created).toMatchObject({ name: 'Modern', kind: 'invoice', isDefault: false, version: 1, preset: 'modern' });
    expect(renderer.createTemplateContent).toHaveBeenCalledWith('invoice', 'modern');

    const copy = await service.create({ name: 'Copy', kind: 'invoice', fromTemplateId: created.id }, user());
    expect(copy.body).toEqual(created.body);
    expect(copy.id).not.toBe(created.id);

    await expect(
      service.create({ name: 'x', kind: 'invoice', fromTemplateId: 'missing' }, user()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates with a matching version and 409s on a stale one', async () => {
    const t = await service.create({ name: 'A', kind: 'estimate' }, user());
    const content = { page: t.page, header: [], body: [], footer: [], visibility: t.visibility };
    const saved = await service.update(t.id, { ...content, name: 'B', version: 1 }, user());
    expect(saved.version).toBe(2);
    expect(saved.name).toBe('B');
    expect(saved.updatedBy).toBe('u-1');

    await expect(service.update(t.id, { ...content, version: 1 }, user())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409s when the version moved between the read and the write', async () => {
    const t = await service.create({ name: 'A', kind: 'estimate' }, user());
    repo.replace.mockRejectedValueOnce(new TemplateVersionConflictError());
    await expect(
      service.update(t.id, { page: t.page, header: [], body: [], footer: [], visibility: t.visibility, version: 1 }, user()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('400s with the validator errors for invalid content', async () => {
    const t = await service.create({ name: 'A', kind: 'estimate' }, user());
    (renderer.validateTemplateContent as jest.Mock).mockReturnValueOnce({ ok: false, errors: ['bad row'] });
    await expect(
      service.update(t.id, { page: t.page, header: [], body: [], footer: [], visibility: t.visibility, version: 1 }, user()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('duplicates as a non-default copy', async () => {
    await service.list();
    const dup = await service.duplicate('tpl-default-invoice', user());
    expect(dup.isDefault).toBe(false);
    expect(dup.name).toMatch(/copy/i);
    expect(dup.kind).toBe('invoice');
  });

  it('sets a new default for its kind only', async () => {
    await service.list();
    const t = await service.create({ name: 'Inv 2', kind: 'invoice' }, user());
    await service.setDefault(t.id);
    expect(repo.setDefault).toHaveBeenCalledWith(t.id, ['tpl-default-invoice'], NOW);
    expect(repo.store.get('tpl-default-estimate')!.isDefault).toBe(true);
  });

  it('refuses to delete a default template', async () => {
    await service.list();
    await expect(service.delete('tpl-default-invoice')).rejects.toBeInstanceOf(ConflictException);
    const t = await service.create({ name: 'x', kind: 'invoice' }, user());
    await service.delete(t.id);
    expect(repo.store.has(t.id)).toBe(false);
  });

  it('stores autoApply.businessProfileIds (deduplicated) and drops an empty rule', async () => {
    const t = await service.create({ name: 'Brand', kind: 'invoice' }, user());
    const content = { page: t.page, header: [], body: [], footer: [], visibility: t.visibility };
    const saved = await service.update(
      t.id,
      { ...content, autoApply: { businessProfileIds: ['bp-2', 'bp-2'], jobTypeIds: [] }, version: 1 },
      user(),
    );
    expect(saved.autoApply).toEqual({ businessProfileIds: ['bp-2'] });
    const cleared = await service.update(t.id, { ...content, autoApply: { businessProfileIds: [] }, version: 2 }, user());
    expect(cleared.autoApply).toBeUndefined();
  });

  describe('resolveForDocument', () => {
    it('explicit → auto-apply → default → seeded default', async () => {
      await service.list();
      const auto = await service.create({ name: 'Rekey', kind: 'invoice' }, user());
      repo.store.get(auto.id)!.autoApply = { jobTypeIds: ['jt-rekey'] };
      const explicit = await service.create({ name: 'Explicit', kind: 'invoice' }, user());

      expect((await service.resolveForDocument({ kind: 'invoice', templateId: explicit.id })).id).toBe(explicit.id);
      expect((await service.resolveForDocument({ kind: 'invoice', jobTypeId: 'jt-rekey' })).id).toBe(auto.id);
      expect((await service.resolveForDocument({ kind: 'invoice', jobTypeId: 'other' })).id).toBe('tpl-default-invoice');

      const brand = await service.create({ name: 'Brand', kind: 'invoice' }, user());
      repo.store.get(brand.id)!.autoApply = { businessProfileIds: ['bp-2'] };
      expect((await service.resolveForDocument({ kind: 'invoice', businessProfileId: 'bp-2' })).id).toBe(brand.id);

      // no default flagged any more (e.g. data drift) → the seeded one by id
      repo.store.get('tpl-default-estimate')!.isDefault = false;
      expect((await service.resolveForDocument({ kind: 'estimate' })).id).toBe('tpl-default-estimate');
    });
  });
});

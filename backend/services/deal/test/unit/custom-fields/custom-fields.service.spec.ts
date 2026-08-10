import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomFieldsService } from 'src/custom-fields/custom-fields.service';
import {
  createMockCustomFieldsRepository,
  createMockSnsPublisherService,
  createMockCustomField,
  createMockJwtUser,
} from '../mocks';

describe('CustomFieldsService', () => {
  let repo: ReturnType<typeof createMockCustomFieldsRepository>;
  let sns: ReturnType<typeof createMockSnsPublisherService>;
  let service: CustomFieldsService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockCustomFieldsRepository();
    sns = createMockSnsPublisherService();
    service = new CustomFieldsService(repo as any, sns as any);
  });

  describe('create', () => {
    it('persists a new custom field and emits an event', async () => {
      const field = await service.create(
        { name: 'Gate Code', type: 'text', group: 'Access', priority: 5 } as any,
        caller,
      );

      expect(field).toMatchObject({
        name: 'Gate Code',
        type: 'text',
        group: 'Access',
        priority: 5,
        active: true,
      });
      expect(field.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gate Code' }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'custom-field.created', expect.any(Object));
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockCustomField({ name: 'Gate Code' })]);
      await expect(
        service.create({ name: '  gate code ', type: 'text' } as any, caller),
      ).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('requires non-empty options for a dropdown field', async () => {
      await expect(
        service.create({ name: 'Lock Brand', type: 'dropdown' } as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accepts a dropdown field with options', async () => {
      const field = await service.create(
        { name: 'Lock Brand', type: 'dropdown', options: ['Kwikset', 'Schlage'] } as any,
        caller,
      );
      expect(field.options).toEqual(['Kwikset', 'Schlage']);
    });

    it('rejects options on a non-option field type', async () => {
      await expect(
        service.create({ name: 'Notes', type: 'text', options: ['a', 'b'] } as any, caller),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockCustomField({ id: 'cf-1', name: 'Gate Code' }));
      repo.listAll.mockResolvedValue([
        createMockCustomField({ id: 'cf-1', name: 'Gate Code' }),
        createMockCustomField({ id: 'cf-2', name: 'Lock Brand' }),
      ]);
      await expect(
        service.update('cf-1', { name: 'Lock Brand' } as any, caller),
      ).rejects.toThrow(ConflictException);
    });

    it('allows keeping the same name', async () => {
      repo.get.mockResolvedValue(createMockCustomField({ id: 'cf-1', name: 'Gate Code' }));
      repo.listAll.mockResolvedValue([createMockCustomField({ id: 'cf-1', name: 'Gate Code' })]);
      const updated = await service.update('cf-1', { name: 'Gate Code', priority: 9 } as any, caller);
      expect(updated.priority).toBe(9);
      expect(repo.put).toHaveBeenCalled();
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'custom-field.updated', expect.any(Object));
    });
  });

  describe('remove', () => {
    it('archives a referenced custom field instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockCustomField({ id: 'cf-1', active: true }));
      repo.isReferencedByDeal.mockResolvedValue(true);

      const result = await service.remove('cf-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'custom-field.archived', expect.any(Object));
    });

    it('hard-deletes an unreferenced custom field', async () => {
      repo.get.mockResolvedValue(createMockCustomField({ id: 'cf-1' }));
      repo.isReferencedByDeal.mockResolvedValue(false);

      const result = await service.remove('cf-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('cf-1');
      expect(sns.publish).toHaveBeenCalledWith('deal-events', 'custom-field.deleted', expect.any(Object));
    });

    it('404s when the custom field is missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('missing', caller)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('sorts by priority desc, then name asc', async () => {
      repo.listAll.mockResolvedValue([
        createMockCustomField({ name: 'B', priority: 1 }),
        createMockCustomField({ name: 'A', priority: 5 }),
        createMockCustomField({ name: 'A2', priority: 5 }),
      ]);
      const list = await service.list();
      expect(list.map((f) => f.name)).toEqual(['A', 'A2', 'B']);
    });
  });

  describe('findById', () => {
    it('404s when missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });
});

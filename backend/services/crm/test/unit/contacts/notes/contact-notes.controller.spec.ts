import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { ContactNotesController } from 'src/contacts/notes/contact-notes.controller';
import { ContactNotesService } from 'src/contacts/notes/contact-notes.service';
import { createMockJwtUser } from '../../mocks';

const note = {
  id: 'note-1',
  contactId: 'contact-1',
  note: 'Gate code 1234',
  actorId: 'admin-1',
  actorName: 'admin@test.com',
  pinned: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('ContactNotesController', () => {
  let controller: ContactNotesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      controllers: [ContactNotesController],
      providers: [{ provide: ContactNotesService, useValue: service }],
    }).compile();
    controller = module.get(ContactNotesController);
  });

  it('lists with the paging envelope and the first-page notesCount', async () => {
    service.list.mockResolvedValue({ items: [note], nextCursor: 'c2', notesCount: 7 });

    const result = await controller.list('contact-1', { limit: '20' } as never);

    expect(service.list).toHaveBeenCalledWith('contact-1', { limit: '20' });
    expect(result).toEqual({
      success: true,
      data: [note],
      pagination: { nextCursor: 'c2', count: 1, notesCount: 7 },
    });
  });

  it('leaves notesCount off the envelope on later pages', async () => {
    service.list.mockResolvedValue({ items: [note], nextCursor: undefined });

    const result = await controller.list('contact-1', { cursor: 'c2' } as never);

    expect(result.pagination).toEqual({ nextCursor: undefined, count: 1 });
    expect(result.pagination).not.toHaveProperty('notesCount');
  });

  it('answers the count for the rail badge', async () => {
    service.count.mockResolvedValue(1);

    expect(await controller.count('contact-1')).toEqual({ success: true, data: { total: 1 } });
  });

  it('creates as the current user', async () => {
    const caller = createMockJwtUser();
    service.create.mockResolvedValue(note);

    const result = await controller.create('contact-1', { note: 'Gate code 1234' }, caller);

    expect(service.create).toHaveBeenCalledWith('contact-1', { note: 'Gate code 1234' }, caller);
    expect(result).toEqual({ success: true, data: note });
  });

  it('updates and returns the note', async () => {
    service.update.mockResolvedValue({ ...note, pinned: true });

    const result = await controller.update('contact-1', 'note-1', { pinned: true });

    expect(service.update).toHaveBeenCalledWith('contact-1', 'note-1', { pinned: true });
    expect(result).toEqual({ success: true, data: { ...note, pinned: true } });
  });

  it('deletes and says so', async () => {
    const result = await controller.remove('contact-1', 'note-1');

    expect(service.delete).toHaveBeenCalledWith('contact-1', 'note-1');
    expect(result).toEqual({ success: true, data: { deleted: true } });
  });

  it('guards reads with contacts.view and writes with contacts.edit', () => {
    const reflector = new Reflector();
    const perm = (handler: (...args: never[]) => unknown) => reflector.get(PERMISSION_KEY, handler);

    expect(perm(controller.list)).toEqual({ resource: 'contacts', action: 'view' });
    expect(perm(controller.count)).toEqual({ resource: 'contacts', action: 'view' });
    expect(perm(controller.create)).toEqual({ resource: 'contacts', action: 'edit' });
    expect(perm(controller.update)).toEqual({ resource: 'contacts', action: 'edit' });
    expect(perm(controller.remove)).toEqual({ resource: 'contacts', action: 'edit' });
  });
});

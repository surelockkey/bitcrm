import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type ContactNote } from '@bitcrm/types';
import { ContactNotesService } from 'src/contacts/notes/contact-notes.service';
import { ContactNotesRepository } from 'src/contacts/notes/contact-notes.repository';
import { ContactsService } from 'src/contacts/contacts.service';
import { createMockContact, createMockJwtUser, createMockSnsPublisherService } from '../../mocks';

const note = (overrides: Partial<ContactNote> = {}): ContactNote => ({
  id: 'note-1',
  contactId: 'contact-1',
  note: 'Gate code 1234',
  actorId: 'admin-1',
  actorName: 'admin@test.com',
  pinned: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

describe('ContactNotesService', () => {
  let service: ContactNotesService;
  let repository: Record<string, jest.Mock>;
  let contacts: { findById: jest.Mock };
  let snsPublisher: ReturnType<typeof createMockSnsPublisherService>;
  const caller = createMockJwtUser({ id: 'user-7', email: 'dana@slk-s.com' });

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      listPinned: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      moveAll: jest.fn(),
    };
    contacts = { findById: jest.fn().mockResolvedValue(createMockContact()) };
    snsPublisher = createMockSnsPublisherService();

    const module = await Test.createTestingModule({
      providers: [
        ContactNotesService,
        { provide: ContactNotesRepository, useValue: repository },
        { provide: ContactsService, useValue: contacts },
        { provide: SnsPublisherService, useValue: snsPublisher },
      ],
    }).compile();
    service = module.get(ContactNotesService);
  });

  describe('create', () => {
    it('stores a trimmed, unpinned note authored by the caller and publishes contact.note_added', async () => {
      const result = await service.create('contact-1', { note: '  Gate code 1234  ' }, caller);

      expect(result).toMatchObject({
        id: expect.any(String),
        contactId: 'contact-1',
        note: 'Gate code 1234',
        actorId: 'user-7',
        actorName: 'dana@slk-s.com',
        pinned: false,
      });
      expect(result.createdAt).toBe(result.updatedAt);
      expect(repository.create).toHaveBeenCalledWith(result);
      expect(snsPublisher.publish).toHaveBeenCalledWith('crm', 'contact.note_added', {
        contactId: 'contact-1',
        noteId: result.id,
        actorId: 'user-7',
        actorName: 'dana@slk-s.com',
        createdAt: result.createdAt,
      });
    });

    it('404s when the contact does not exist, before writing anything', async () => {
      contacts.findById.mockRejectedValue(new NotFoundException('Contact not found'));

      await expect(service.create('ghost', { note: 'x' }, caller)).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', ''],
      ['whitespace', '   '],
      ['too long', 'a'.repeat(5001)],
      ['not a string', 42],
      ['missing', undefined],
    ])('rejects a %s note with 400', async (_label, bad) => {
      await expect(service.create('contact-1', { note: bad } as never, caller)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('accepts exactly 5000 characters', async () => {
      const result = await service.create('contact-1', { note: 'a'.repeat(5000) }, caller);
      expect(result.note).toHaveLength(5000);
    });
  });

  describe('list', () => {
    const older = note({ id: 'n-old', createdAt: '2026-09-01T00:00:00.000Z' });
    const newer = note({ id: 'n-new', createdAt: '2026-10-01T00:00:00.000Z' });
    const pinnedOld = note({ id: 'n-pin', pinned: true, createdAt: '2026-01-01T00:00:00.000Z' });

    it('puts pinned notes first on the first page, then the rest newest first, without repeating a pinned one', async () => {
      repository.listPinned.mockResolvedValue([pinnedOld]);
      repository.list.mockResolvedValue({ items: [newer, pinnedOld, older], nextCursor: 'c2' });
      repository.count.mockResolvedValue(3);

      const result = await service.list('contact-1', { limit: '20' });

      expect(result.items.map((n) => n.id)).toEqual(['n-pin', 'n-new', 'n-old']);
      expect(result.nextCursor).toBe('c2');
      expect(result.notesCount).toBe(3);
      expect(repository.list).toHaveBeenCalledWith('contact-1', 20, undefined);
    });

    it('on a later page skips the pinned ones (already shown on page one) and carries no count', async () => {
      repository.list.mockResolvedValue({ items: [pinnedOld, older], nextCursor: undefined });

      const result = await service.list('contact-1', { limit: '20', cursor: 'c2' });

      expect(result.items.map((n) => n.id)).toEqual(['n-old']);
      expect(result.notesCount).toBeUndefined();
      expect(repository.listPinned).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
      expect(repository.list).toHaveBeenCalledWith('contact-1', 20, 'c2');
    });

    it('coerces the limit (query strings arrive as strings) and clamps it to 1..100', async () => {
      await service.list('contact-1', { limit: '500' });
      expect(repository.list).toHaveBeenLastCalledWith('contact-1', 100, undefined);

      await service.list('contact-1', { limit: 'abc' });
      expect(repository.list).toHaveBeenLastCalledWith('contact-1', 20, undefined);

      await service.list('contact-1', { limit: '0' });
      expect(repository.list).toHaveBeenLastCalledWith('contact-1', 20, undefined);
    });

    it('404s for an unknown contact', async () => {
      contacts.findById.mockRejectedValue(new NotFoundException('Contact not found'));

      await expect(service.list('ghost', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('count', () => {
    it('answers how many notes the client has', async () => {
      repository.count.mockResolvedValue(4);
      expect(await service.count('contact-1')).toBe(4);
    });
  });

  describe('update', () => {
    it('edits the text and the pin of an existing note', async () => {
      const existing = note();
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue({ ...existing, note: 'Changed', pinned: true });

      const result = await service.update('contact-1', 'note-1', { note: ' Changed ', pinned: true });

      expect(repository.update).toHaveBeenCalledWith(existing, { note: 'Changed', pinned: true });
      expect(result.pinned).toBe(true);
    });

    it('404s when the note is not under this contact', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update('contact-1', 'ghost', { pinned: true })).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects a body that changes nothing', async () => {
      repository.findById.mockResolvedValue(note());

      await expect(service.update('contact-1', 'note-1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-boolean pin (no global ValidationPipe guards the body)', async () => {
      repository.findById.mockResolvedValue(note());

      await expect(
        service.update('contact-1', 'note-1', { pinned: 'true' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an over-long or blank replacement text', async () => {
      repository.findById.mockResolvedValue(note());

      await expect(service.update('contact-1', 'note-1', { note: '' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.update('contact-1', 'note-1', { note: 'a'.repeat(5001) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete', () => {
    it('removes an existing note', async () => {
      const existing = note();
      repository.findById.mockResolvedValue(existing);

      await service.delete('contact-1', 'note-1');

      expect(repository.delete).toHaveBeenCalledWith(existing);
    });

    it('404s for a note that is not there', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete('contact-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.delete).not.toHaveBeenCalled();
    });
  });
});

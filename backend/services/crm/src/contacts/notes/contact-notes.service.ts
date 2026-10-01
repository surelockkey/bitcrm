import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { BusinessMetricsService, SnsPublisherService } from '@bitcrm/shared';
import {
  CONTACT_NOTE_MAX_LENGTH,
  ContactEventType,
  type ContactNote,
  type ContactNoteAddedEvent,
  type JwtUser,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ContactsService } from '../contacts.service';
import { ContactNotesRepository } from './contact-notes.repository';
import { type CreateContactNoteDto } from './dto/create-contact-note.dto';
import { type UpdateContactNoteDto } from './dto/update-contact-note.dto';

export interface ContactNotesListResult {
  items: ContactNote[];
  nextCursor?: string;
  /** Only on the first page: how many notes the client has in all (the rail badge). */
  notesCount?: number;
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

/**
 * The client card's Notes panel. Access is gated by `contacts.view` /
 * `contacts.edit` at the controller; here are the rules: a note is 1–5000
 * trimmed characters, pinned notes lead the feed, and the author is whoever
 * holds the token.
 */
@Injectable()
export class ContactNotesService {
  private readonly logger = new Logger(ContactNotesService.name);

  constructor(
    private readonly repository: ContactNotesRepository,
    private readonly contacts: ContactsService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * The first page is pinned notes (newest first) followed by the newest
   * unpinned ones; later pages are unpinned only, since every pinned note was
   * already shown up top. `limit` arrives as a string — CRM has no global
   * ValidationPipe — so it is coerced and clamped here.
   */
  async list(
    contactId: string,
    query: { limit?: unknown; cursor?: string },
  ): Promise<ContactNotesListResult> {
    await this.contacts.findById(contactId);
    const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE, 1), MAX_PAGE);
    const page = await this.repository.list(contactId, limit, query.cursor);
    const rest = page.items.filter((n) => !n.pinned);

    if (query.cursor) return { items: rest, nextCursor: page.nextCursor };

    const [pinned, notesCount] = await Promise.all([
      this.repository.listPinned(contactId),
      this.repository.count(contactId),
    ]);
    return { items: [...pinned, ...rest], nextCursor: page.nextCursor, notesCount };
  }

  async count(contactId: string): Promise<number> {
    await this.contacts.findById(contactId);
    return this.repository.count(contactId);
  }

  async create(contactId: string, dto: CreateContactNoteDto, caller: JwtUser): Promise<ContactNote> {
    await this.contacts.findById(contactId);
    const text = this.normalizeText(dto.note);

    const now = new Date().toISOString();
    const note: ContactNote = {
      id: randomUUID(),
      contactId,
      note: text,
      actorId: caller.id,
      // The token carries no display name; the web names the actor from the
      // directory by `actorId` and falls back to this, as the job timeline does.
      actorName: caller.email,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(note);
    this.businessMetrics?.entityCreated.inc({ entity_type: 'contact_note' });
    this.publishNoteAdded({
      contactId,
      noteId: note.id,
      actorId: note.actorId,
      actorName: note.actorName,
      createdAt: note.createdAt,
    });
    return note;
  }

  async update(contactId: string, noteId: string, dto: UpdateContactNoteDto): Promise<ContactNote> {
    const existing = await this.requireNote(contactId, noteId);

    const attrs: { note?: string; pinned?: boolean } = {};
    if (dto.note !== undefined) attrs.note = this.normalizeText(dto.note);
    if (dto.pinned !== undefined) {
      if (typeof dto.pinned !== 'boolean') throw new BadRequestException('pinned must be a boolean');
      attrs.pinned = dto.pinned;
    }
    if (Object.keys(attrs).length === 0) {
      throw new BadRequestException('Nothing to update: send note and/or pinned');
    }

    const updated = await this.repository.update(existing, attrs);
    this.businessMetrics?.entityUpdated.inc({ entity_type: 'contact_note' });
    return updated;
  }

  async delete(contactId: string, noteId: string): Promise<void> {
    const existing = await this.requireNote(contactId, noteId);
    await this.repository.delete(existing);
    this.businessMetrics?.entityDeleted.inc({ entity_type: 'contact_note' });
  }

  private async requireNote(contactId: string, noteId: string): Promise<ContactNote> {
    const note = await this.repository.findById(contactId, noteId);
    if (!note) throw new NotFoundException('Note not found');
    return note;
  }

  /** The body is not validated by a pipe, so the shape check lives here. */
  private normalizeText(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException('note must be a string');
    const text = value.trim();
    if (text.length === 0) throw new BadRequestException('note must not be empty');
    if (text.length > CONTACT_NOTE_MAX_LENGTH) {
      throw new BadRequestException(`note must be at most ${CONTACT_NOTE_MAX_LENGTH} characters`);
    }
    return text;
  }

  private publishNoteAdded(payload: ContactNoteAddedEvent): void {
    if (!this.snsPublisher) return;
    const eventType = ContactEventType.CONTACT_NOTE_ADDED;
    this.snsPublisher
      .publish('crm', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((err) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${err.message}`);
      });
  }
}

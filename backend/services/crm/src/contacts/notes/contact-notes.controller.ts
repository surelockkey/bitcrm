import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContactNotesService } from './contact-notes.service';
import { CreateContactNoteDto } from './dto/create-contact-note.dto';
import { UpdateContactNoteDto } from './dto/update-contact-note.dto';
import { ListContactNotesQueryDto } from './dto/list-contact-notes-query.dto';

/**
 * The client card's Notes panel (Workiz parity): a feed of notes on the
 * CLIENT, each with author, date, text and a pin. Registered before
 * `ContactsController` in the module, as the documents controller is for
 * companies, so nothing under `/contacts/:id/...` is ever shadowed.
 */
@ApiTags('Contact Notes')
@ApiBearerAuth()
@Controller('contacts')
export class ContactNotesController {
  constructor(private readonly service: ContactNotesService) {}

  // Before `:id/notes/:noteId`, or a parameter route would swallow it.
  @Get(':id/notes/count')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'How many notes a client has',
    description:
      '**Guard:** `contacts.view` permission required. The number on the Notes icon of the ' +
      'client card rail; the first page of the list carries the same figure as `pagination.notesCount`.',
  })
  async count(@Param('id') id: string) {
    const total = await this.service.count(id);
    return { success: true, data: { total } };
  }

  @Get(':id/notes')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: "List a client's notes",
    description:
      '**Guard:** `contacts.view` permission required. Newest first, cursor-paged (`limit` 1–100, ' +
      'default 20). Pinned notes lead the first page whatever their date and are not repeated on ' +
      'later pages. The first page also carries `pagination.notesCount`, the total for the rail badge.',
  })
  async list(@Param('id') id: string, @Query() query: ListContactNotesQueryDto) {
    const result = await this.service.list(id, query);
    return {
      success: true,
      data: result.items,
      pagination: {
        nextCursor: result.nextCursor,
        count: result.items.length,
        ...(result.notesCount !== undefined && { notesCount: result.notesCount }),
      },
    };
  }

  @Post(':id/notes')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Add a note to a client',
    description:
      '**Guard:** `contacts.edit` permission required. 1–5000 characters, trimmed. The author is ' +
      'the caller; `actorName` is their email until the web names them from the directory. ' +
      'Publishes `contact.note_added`.',
  })
  async create(
    @Param('id') id: string,
    @Body() dto: CreateContactNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.create(id, dto, user);
    return { success: true, data };
  }

  @Patch(':id/notes/:noteId')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Edit or pin a note',
    description:
      '**Guard:** `contacts.edit` permission required. Send `note` and/or `pinned`; an empty body is ' +
      'a 400. 404 when the note is not under this client.',
  })
  async update(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateContactNoteDto,
  ) {
    const data = await this.service.update(id, noteId, dto);
    return { success: true, data };
  }

  @Delete(':id/notes/:noteId')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Delete a note',
    description: '**Guard:** `contacts.edit` permission required. 404 when the note is not under this client.',
  })
  async remove(@Param('id') id: string, @Param('noteId') noteId: string) {
    await this.service.delete(id, noteId);
    return { success: true, data: { deleted: true } };
  }
}

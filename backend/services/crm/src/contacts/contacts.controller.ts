import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser, hasPermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto';
import { FindOrCreateContactDto } from './dto/find-or-create-contact.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';
import { LookupContactsByPhonesDto } from './dto/lookup-contacts-by-phones.dto';
import { LookupPartiesByIdsDto } from './dto/lookup-parties-by-ids.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { ResolvedPerms } from '../common/decorators/resolved-permissions.decorator';
import {
  maskPhones,
  maskPhonesEach,
  stripUnwritablePhones,
} from '../common/phone-masking';

/** Does this viewer hold `contacts.view_numbers`? Absent perms = no. */
const maySeeNumbers = (perms?: ResolvedPermissions) =>
  hasPermission(perms, 'contacts', 'view_numbers');

@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @RequirePermission('contacts', 'create')
  @ApiOperation({
    summary: 'Create a new contact',
    description: '**Guard:** `contacts.create` permission required.',
  })
  async create(
    @Body() dto: CreateContactDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.contactsService.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'List contacts with pagination',
    description:
      '**Guard:** `contacts.view` permission required. Client phone numbers are ' +
      'replaced with `phones: [], phoneCount, phonesMasked` unless the caller ' +
      'also holds `contacts.view_numbers`.',
  })
  async list(
    @Query() query: ListContactsQueryDto,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const result = await this.contactsService.list(query);
    return {
      success: true,
      data: maskPhonesEach(result.items, maySeeNumbers(perms)),
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('search/by-phone')
  @RequirePermission('contacts', 'view_numbers')
  @ApiOperation({
    summary: 'Search contact by phone number',
    description:
      '**Guard:** `contacts.view_numbers` permission required — searching *by* a ' +
      'number both requires knowing one and confirms whose it is, so a caller ' +
      'whose numbers are masked must not reach it. Phone is normalized to E.164 ' +
      'before lookup.',
  })
  async searchByPhone(@Query('phone') phone: string) {
    const data = await this.contactsService.searchByPhone(phone);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'Get contact by ID',
    description:
      '**Guard:** `contacts.view` permission required. Numbers are masked unless ' +
      'the caller also holds `contacts.view_numbers`.',
  })
  async findById(
    @Param('id') id: string,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.contactsService.findById(id);
    return { success: true, data: maskPhones(data, maySeeNumbers(perms)) };
  }

  @Put(':id')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Update a contact',
    description:
      '**Guard:** `contacts.edit` permission required. A caller without ' +
      '`contacts.view_numbers` cannot write `phones` — the field is dropped from ' +
      'their payload rather than rejected, because their edit form loaded an ' +
      'empty array they never chose.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const safe = stripUnwritablePhones(dto, maySeeNumbers(perms));
    const data = await this.contactsService.update(id, safe);
    return { success: true, data: maskPhones(data, maySeeNumbers(perms)) };
  }

  @Post('merge')
  @RequirePermission('contacts', 'delete')
  @ApiOperation({
    summary: 'Merge duplicate contacts into one',
    description:
      '**Guard:** `contacts.delete` permission required (the duplicates are soft-deleted). '
      + 'Folds 1-4 duplicates into the primary contact: phones, emails, addresses and notes are '
      + 'unioned; the duplicates are soft-deleted and a `contact.merged` event is published per duplicate.',
  })
  async merge(@Body() dto: MergeContactsDto) {
    const data = await this.contactsService.merge(dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('contacts', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a contact',
    description: '**Guard:** `contacts.delete` permission required. Sets status to deleted.',
  })
  async delete(@Param('id') id: string) {
    await this.contactsService.delete(id);
    return { success: true, data: { id, deleted: true } };
  }

  @Post('find-or-create')
  @Internal()
  @ApiOperation({
    summary: 'Find or create contact by phone (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async findOrCreate(@Body() dto: FindOrCreateContactDto) {
    const data = await this.contactsService.findOrCreate(dto);
    return { success: true, data };
  }

  @Post('internal/by-phones')
  @Internal()
  @ApiOperation({
    summary: 'Resolve many phone numbers to contacts (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). '
      + 'Used by telephony-service to name the parties in the call log. Look-up only — '
      + 'unlike `find-or-create` it never creates a contact. Returns a map keyed by both '
      + 'the submitted string and its E.164 form; numbers nobody owns are absent.',
  })
  async findByPhonesInternal(@Body() dto: LookupContactsByPhonesDto) {
    const data = await this.contactsService.findManyByPhone(dto.phones);
    return { success: true, data };
  }

  @Post('internal/by-ids')
  @Internal()
  @ApiOperation({
    summary: 'Resolve contact/company ids to display names (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). '
      + 'Names the parties a call is already associated with. Keyed `<kind>:<id>`; '
      + 'ids that no longer exist are absent rather than an error.',
  })
  async findByRefsInternal(@Body() dto: LookupPartiesByIdsDto) {
    const data = await this.contactsService.findManyByRef(dto.refs);
    return { success: true, data };
  }

  @Get('internal/all')
  @Internal()
  @ApiOperation({
    summary: 'List all contacts (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required). Used by the search-service backfill/indexer.',
  })
  async findAllInternal(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const coercedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const data = await this.contactsService.findAll(coercedLimit, cursor);
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Get contact by ID (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async findByIdInternal(@Param('id') id: string) {
    const data = await this.contactsService.findById(id);
    return { success: true, data };
  }
}

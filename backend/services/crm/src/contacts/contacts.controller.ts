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
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts-query.dto';
import { FindOrCreateContactDto } from './dto/find-or-create-contact.dto';
import { Internal } from '../common/decorators/internal.decorator';

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
    description: '**Guard:** `contacts.view` permission required.',
  })
  async list(@Query() query: ListContactsQueryDto) {
    const result = await this.contactsService.list(query);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('search/by-phone')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'Search contact by phone number',
    description: '**Guard:** `contacts.view` permission required. Phone is normalized to E.164 before lookup.',
  })
  async searchByPhone(@Query('phone') phone: string) {
    const data = await this.contactsService.searchByPhone(phone);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'Get contact by ID',
    description: '**Guard:** `contacts.view` permission required.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.contactsService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Update a contact',
    description: '**Guard:** `contacts.edit` permission required.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    const data = await this.contactsService.update(id, dto);
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

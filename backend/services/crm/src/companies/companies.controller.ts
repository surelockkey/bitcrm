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
import { CompaniesService } from './companies.service';
import { ContactsService } from '../contacts/contacts.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { ListContactsQueryDto } from '../contacts/dto/list-contacts-query.dto';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly contactsService: ContactsService,
  ) {}

  @Post()
  @RequirePermission('companies', 'create')
  @ApiOperation({
    summary: 'Create a new company',
    description: '**Guard:** `companies.create` permission required.',
  })
  async create(
    @Body() dto: CreateCompanyDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.companiesService.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('companies', 'view')
  @ApiOperation({
    summary: 'List companies with pagination',
    description: '**Guard:** `companies.view` permission required.',
  })
  async list(@Query() query: ListCompaniesQueryDto) {
    const result = await this.companiesService.list(query);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get(':id')
  @RequirePermission('companies', 'view')
  @ApiOperation({
    summary: 'Get company by ID',
    description: '**Guard:** `companies.view` permission required.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.companiesService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('companies', 'edit')
  @ApiOperation({
    summary: 'Update a company',
    description: '**Guard:** `companies.edit` permission required.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    const data = await this.companiesService.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('companies', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a company',
    description: '**Guard:** `companies.delete` permission required. Sets status to deleted.',
  })
  async delete(@Param('id') id: string) {
    await this.companiesService.delete(id);
    return { success: true, data: { id, deleted: true } };
  }

  @Get(':id/contacts')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'List contacts linked to this company',
    description: '**Guard:** `contacts.view` permission required.',
  })
  async getCompanyContacts(
    @Param('id') id: string,
    @Query() query: ListContactsQueryDto,
  ) {
    const result = await this.contactsService.list({
      companyId: id,
      limit: query.limit,
    });
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }
}

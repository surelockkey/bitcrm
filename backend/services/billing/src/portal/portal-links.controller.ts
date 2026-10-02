import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { RequireAnyPermission } from '../common/guards/any-permission.guard';
import { PortalService } from './portal.service';
import { inboxQuery, type InboxQueryParams } from './public-portal.controller';

@ApiTags('Client portal')
@ApiBearerAuth()
@Controller('portal-links')
export class PortalLinksController {
  constructor(private readonly portal: PortalService) {}

  @Get(':contactId/preview')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'Preview the client portal',
    description:
      '**Guard:** `contacts.view`. Includes unsent documents (`preview: true`). Paged like the client’s portal (`limit`, `show`).',
  })
  async preview(@Param('contactId') contactId: string, @Query() query: InboxQueryParams) {
    return { success: true, data: await this.portal.preview(contactId, inboxQuery(query)) };
  }

  @Get(':contactId/preview/inbox')
  @RequirePermission('contacts', 'view')
  @ApiOperation({
    summary: 'Preview the client portal — one more inbox page',
    description: '**Guard:** `contacts.view`. `cursor`, `limit`, `show` as on the client’s inbox; unsent documents included.',
  })
  async previewInbox(@Param('contactId') contactId: string, @Query() query: InboxQueryParams) {
    return { success: true, data: await this.portal.previewInbox(contactId, inboxQuery(query)) };
  }

  @Get(':contactId')
  @RequirePermission('contacts', 'view')
  @ApiOperation({ summary: "The contact's portal link (no token)", description: '**Guard:** `contacts.view`.' })
  async get(@Param('contactId') contactId: string) {
    return { success: true, data: await this.portal.getLink(contactId) };
  }

  @Post(':contactId')
  @RequireAnyPermission(['invoices', 'send'], ['estimates', 'send'])
  @ApiOperation({
    summary: 'Create / regenerate the portal link',
    description: '**Guard:** `invoices.send` OR `estimates.send`. Returns the raw `token` and `url` once; the previous link stops working.',
  })
  async create(@Param('contactId') contactId: string, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.portal.createLink(contactId, user) };
  }

  @Post(':contactId/url')
  @RequireAnyPermission(['invoices', 'send'], ['estimates', 'send'])
  @ApiOperation({
    summary: 'The portal link with its URL — without regenerating it',
    description:
      '**Guard:** `invoices.send` OR `estimates.send`. Returns the contact’s existing link and its `url` (the ' +
      'one the client already has keeps working); creates one when there is none. A link made before URLs were ' +
      'recoverable is replaced by a new one and comes back with `replaced: true`.',
  })
  async url(@Param('contactId') contactId: string, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.portal.linkUrl(contactId, user) };
  }

  @Delete(':contactId')
  @RequireAnyPermission(['invoices', 'send'], ['estimates', 'send'])
  @ApiOperation({ summary: 'Revoke the portal link', description: '**Guard:** `invoices.send` OR `estimates.send`.' })
  async delete(@Param('contactId') contactId: string) {
    await this.portal.deleteLink(contactId);
    return { success: true, data: { deleted: true } };
  }
}

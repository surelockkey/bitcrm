import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveStatusDto } from './dto/move-status.dto';
import { MarkArrivedDto } from './dto/mark-arrived.dto';
import { ChangeDealClientDto } from './dto/change-deal-client.dto';
import { ListDealsQueryDto } from './dto/list-deals-query.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { AssignTechsDto } from './dto/assign-techs.dto';
import { UnassignTechDto } from './dto/unassign-tech.dto';
import { ReorderDto } from './dto/reorder.dto';
import { AddDealProductDto } from './dto/add-deal-product.dto';
import { MarkProductOrderedDto } from './dto/mark-product-ordered.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { Internal } from '../common/decorators/internal.decorator';
import { RecordCallLinkDto } from './dto/record-call-link.dto';
import { SendToTechDto } from './dto/send-to-tech.dto';
import { RecordSentToTechDto } from './dto/record-sent-to-tech.dto';
import { ResolvedPerms } from '../common/decorators/resolved-permissions.decorator';

@ApiTags('Deals')
@ApiBearerAuth()
@Controller()
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @RequirePermission('deals', 'create')
  @ApiOperation({
    summary: 'Create a new deal',
    description: '**Guard:** `deals.create` permission required.',
  })
  async create(
    @Body() dto: CreateDealDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'List deals with filters and pagination',
    description: '**Guard:** `deals.view` permission required. DataScope enforced.',
  })
  async list(
    @Query() query: ListDealsQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const dataScope = perms?.dataScope?.deals;
    const result = await this.dealsService.list(query, user, dataScope);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('counts')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'How many deals fall under each jobs-list tab',
    description:
      '**Guard:** `deals.view` permission required. DataScope enforced. Takes the same filters as the list ' +
      '(`scheduledFrom/To`, `hourFrom/To`, `techId`, `jobTypeId`, `serviceArea`, `tagIds`, `subStatusId`, …; ' +
      '`superStatus`, `cursor` and `limit` are ignored) and answers one number per super-status plus `unscheduled` ' +
      '(the undated open jobs). Without a visit-date window the closed statuses (`done`, `canceled`) are `null` — ' +
      'counting them would read their whole partitions. Cached for thirty seconds.',
  })
  async counts(
    @Query() query: ListDealsQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.dealsService.counts(query, user, perms?.dataScope?.deals);
    return { success: true, data };
  }

  @Get('qualified-techs')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Suggest qualified technicians for a not-yet-created job',
    description:
      '**Guard:** `deals.edit`. Ranks techs by a job type + service area (and an ' +
      'optional point for distance), so the New Job form can suggest who can do the work. ' +
      'Declared before `:id` so the static path wins.',
  })
  async suggestQualifiedTechs(
    @Query('jobTypeId') jobTypeId: string,
    @Query('serviceAreaId') serviceAreaId?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const data = await this.dealsService.rankQualifiedTechsFor({
      jobTypeId,
      serviceAreaId: serviceAreaId || undefined,
      lat: lat !== undefined && lat !== '' ? Number(lat) : undefined,
      lng: lng !== undefined && lng !== '' ? Number(lng) : undefined,
    });
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get deal by ID',
    description: '**Guard:** `deals.view` permission required.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.dealsService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Update deal fields',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.update(id, dto, user);
    return { success: true, data };
  }

  @Put(':id/client')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Move a job to a different client',
    description:
      '**Guard:** `deals.edit` permission required. Re-points the job at another ' +
      'contact — used when details taken during a call turn out to belong to ' +
      'someone else. The previous client keeps the rest of their history.',
  })
  async changeClient(
    @Param('id') id: string,
    @Body() dto: ChangeDealClientDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.changeContact(id, dto.contactId, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('deals', 'delete')
  @ApiOperation({
    summary: 'Soft-delete a deal',
    description: '**Guard:** `deals.delete` permission required.',
  })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.softDelete(id, user);
    return { success: true, data: { id, deleted: true } };
  }

  @Put(':id/status')
  @RequirePermission('deals', 'move_status')
  @ApiOperation({
    summary: 'Move a deal\'s status (super-status + optional sub-status)',
    description:
      '**Guard:** `deals.move_status`. Sets the fixed super-status and an optional custom ' +
      'sub-status (which must belong to that super-status). A cancellation reason is required ' +
      'when moving to Canceled.',
  })
  async moveStatus(
    @Param('id') id: string,
    @Body() dto: MoveStatusDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.moveStatus(id, dto, user);
    return { success: true, data };
  }

  @Post(':id/tech/confirm')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Confirm receipt of the job (technician)',
    description:
      '**Guard:** `deals.edit`, and — for a caller whose `deals` data scope is `assigned_only` — ' +
      'membership of this job\'s technician roster (403 otherwise); dispatch may confirm on a ' +
      'technician\'s behalf. Mirrors the old CRM\'s "Confirmed job receipt": stamps `techConfirmedAt` ' +
      'on the caller\'s `ASSIGN#` row (and the first one onto the job, so lists can show it) and ' +
      'writes a `tech_confirmed` timeline entry. Idempotent per caller — a second call keeps the ' +
      'first stamp and writes no second entry and no second event, a dispatcher with no `ASSIGN#` ' +
      'row of their own included; a second technician on the same job still records their own ' +
      'confirmation. 400 once the job is closed.',
  })
  async confirmReceipt(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.dealsService.confirmReceipt(id, user, perms?.dataScope?.deals);
    return { success: true, data };
  }

  @Post(':id/tech/arrived')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Mark arrival at the job (technician)',
    description:
      '**Guard:** `deals.edit`, plus the same roster rule as confirm. Mirrors the old CRM\'s ' +
      '"Arrived at location": stamps `arrivedAt`/`arrivedBy` (and the phone\'s GPS fix when the body ' +
      'carries one), applies the catalog\'s In Progress arrival sub-status when the workspace has ' +
      'one (or the `subStatusId` in the body), and writes a `tech_arrived` timeline entry. ' +
      'Idempotent — the first arrival stands. 400 once the job is closed.',
  })
  async markArrived(
    @Param('id') id: string,
    @Body() dto: MarkArrivedDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    const data = await this.dealsService.markArrived(id, dto, user, perms?.dataScope?.deals);
    return { success: true, data };
  }

  @Get(':id/timeline')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get deal activity timeline',
    description: '**Guard:** `deals.view` permission required.',
  })
  async getTimeline(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    // Query param arrives as a string; coerce so DynamoDB's Limit is a number.
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const result = await this.dealsService.getTimeline(id, safeLimit, cursor);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Post(':id/call-link')
  @Internal()
  @ApiOperation({
    summary: 'Record a call being attached to (or detached from) this job',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret`). ' +
      'Written by telephony-service when someone links a call, so the job’s ' +
      'activity feed carries calls alongside everything else — with the ' +
      'recording available from the entry.',
  })
  async recordCallLink(
    @Param('id') id: string,
    @Body() dto: RecordCallLinkDto,
  ) {
    await this.dealsService.recordCallLink(
      id,
      dto.linked !== false,
      dto.details ?? {},
      { id: dto.actorId, name: dto.actorName ?? 'Someone' },
    );
    return { success: true, data: { recorded: true } };
  }

  @Post(':id/notes')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Add note to deal timeline',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.addNote(id, dto, user);
    return { success: true, data: { added: true } };
  }

  @Patch(':id/notes/:entryId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Edit a timeline note',
    description:
      '**Guard:** `deals.edit` permission required. Only note entries are editable; ' +
      'the body carries the entry timestamp (part of its key).',
  })
  async updateNote(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.updateNote(id, entryId, dto, user);
    return { success: true, data: { updated: true } };
  }

  @Delete(':id/notes/:entryId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Delete a timeline note',
    description:
      '**Guard:** `deals.edit` permission required. Only note entries can be removed; ' +
      '`timestamp` (query) is part of the entry key.',
  })
  async deleteNote(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Query('timestamp') timestamp: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!timestamp) throw new BadRequestException('timestamp query param is required');
    await this.dealsService.deleteNote(id, entryId, timestamp, user);
    return { success: true, data: { deleted: true } };
  }

  @Get(':id/qualified-techs')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Get qualified technicians for assignment',
    description: '**Guard:** `deals.edit` permission required. Filters by skills and service area.',
  })
  async getQualifiedTechs(@Param('id') id: string) {
    const data = await this.dealsService.getQualifiedTechs(id);
    return { success: true, data };
  }

  @Post(':id/assign')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Set the technician roster on a deal',
    description:
      '**Guard:** `deals.edit` permission required. Body carries the full `techIds` roster ' +
      '(diffed against the current one). Auto-transitions to ASSIGNED on the first assignment.',
  })
  async assignTechs(
    @Param('id') id: string,
    @Body() dto: AssignTechsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.assignTechs(id, dto.techIds, user);
    return { success: true, data };
  }

  @Post(':id/unassign')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Remove one technician from a deal',
    description: '**Guard:** `deals.edit` permission required. Body names the `techId` to remove.',
  })
  async unassignTech(
    @Param('id') id: string,
    @Body() dto: UnassignTechDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.unassignTech(id, dto.techId, user);
    return { success: true, data };
  }

  @Post(':id/send-to-tech')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Send the job to its technician(s) — Workiz "Send to tech"',
    description:
      '**Guard:** `deals.edit` permission required. Stamps `sentToTechAt` / `sentToTechVia` / ' +
      '`sentToTechBy` on the job (and `sentAt` on each technician’s assignment row), writes a ' +
      '`sent_to_tech` timeline entry and publishes `deal.sent_to_tech`; messaging-service renders the ' +
      'settings `smsFormat` text and delivers it per channel (`sms` → personal phone, `email`, ' +
      '`in_app` → team thread). `techIds` narrows the roster; omitted = everyone assigned. Pressing ' +
      'again is a resend.',
  })
  async sendToTech(
    @Param('id') id: string,
    @Body() dto: SendToTechDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.dealsService.sendToTech(id, dto, user);
    return { success: true, data };
  }

  @Post(':id/seen')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'The technician opened the job — Workiz "seen" / "Viewed job in app"',
    description:
      '**Guard:** `deals.view` permission required. Called by the technician’s app when the job is ' +
      'opened. Only an assigned technician counts: first open stamps `seenAt` on their assignment ' +
      'row, `seenByTechAt` on the job and a `seen_by_tech` timeline entry; later opens (and anyone ' +
      'not on the roster) answer `seen: false` / unchanged without writing.',
  })
  async markSeen(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.dealsService.markSeenByTech(id, user);
    return { success: true, data };
  }

  @Get(':id/assignments')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Per-technician sent / seen stamps of a job',
    description:
      '**Guard:** `deals.view` permission required. The `ASSIGN#` rows: who is on the job, when it ' +
      'was last sent to each of them and over which channels, whether (and when) they opened it, and ' +
      'what messaging reported per channel.',
  })
  async getAssignments(@Param('id') id: string) {
    const data = await this.dealsService.getAssignments(id);
    return { success: true, data };
  }

  // Static path — declared before the dynamic ":id" routes can't shadow it.
  @Post('reorder')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Reorder a technician’s jobs (drag-and-drop)',
    description:
      '**Guard:** `deals.edit` permission required. Writes that technician’s own ' +
      'sequence 1..N in the given order; ids that are not theirs are ignored.',
  })
  async reorder(@Body() dto: ReorderDto, @CurrentUser() user: JwtUser) {
    await this.dealsService.reorderSchedule(dto, user);
    return { success: true };
  }

  @Post(':id/products')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Add a line item to a deal',
    description:
      '**Guard:** `deals.edit` permission required. ' +
      'Behavior depends on `fulfillment`: `sourced` (default) deducts the ' +
      "quantity from the source technician's container and requires an assigned " +
      'tech; `to_order` records a part the tech does not carry (no deduction); ' +
      '`service` adds a non-stockable service line (no deduction, no tech). The ' +
      "product's inventory type must match — services only as `service` lines.",
  })
  async addProduct(
    @Param('id') id: string,
    @Body() dto: AddDealProductDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.addProduct(id, dto, user);
    return { success: true, data: { added: true } };
  }

  @Put(':id/products/:productId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Edit a line item (or swap it for another catalog product)',
    description:
      '**Guard:** `deals.edit` permission required. The body is the complete ' +
      'new line — same shape and validation as add. Stock is reconciled: the ' +
      "old sourced line is restored to its source technician's container " +
      'before the new sourced line is deducted from the chosen one, so raising ' +
      'a quantity only needs the delta in the van.',
  })
  async replaceProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: AddDealProductDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.replaceProduct(id, productId, dto, user);
    return { success: true, data: { updated: true } };
  }

  @Patch(':id/products/:productId/ordered')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Mark a to-order line as ordered (or clear it)',
    description:
      '**Guard:** `deals.edit` permission required. Only valid for `to_order` lines.',
  })
  async markProductOrdered(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: MarkProductOrderedDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.markProductOrdered(id, productId, dto.ordered, user);
    return { success: true, data: { ordered: dto.ordered } };
  }

  @Delete(':id/products/:productId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Remove product from deal (restores to tech container)',
    description: '**Guard:** `deals.edit` permission required.',
  })
  async removeProduct(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.dealsService.removeProduct(id, productId, user);
    return { success: true, data: { removed: true } };
  }

  @Get(':id/products')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Get products on deal',
    description: '**Guard:** `deals.view` permission required.',
  })
  async getProducts(@Param('id') id: string) {
    const data = await this.dealsService.getProducts(id);
    return { success: true, data };
  }

  // Internal endpoints (service-to-service)

  @Get('internal/by-tech/:techId')
  @Internal()
  @ApiOperation({
    summary: 'Get deals by technician (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async getTechDeals(@Param('techId') techId: string) {
    const data = await this.dealsService.getTechDeals(techId);
    return { success: true, data: data.items };
  }

  @Put('internal/:id/payment-status')
  @Internal()
  @ApiOperation({
    summary: 'Update payment status (internal)',
    description: '**Guard:** Internal service-to-service only (`x-internal-secret` header required).',
  })
  async updatePaymentStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    await this.dealsService.updatePaymentStatus(id, dto);
    return { success: true, data: { updated: true } };
  }

  @Put('internal/:id/sent-to-tech')
  @Internal()
  @ApiOperation({
    summary: 'Record what happened to one channel of a "Send to tech" (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'Written by messaging-service after handling `deal.sent_to_tech`: per (technician, channel) — ' +
      'the message it stored, or why nothing went out. Lands in `deliveries` on the `ASSIGN#` row; ' +
      'a report for an older `sentAt` than the row’s current one is ignored.',
  })
  async recordSentToTech(
    @Param('id') id: string,
    @Body() dto: RecordSentToTechDto,
  ) {
    const data = await this.dealsService.recordSentToTechDelivery(id, dto);
    return { success: true, data };
  }

  // NOTE: `internal/all` (static) MUST stay declared before `internal/:id`
  // (param) so the literal "all" segment is not captured as an id.
  @Get('internal/all')
  @Internal()
  @ApiOperation({
    summary: 'List all deals (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). Used by the search-service backfill/indexer.',
  })
  async listAll(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    // Query param arrives as a string (no transforming ValidationPipe in this
    // repo); coerce, default 200, clamp to a max of 500.
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const data = await this.dealsService.findAll(safeLimit, cursor);
    return { success: true, data };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Get deal by ID (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). Used by the search-service backfill/indexer.',
  })
  async getByIdInternal(@Param('id') id: string) {
    const data = await this.dealsService.findById(id);
    if (!data) {
      throw new NotFoundException(`Deal ${id} not found`);
    }
    return { success: true, data };
  }
}

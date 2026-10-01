import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ProposalsService } from './proposals.service';

@ApiTags('Estimates')
@ApiBearerAuth()
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post()
  @RequirePermission('estimates', 'send')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Send all (proposal)',
    description:
      '**Guard:** `estimates.send`. Bundles the job’s OPEN estimates (not already in a pending proposal) into one ' +
      'numbered proposal and marks them all sent. 422 when there is nothing open. The message itself goes out ' +
      'through messaging, as for a single document.',
  })
  async create(@Body() dto: CreateProposalDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.proposals.createAndSend(dto.dealId, caller) };
  }

  @Get()
  @RequirePermission('estimates', 'view')
  @ApiQuery({ name: 'dealId', required: true })
  @ApiOperation({ summary: 'A job’s proposals, newest first', description: '**Guard:** `estimates.view`.' })
  async list(@Query('dealId') dealId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.proposals.listByDeal(dealId, caller) };
  }

  @Get(':id')
  @RequirePermission('estimates', 'view')
  @ApiOperation({ summary: 'One proposal', description: '**Guard:** `estimates.view`.' })
  async get(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.proposals.get(id, caller) };
  }
}

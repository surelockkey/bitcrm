import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CallFlowsService } from './call-flows.service';
import {
  CreateCallFlowDto,
  SimpleCallFlowDto,
  UpdateCallFlowDto,
} from './dto/call-flow.dto';

/**
 * Behind `settings`, like the phone numbers and call groups a flow ties
 * together — the same person configures all three.
 */
@ApiTags('Call Flows')
@ApiBearerAuth()
@Controller('call-flows')
export class CallFlowsController {
  constructor(private readonly service: CallFlowsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'List call flows' })
  async list() {
    return { success: true, data: await this.service.list() };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'Get one call flow' })
  async findById(@Param('id') id: string) {
    return { success: true, data: await this.service.findById(id) };
  }

  @Post('simple')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create a flow from greeting + group + what happens on no answer',
    description:
      '**Guard:** `settings.edit`. Builds the step graph server-side, so the ' +
      'first flows cannot be malformed. The step editor arrives in P2 over ' +
      'the same storage.',
  })
  async createSimple(@Body() dto: SimpleCallFlowDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.service.createSimple(dto, user) };
  }

  @Put(':id/simple')
  @RequirePermission('settings', 'edit')
  @ApiOperation({ summary: 'Replace a flow from the same three answers' })
  async updateSimple(
    @Param('id') id: string,
    @Body() dto: SimpleCallFlowDto,
    @CurrentUser() user: JwtUser,
  ) {
    return { success: true, data: await this.service.updateSimple(id, dto, user) };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create a call flow from an explicit step graph',
    description:
      '**Guard:** `settings.edit`. 409 on a duplicate name or a number another ' +
      'flow already answers; 400 for a step pointing nowhere, a loop, or an ' +
      'active flow with no steps.',
  })
  async create(@Body() dto: CreateCallFlowDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.service.create(dto, user) };
  }

  @Put(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({ summary: 'Update a call flow' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCallFlowDto,
    @CurrentUser() user: JwtUser,
  ) {
    return { success: true, data: await this.service.update(id, dto, user) };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({ summary: 'Delete a call flow' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true, data: { id, deleted: true } };
  }
}

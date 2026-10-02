import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../common/decorators/internal.decorator';
import { PortalEventDto } from './dto/portal-event.dto';
import { SendService } from './send.service';

/**
 * Billing's half of Workiz's portal lines in the chat: when a client views a
 * document, signs it, declines an estimate or pays on the portal, billing
 * posts it here and the system writes it into the client's thread.
 */
@ApiTags('Messaging')
@Controller()
export class PortalEventsController {
  constructor(private readonly service: SendService) {}

  @Post('internal/portal-events')
  @Internal()
  @ApiOperation({
    summary: 'Record what a client did on the portal in their thread',
    description:
      '**Guard:** internal (`x-internal-secret`). Writes a system line (`channel: note`, `origin: system`) into ' +
      'the client’s conversation, opening one when they have none: "Viewed estimate #…", "… signed Invoice #…", ' +
      '"… declined estimate #…", "… submitted payment for invoice #…". One line per `eventKey` (a retry answers ' +
      '`duplicate: true`). A view leaves the thread read; the others mark it unread.',
  })
  async record(@Body() dto: PortalEventDto) {
    const { message, duplicate } = await this.service.recordPortalEvent(dto);
    return { success: true, data: { messageId: message.id, duplicate } };
  }
}

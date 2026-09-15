import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { SendMessageDto, StartConversationMessageDto } from './dto/send-message.dto';
import { ResolvedPerms } from './resolved-perms.decorator';
import { SendService } from './send.service';

/**
 * The send routes (design §7.1). Read/list routes of the inbox live in the
 * inbox API controllers; these are POST-only so nothing here shadows a
 * `GET /conversations/:id` or `GET /messages/by-job/:dealId`.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller()
export class SendController {
  constructor(private readonly service: SendService) {}

  @Post('conversations/:id/messages')
  @HttpCode(202)
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Send a message in a conversation',
    description:
      '**Guard:** `messages.send` (a `team`/`group` conversation additionally needs `team_chat.send`; ' +
      'an `assigned_only` data scope limits sending to conversations of jobs the caller is on). ' +
      'Refuses opted-out recipients with 422 `RECIPIENT_OPTED_OUT`. Answers 202 with the message in ' +
      'status `queued`; a repeated `clientMessageId` returns the first message instead of sending again. ' +
      'Only `channel: sms` is deliverable today (email / in-app answer 501).',
  })
  async send(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions | undefined,
  ) {
    const data = await this.service.sendToConversation(id, dto, { user, perms });
    return { success: true, data };
  }

  @Post('messages')
  @HttpCode(202)
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Send a message to a contact or phone number, opening the conversation if needed',
    description:
      '**Guard:** `messages.send`. Exactly one of `contactId` / `phone`: a contact gets or reuses its ' +
      'conversation; a bare E.164 is resolved through CRM and, when nobody owns it, opens an `unknown` ' +
      'conversation keyed by the address. Then behaves as `POST /conversations/:id/messages`.',
  })
  async sendToParty(
    @Body() dto: StartConversationMessageDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions | undefined,
  ) {
    const data = await this.service.sendToParty(dto, { user, perms });
    return { success: true, data };
  }
}

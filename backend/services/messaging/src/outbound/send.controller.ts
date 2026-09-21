import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResendMessageDto } from './dto/resend-message.dto';
import { SendMessageDto, StartConversationMessageDto } from './dto/send-message.dto';
import { ResolvedPerms } from './resolved-perms.decorator';
import { SendService } from './send.service';

/**
 * The send routes (design §7.1). Read/list routes of the inbox live in the
 * inbox API controllers; the sends are POST so nothing here shadows a
 * `GET /conversations/:id` or `GET /messages/by-job/:dealId`. The one GET
 * is `send-options`, which lives with the sends because it is the send rules
 * being asked rather than the inbox being read — and, at three segments, it
 * cannot be swallowed by `GET /conversations/:id` either.
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
      '**Guard:** `messages.send` (a `team`/`group` conversation additionally needs `team_chat.send` and ' +
      'the `team_chat` data scope — a technician writes only in their own thread and groups; for client ' +
      'threads an `assigned_only` `messages` scope limits sending to conversations of jobs the caller is on). ' +
      'Refuses opted-out recipients with 422 `RECIPIENT_OPTED_OUT`. `channel: sms` answers 202 with the ' +
      'message `queued` (in an employee’s thread it goes to their personal phone from user-service — 422 ' +
      '`EMPLOYEE_HAS_NO_PHONE` when they have none — from the company’s default number); `channel: in_app` ' +
      '(team / group only, else 501) is stored `sent` and delivered over SSE to the members, with optional ' +
      '`mentions`. A repeated `clientMessageId` returns the first message instead of sending again. Email answers 501.',
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

  @Get('conversations/:id/send-options')
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'What this conversation can be sent on, and to whom',
    description:
      '**Guard:** `messages.send`, with the same conversation rules as sending (`team_chat.send` + scope ' +
      'in a team / group thread; under an `assigned_only` `messages` scope the caller must be on the job). ' +
      'Answers the three sendable channels resolved by the send rules themselves: `in_app` (team / group ' +
      'threads only), `sms` (the thread’s number, or the teammate’s personal phone from user-service) and ' +
      '`email` (the thread’s address). Each carries `available`, the `reason` it is not (`no_phone`, ' +
      '`opted_out_sms`, `employee_has_no_phone`, `employee_unknown`, `no_email`, `opted_out_email`, ' +
      '`email_not_configured`, `not_a_team_thread`), where it would arrive (`to` — withheld as `toMasked` ' +
      'without `contacts.view_numbers` — or `toName` for a person) and what it would leave from (`from`, ' +
      'with the sender-chain rung in `fromSource`). `defaultChannel` is the first available one. Nothing ' +
      'is written; a send may still be refused if the thread changes in between.',
  })
  async sendOptions(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions | undefined,
  ) {
    const data = await this.service.sendOptions(id, { user, perms });
    return { success: true, data };
  }

  @Post('conversations/:id/messages/:messageId/resend')
  @HttpCode(202)
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Resend a failed message as a new one',
    description:
      '**Guard:** `messages.send`, with the same conversation rules as sending (`team_chat.send` + scope in a ' +
      'team / group thread; under an `assigned_only` `messages` scope the caller must be on the message’s job). ' +
      'Allowed only for an outbound SMS or email in `failed` / `undelivered` / `canceled` — anything else is 409. ' +
      'Builds a NEW message copying channel, body, subject / HTML, attachments, job, template and recipient, the ' +
      'sender re-resolved through the chain (the original number when the chain yields none), linked both ways ' +
      '(`resentFromMessageId` on the copy, `resentAsMessageId` on the original), and sends it the normal way: an ' +
      'opted-out recipient is refused with 422 `RECIPIENT_OPTED_OUT`, the copy is stored `queued`, handed to the ' +
      'send worker and pushed over SSE. The body is optional: `clientMessageId` (uuid) makes a repeat return the ' +
      'first copy; without it the key is `resend:<messageId>:<n>` so a double click sends once and a later click ' +
      'sends again. `createdAt` (the message’s, as listed) skips the feed lookup. Answers 202 with the new message.',
  })
  async resend(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: ResendMessageDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions | undefined,
  ) {
    const data = await this.service.resend(id, messageId, dto ?? {}, { user, perms });
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

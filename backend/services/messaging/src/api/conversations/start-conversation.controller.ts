import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { StartConversationDto } from '../../team/dto/team.dto';
import { ResolvedPerms } from '../access/resolved-permissions.decorator';
import { StartConversationService } from './start-conversation.service';

/**
 * `POST /conversations` — the one write under `/conversations` without an
 * id (design §7.1). POST-only, so it shadows none of the `GET` lookups in
 * `ConversationsController`.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('conversations')
export class StartConversationController {
  constructor(private readonly service: StartConversationService) {}

  @Post()
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Find or create the conversation of a party',
    description:
      '**Guard:** `messages.send` permission required (`{ partyKind: "user" }` additionally needs ' +
      '`team_chat.send`; under `assigned_only` a technician may only open their own team thread and ' +
      'threads of contacts on their jobs). `{ partyKind: "user", partyId }` → the employee’s team thread ' +
      '(`CONVOF#user#`); `{ partyKind: "contact", partyId }` / `{ contactId }` → the client thread; ' +
      '`{ phone }` → the thread the number routes to, else an `unknown` thread keyed by the address. ' +
      'Answers `{ conversation, created }`; phone numbers are withheld without `contacts.view_numbers`.',
  })
  async start(
    @Body() dto: StartConversationDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.service.start(dto, user, perms) };
  }
}

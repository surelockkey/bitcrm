import { BadRequestException, Injectable } from '@nestjs/common';
import { type Conversation, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { SendService } from '../../outbound/send.service';
import { TeamConversationsService } from '../../team/team-conversations.service';
import { type StartConversationDto } from '../../team/dto/team.dto';
import { ConversationScopeService } from '../access/conversation-scope.service';
import { maskConversation, type MaybeMaskedConversation } from '../access/masking';

export interface StartedConversation {
  conversation: MaybeMaskedConversation;
  /** This call opened the thread (as opposed to finding the existing one). */
  created: boolean;
}

/**
 * `POST /conversations` (design §7.1): find or create the thread of a
 * party before the first message. Employee threads go through the team
 * module (`team_chat.send`, own-thread rule); client threads reuse the
 * find-or-create `POST /messages` runs, then the `messages` data scope is
 * checked so an `assigned_only` caller cannot open a thread with a
 * contact outside their jobs.
 */
@Injectable()
export class StartConversationService {
  constructor(
    private readonly send: SendService,
    private readonly team: TeamConversationsService,
    private readonly scope: ConversationScopeService,
  ) {}

  async start(dto: StartConversationDto, user: JwtUser, perms?: ResolvedPermissions): Promise<StartedConversation> {
    const viewer = this.scope.viewerFor(user, perms);
    let found: { conversation: Conversation; created: boolean };

    if (dto.partyKind === 'user') {
      found = await this.team.findOrCreateForUser(dto.partyId!, user, perms);
    } else {
      const contactId = dto.partyKind === 'contact' ? dto.partyId : dto.contactId;
      if (!contactId && !dto.phone) {
        throw new BadRequestException('Give partyKind + partyId, contactId or phone');
      }
      found = await this.send.conversationForParty({ contactId, phone: dto.phone });
      await this.scope.assertAccess(found.conversation, viewer.scope);
    }
    return { conversation: maskConversation(found.conversation, viewer.seesNumbers), created: found.created };
  }
}

import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CONVERSATION_KINDS, CONVERSATION_VIEWS, type ConversationKind } from '@bitcrm/types';

/**
 * Inbox tabs: the four indexed views of the design (§7.1) plus `mine` —
 * conversations assigned to the caller (`assignedUserId`), which has no
 * index and is served by a bounded walk of the open inbox.
 */
export const INBOX_VIEWS = [...CONVERSATION_VIEWS, 'mine'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const INBOX_PAGE_DEFAULT = 50;
export const INBOX_PAGE_MAX = 100;

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ enum: INBOX_VIEWS, default: 'all' })
  @IsOptional()
  @IsIn(INBOX_VIEWS)
  view: InboxView = 'all';

  @ApiPropertyOptional({
    enum: CONVERSATION_KINDS,
    description: 'Category tab (Clients / Team / Unknown …). Combines only with view=all.',
  })
  @IsOptional()
  @IsIn(CONVERSATION_KINDS)
  kind?: ConversationKind;

  @ApiPropertyOptional({ description: 'Workiz account category. Combines only with view=all.' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  categoryId?: string;

  @ApiPropertyOptional({ default: INBOX_PAGE_DEFAULT, minimum: 1, maximum: INBOX_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INBOX_PAGE_MAX)
  limit: number = INBOX_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

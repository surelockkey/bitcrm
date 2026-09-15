import { IsBoolean, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CONVERSATION_STATES, type ConversationState } from '@bitcrm/types';

/**
 * `PATCH /conversations/:id` (design §7.2): archive / restore, flag, mark
 * unread (or read for the team), recategorise, assign. `null` clears an
 * optional field.
 */
export class UpdateConversationDto {
  @ApiPropertyOptional({ enum: CONVERSATION_STATES })
  @IsOptional()
  @IsIn(CONVERSATION_STATES)
  state?: ConversationState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  flagged?: boolean;

  @ApiPropertyOptional({ description: 'true = mark unread for the team; false = mark read (team flag only, no READ# marker).' })
  @IsOptional()
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Account category; null clears it.' })
  @ValidateIf((o) => o.categoryId !== null && o.categoryId !== undefined)
  @IsString()
  @Length(1, 100)
  categoryId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'User to assign the thread to; null unassigns. Validated against user-service.' })
  @ValidateIf((o) => o.assignedUserId !== null && o.assignedUserId !== undefined)
  @IsString()
  @Length(1, 200)
  assignedUserId?: string | null;
}

/** `POST /conversations/:id/read` */
export class MarkReadDto {
  @ApiPropertyOptional({ description: 'Sort key (`MSG#<createdAt>#<messageId>`) of the last message seen; stored on the READ# marker.' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  lastReadMessageSk?: string;
}

/** `POST /conversations/:id/assign` */
export class AssignConversationDto {
  @ApiPropertyOptional({ description: 'The teammate to assign the thread to.' })
  @IsString()
  @Length(1, 200)
  userId!: string;
}

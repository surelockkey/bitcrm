import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CONVERSATION_GROUP_MAX_MEMBERS } from '@bitcrm/types';

/** E.164, as `SendMessageDto.phone` (design §7.2). */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export const TEAM_LIST_KINDS = ['team', 'group'] as const;
export type TeamListKind = (typeof TEAM_LIST_KINDS)[number];

export const TEAM_PAGE_DEFAULT = 50;
export const TEAM_PAGE_MAX = 100;

/** `GET /team/conversations?kind=&limit=&cursor=` and `GET /groups?limit=&cursor=`. */
export class TeamListQueryDto {
  @ApiPropertyOptional({ enum: TEAM_LIST_KINDS, default: 'team', description: 'Employee threads (`team`) or groups.' })
  @IsOptional()
  @IsIn(TEAM_LIST_KINDS)
  kind: TeamListKind = 'team';

  @ApiPropertyOptional({ default: TEAM_PAGE_DEFAULT, minimum: 1, maximum: TEAM_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TEAM_PAGE_MAX)
  limit: number = TEAM_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** `GET /groups?limit=&cursor=` — the list DTO without `kind`. */
export class GroupListQueryDto {
  @ApiPropertyOptional({ default: TEAM_PAGE_DEFAULT, minimum: 1, maximum: TEAM_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TEAM_PAGE_MAX)
  limit: number = TEAM_PAGE_DEFAULT;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** `POST /groups` (design §6): the creator becomes an owner-member automatically. */
export class CreateGroupDto {
  @ApiProperty({ example: 'All technicians' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({
    type: [String],
    description: `User ids to add (≤ ${CONVERSATION_GROUP_MAX_MEMBERS} including the creator); each is validated against user-service.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONVERSATION_GROUP_MAX_MEMBERS)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  memberIds!: string[];
}

/** `PATCH /groups/:id`: rename and/or change membership. */
export class UpdateGroupDto {
  @ApiPropertyOptional({ example: 'Night shift' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ type: [String], description: 'User ids to add; unknown users are refused (400).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONVERSATION_GROUP_MAX_MEMBERS)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  addMemberIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'User ids to remove; at least one member must remain.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONVERSATION_GROUP_MAX_MEMBERS)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  removeMemberIds?: string[];
}

export const START_PARTY_KINDS = ['user', 'contact'] as const;
export type StartPartyKind = (typeof START_PARTY_KINDS)[number];

/**
 * `POST /conversations` (design §7.1): find or create the thread of a party.
 * `{ partyKind: 'user', partyId }` opens an employee's team thread;
 * `{ partyKind: 'contact', partyId }` / `{ contactId }` a contact's client
 * thread; `{ phone }` resolves the number through CRM and, when nobody owns
 * it, opens an `unknown` thread keyed by the address — exactly what
 * `POST /messages` does before sending.
 */
export class StartConversationDto {
  @ApiPropertyOptional({ enum: START_PARTY_KINDS })
  @ValidateIf((o: StartConversationDto) => o.partyKind !== undefined || o.partyId !== undefined)
  @IsIn(START_PARTY_KINDS)
  partyKind?: StartPartyKind;

  @ApiPropertyOptional({ description: 'User id for `user`, contact id for `contact`.' })
  @ValidateIf((o: StartConversationDto) => o.partyKind !== undefined || o.partyId !== undefined)
  @IsString()
  @Length(1, 200)
  partyId?: string;

  @ApiPropertyOptional({ description: 'CRM contact to open a thread with (same as partyKind contact).' })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @ApiPropertyOptional({ description: 'E.164 number to open a thread with.', example: '+14045551234' })
  @IsOptional()
  @Matches(E164_PATTERN, { message: 'phone must be E.164' })
  phone?: string;
}

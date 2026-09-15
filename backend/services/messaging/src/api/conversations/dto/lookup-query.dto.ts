import { IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Party kinds a card can ask about; `address` is for unknown numbers. */
export const TEXT_LOOKUP_PARTY_KINDS = ['contact', 'company', 'user'] as const;
export type TextLookupPartyKind = (typeof TEXT_LOOKUP_PARTY_KINDS)[number];

/**
 * `GET /conversations/text-lookup` — what the "Text" button needs before the
 * thread is open: give a party (`partyKind` + `partyId`) or an `address`.
 */
export class TextLookupQueryDto {
  @ApiPropertyOptional({ enum: TEXT_LOOKUP_PARTY_KINDS })
  @ValidateIf((o) => o.partyId !== undefined || o.partyKind !== undefined)
  @IsIn(TEXT_LOOKUP_PARTY_KINDS)
  partyKind?: TextLookupPartyKind;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.partyId !== undefined || o.partyKind !== undefined)
  @IsString()
  @Length(1, 200)
  partyId?: string;

  @ApiPropertyOptional({ description: 'E.164 phone or lowercase email.' })
  @IsOptional()
  @IsString()
  @Length(3, 320)
  address?: string;
}

/** `GET /conversations/by-address?address=` */
export class AddressQueryDto {
  @ApiPropertyOptional({ description: 'E.164 phone or lowercase email.' })
  @IsString()
  @Length(3, 320)
  address!: string;
}

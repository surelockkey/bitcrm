import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CONTACT_NOTE_MAX_LENGTH } from '@bitcrm/types';

/** At least one of the two must be present. */
export class UpdateContactNoteDto {
  @ApiPropertyOptional({
    example: 'Gate code changed to 4321.',
    minLength: 1,
    maxLength: CONTACT_NOTE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CONTACT_NOTE_MAX_LENGTH)
  note?: string;

  @ApiPropertyOptional({ example: true, description: 'Pinned notes lead the feed.' })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

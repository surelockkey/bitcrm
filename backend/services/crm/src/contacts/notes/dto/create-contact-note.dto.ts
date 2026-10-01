import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CONTACT_NOTE_MAX_LENGTH } from '@bitcrm/types';

export class CreateContactNoteDto {
  @ApiProperty({
    example: 'Gate code 1234, dog in the yard.',
    minLength: 1,
    maxLength: CONTACT_NOTE_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(CONTACT_NOTE_MAX_LENGTH)
  note!: string;
}

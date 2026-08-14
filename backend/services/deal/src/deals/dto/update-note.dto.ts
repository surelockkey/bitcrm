import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateNoteDto {
  @ApiProperty({ example: 'Client asked to reschedule to Friday.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  /** The entry's sort-key timestamp — part of its DynamoDB key. */
  @ApiProperty({ example: '2026-08-01T10:00:00.000Z' })
  @IsString()
  timestamp!: string;
}

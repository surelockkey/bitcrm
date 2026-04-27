import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNoteDto {
  @ApiProperty({ example: 'Spoke with client, confirmed appointment' })
  @IsString()
  @MinLength(1)
  note!: string;
}

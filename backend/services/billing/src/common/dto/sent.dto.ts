import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class MarkSentDto {
  @ApiProperty({ example: true, description: '`true` stamps sentAt/sentBy; `false` clears them.' })
  @IsBoolean()
  sent!: boolean;
}

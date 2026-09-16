import { IsBoolean, IsISO8601, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * `PATCH /conversations/:id/messages/:messageId` (design §7.1): flag or
 * unflag one message. `createdAt` is part of the message's sort key, so the
 * client sends it back rather than the service scanning the feed for the id.
 */
export class UpdateMessageDto {
  @ApiProperty({ description: 'The message\'s createdAt exactly as listed (it is part of the sort key).' })
  @IsString()
  @IsISO8601({ strict: true })
  createdAt!: string;

  @ApiProperty()
  @IsBoolean()
  flagged!: boolean;
}

import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BLOCKED_CALLER_LIMITS } from '@bitcrm/types';

/**
 * NOTE: telephony-service registers no ValidationPipe, so these decorators
 * document the contract for Scalar but do not run. BlockedCallersService
 * validates the same rules by hand — keep the two in step.
 */
export class BlockCallerDto {
  @ApiProperty({
    example: '(214) 791-7112',
    description: 'Any dialable form; stored as E.164 (+12147917112). A number typed without a country code is US.',
  })
  @IsString()
  @IsNotEmpty()
  number!: string;

  @ApiPropertyOptional({
    example: 'Sales calls',
    description: 'Why ("I am blocking this number because…"). Trimmed; an empty comment is not stored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(BLOCKED_CALLER_LIMITS.commentMaxLength)
  comment?: string;
}

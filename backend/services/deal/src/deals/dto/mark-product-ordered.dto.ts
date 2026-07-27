import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkProductOrderedDto {
  @ApiProperty({
    example: true,
    description: 'Whether the to-order line has been ordered (false clears it).',
  })
  @IsBoolean()
  ordered!: boolean;
}

import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Batch phone → user lookup. Capped so one call can't fan out unbounded. */
export class LookupUsersByPhonesDto {
  @ApiProperty({
    example: ['+14045551234', '(541) 283-0739'],
    description: 'Phone numbers in any format; each is normalized to E.164.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  phones!: string[];
}

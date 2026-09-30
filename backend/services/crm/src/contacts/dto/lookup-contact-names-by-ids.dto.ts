import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LookupContactNamesByIdsDto {
  @ApiProperty({
    type: [String],
    description:
      'Contact ids to resolve to names — the clients of one page of a list. At most 100, ' +
      'the same ceiling as `LookupContactsByIdsDto`, because it answers the same page.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

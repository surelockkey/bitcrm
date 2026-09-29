import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LookupContactsByIdsDto {
  @ApiProperty({
    type: [String],
    description: 'Contact ids to resolve — the ones a page of a list shows. At most 100.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

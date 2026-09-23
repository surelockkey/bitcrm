import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DealsByIdsDto {
  @ApiProperty({ type: [String], description: 'Deal ids to hydrate — a search result, a board delta. At most 100.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsString, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class PartyRefDto {
  @ApiProperty({ enum: ['contact', 'company'] })
  @IsIn(['contact', 'company'])
  kind!: 'contact' | 'company';

  @ApiProperty()
  @IsString()
  id!: string;
}

/** Batch name lookup for parties a call is already associated with. */
export class LookupPartiesByIdsDto {
  @ApiProperty({ type: [PartyRefDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  refs!: PartyRefDto[];
}

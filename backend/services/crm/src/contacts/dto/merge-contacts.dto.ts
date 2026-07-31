import {
  IsString, IsArray, ArrayMinSize, ArrayMaxSize, MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergeContactsDto {
  @ApiProperty({ example: 'contact-uuid', description: 'Surviving contact that absorbs the duplicates' })
  @IsString()
  @MinLength(1)
  primaryId!: string;

  @ApiProperty({
    example: ['contact-uuid-2', 'contact-uuid-3'],
    description: 'Duplicates folded into the primary and soft-deleted (1-4, i.e. 2-5 contacts merged in total)',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  mergeIds!: string[];
}

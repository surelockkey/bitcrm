import { ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Catalog ids a technician proposes, or a manager grants outright. */
export class AssignmentIdsDto {
  @ApiProperty({
    type: [String],
    example: ['e1b9c2a4-5d3f-4a71-9c8e-2f6d1b0a7e34'],
    description: 'Catalog ids (job types or service areas, depending on the route).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}

export class ReviewAssignmentDto {
  @ApiPropertyOptional({ example: 'Verified during ride-along.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}

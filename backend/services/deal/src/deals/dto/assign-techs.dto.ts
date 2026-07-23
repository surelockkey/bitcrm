import { IsArray, IsUUID, ArrayUnique } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTechsDto {
  @ApiProperty({
    type: [String],
    example: ['tech-uuid-1', 'tech-uuid-2'],
    description: 'The full technician roster for this deal. Diffed against the current one; empty clears it.',
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  techIds!: string[];
}

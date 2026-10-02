import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** `POST /deals/:id/item-groups/:groupId` — the body is optional. */
export class AddItemGroupDto {
  @ApiPropertyOptional({
    example: 'tech-uuid',
    description:
      "Whose container gives the group's stock-managed items — office callers only, and it must be " +
      'a technician assigned to the job (400 otherwise). Absent: the caller, when he is on the job; ' +
      'else none, and every product of the group is added to order. A technician always gives from ' +
      'his own container — this field is ignored for him.',
  })
  @IsOptional()
  @IsString()
  sourceTechId?: string;
}

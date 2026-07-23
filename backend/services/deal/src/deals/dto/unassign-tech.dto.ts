import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnassignTechDto {
  @ApiProperty({ example: 'tech-uuid', description: 'The technician to remove from the deal.' })
  @IsUUID()
  techId!: string;
}

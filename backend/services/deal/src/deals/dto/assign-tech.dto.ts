import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTechDto {
  @ApiProperty({ example: 'tech-uuid' })
  @IsUUID()
  techId!: string;
}

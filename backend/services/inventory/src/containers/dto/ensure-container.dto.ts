import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnsureContainerDto {
  @ApiProperty()
  @IsString()
  technicianId!: string;

  @ApiProperty()
  @IsString()
  technicianName!: string;

  @ApiProperty()
  @IsString()
  department!: string;
}

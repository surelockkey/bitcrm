import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** "Fill from warehouse": move what the container is missing from one warehouse. */
export class FillContainerTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  containerId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @ApiProperty({
    description:
      'Idempotency key — a UUID the client generates once per Apply popup / diff load. The same ' +
      'id again answers the first fill\'s result (`replayed: true`, 200) and moves nothing; 409 ' +
      'while the first is still moving or when the id was used for a different fill.',
  })
  @IsUUID()
  requestId!: string;

  @ApiPropertyOptional({ description: 'Transfer notes; defaults to "Template: <name>".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

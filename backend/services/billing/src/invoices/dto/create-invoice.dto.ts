import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateInvoiceDto {
  @ApiProperty({ example: 'deal-uuid', description: 'The job to invoice (one invoice per job).' })
  @IsString()
  @IsNotEmpty()
  dealId!: string;
}

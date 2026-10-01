import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * Either a job or a client (Workiz): with `dealId` the invoice is the job's
 * (one per job, id and number are the job's); with only `contactId` it is the
 * client's, with no job (own lines, numbered from the account counter). One of
 * the two is required.
 */
export class CreateInvoiceDto {
  @ApiPropertyOptional({ example: 'deal-uuid', description: 'The job to invoice (one invoice per job). Omit for a client invoice.' })
  @ValidateIf((o: CreateInvoiceDto) => !o.contactId || o.dealId !== undefined)
  @IsString()
  @MaxLength(120)
  dealId?: string;

  @ApiPropertyOptional({ example: 'contact-uuid', description: 'The client, for an invoice with no job.' })
  @ValidateIf((o: CreateInvoiceDto) => !o.dealId || o.contactId !== undefined)
  @IsString()
  @MaxLength(120)
  contactId?: string;
}

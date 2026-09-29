import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import type { Caller } from '../common/access';
import { CallerCtx } from '../common/caller.decorator';
import { AllowedMethodsDto } from './dto/allowed-methods.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { UpdatePaymentSettingsDto } from './dto/payment-settings.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe/stripe.service';

/**
 * The staff-facing ledger, under `/invoices/:id/...`. Registered after
 * InvoicesController; the paths are deeper than its `GET /:id`, so nothing is
 * shadowed either way.
 */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id/payments')
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: "An invoice's payment ledger",
    description:
      '**Guard:** `payments.view`. → `{ payments, summary }`, newest first. `summary.settled` is what ' +
      'counts toward the balance; `summary.pending` is money still clearing and never counts.',
  })
  async list(@Param('id') id: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.payments.listForInvoice(id, caller) };
  }

  @Post(':id/payments')
  @RequirePermission('payments', 'collect')
  @ApiOperation({
    summary: 'Record a payment taken offline',
    description:
      '**Guard:** `payments.collect` (technicians hold it with `assigned_only`). Cash, cheque, a card ' +
      'run in person or other — settled immediately. 400 above the balance; online payments come ' +
      'through the portal instead.',
  })
  async record(@Param('id') id: string, @Body() dto: RecordPaymentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.payments.recordOffline(id, dto, caller) };
  }

  @Patch(':id/allowed-methods')
  @RequirePermission('invoices', 'send')
  @ApiOperation({
    summary: 'Let the client pay this invoice with…',
    description: '**Guard:** `invoices.send`. `null` clears the override and the account settings decide.',
  })
  async allowedMethods(@Param('id') id: string, @Body() dto: AllowedMethodsDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.payments.setAllowedMethods(id, dto.methods, caller) };
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('payments', 'view')
  @ApiOperation({
    summary: 'Payments report',
    description:
      '**Guard:** `payments.view`. Newest first, filterable by date range, method, status and client; ' +
      '`assigned_only` narrows it to the caller’s jobs.',
  })
  async list(@Query() query: ListPaymentsQueryDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.payments.list(query, caller) };
  }

  @Post(':paymentId/refund')
  @RequirePermission('payments', 'refund')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Refund a payment, fully or in part',
    description:
      '**Guard:** `payments.refund`. A partial refund leaves the payment `settled` with a higher ' +
      '`refundedAmount`; the whole amount makes it `refunded`. An offline payment is book-keeping ' +
      'only — no Stripe call. 400 above what is left, 409 when nothing was collected.',
  })
  async refund(@Param('paymentId') paymentId: string, @Body() dto: RefundPaymentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.payments.refund(paymentId, dto, caller) };
  }

  @Post(':paymentId/receipt')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-send the client their receipt',
    description:
      '**Guard:** `payments.collect`. Goes out through messaging-service on the caller’s own bearer ' +
      '(billing never texts or emails anyone itself) — SMS when the contact has a number, otherwise ' +
      'email. → `{ sent, sentTo? }`; `sent: false` when the contact has no reachable address. ' +
      '409 before the payment has actually been collected.',
  })
  async receipt(
    @Param('paymentId') paymentId: string,
    @CallerCtx() caller: Caller,
    @Headers('authorization') authorization?: string,
  ) {
    return { success: true, data: await this.payments.sendReceipt(paymentId, caller, authorization) };
  }

  @Delete(':paymentId')
  @RequirePermission('payments', 'refund')
  @ApiOperation({
    summary: 'Delete a mis-keyed offline payment',
    description: '**Guard:** `payments.refund`. 409 on a Stripe-backed payment — refund it instead.',
  })
  async remove(@Param('paymentId') paymentId: string, @CallerCtx() caller: Caller) {
    await this.payments.remove(paymentId, caller);
    return { success: true, data: { deleted: true } };
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payment-settings')
export class PaymentSettingsController {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly stripe: StripeService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Account payment settings',
    description:
      '**Guard:** any authenticated user (every payment screen needs them). `stripe` reports which ' +
      'keys are configured — the keys themselves are environment config and are never returned.',
  })
  async get() {
    const configured = this.stripe.configured;
    return {
      success: true,
      data: {
        ...(await this.settings.get()),
        // The settings page shows whether payments CAN be taken. Never a key,
        // or any part of one — only whether each one is present.
        stripeConfigured: configured.secretKey && configured.publishableKey,
        stripe: configured,
      },
    };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update account payment settings',
    description:
      '**Guard:** `settings.edit`. Partial: only the fields sent change. `surchargePercent` is capped ' +
      'at 3 and `bankMinimum` cannot be negative.',
  })
  async update(@Body() dto: UpdatePaymentSettingsDto, @CurrentUser() user: JwtUser) {
    const saved = await this.settings.update(dto, user.id);
    const configured = this.stripe.configured;
    return {
      success: true,
      data: {
        ...saved,
        stripeConfigured: configured.secretKey && configured.publishableKey,
        stripe: configured,
      },
    };
  }
}

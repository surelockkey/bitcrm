import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { Caller } from '../../common/access';
import { CallerCtx } from '../../common/caller.decorator';
import { CardIntentDto, TerminalIntentDto } from '../dto/terminal-intent.dto';
import { TerminalService } from './terminal.service';

const TAG = 'Payments — Stripe Terminal (Tap to Pay)';

/**
 * Setting the phone up as a card reader. Static `/terminal/...` paths, so
 * nothing else under the prefix can shadow them.
 */
@ApiTags(TAG)
@ApiBearerAuth()
@Controller('terminal')
export class TerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @Post('connection-token')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe Terminal connection token',
    description:
      '**Guard:** `payments.collect`. For the Terminal SDK’s token provider: minted per call, single-use — never ' +
      'cache it. Scoped to the account’s Location when there is one. → `{ secret }`. 503 without Stripe.',
  })
  async connectionToken() {
    return { success: true, data: await this.terminal.connectionToken() };
  }

  @Get('location')
  @RequirePermission('payments', 'collect')
  @ApiOperation({
    summary: 'The Terminal Location Tap to Pay readers connect under',
    description:
      '**Guard:** `payments.collect`. One per business account, kept in payment settings. → `{ locationId }` ' +
      '(`null` until `POST /terminal/location` has created it) — pass it to `connectReader`.',
  })
  async location() {
    return { success: true, data: await this.terminal.location() };
  }

  @Post('location')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create the Terminal Location (once)',
    description:
      '**Guard:** `payments.collect`. Creates the account’s Location from the DEFAULT company’s address and stores ' +
      'its id in payment settings; answers the existing one when it is already there. → `{ locationId, displayName?, ' +
      'address? }`. 400 naming what is missing when the address is incomplete (street, city, state, ZIP — US); 503 ' +
      'without Stripe.',
  })
  async ensureLocation(@CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.ensureLocation(caller) };
  }
}

const INTENT_DESCRIPTION =
  'Writes the `pending` ledger row FIRST, then a `card_present` PaymentIntent (automatic capture) for `amount + ' +
  'tipAmount + feeAmount` — the phone collects and confirms it with the Terminal SDK, then calls `…/sync`. ' +
  '`feeAmount` is the service fee when payment settings have `surchargePercent > 0`: round2((amount + tip) × pct / ' +
  '100), stored on the payment, never toward the balance. The same `attemptId` answers the same payment and ' +
  'intent (409 if it is re-used for a different amount or document). ' +
  '→ `{ paymentId, intentId, clientSecret, amount, tipAmount, feeAmount, total, currency, status }`. ' +
  '409 "A signature is required before payment" until the client’s signature is on the document; 400 above what ' +
  'is owed, or when nothing is; 403 off the job’s roster; 503 without Stripe.';

const CARD_INTENT_DESCRIPTION =
  '"Type card manually" (Workiz "Credit card payment"): the card the technician typed, as the `pm_…` the phone made ' +
  'with @stripe/stripe-react-native. The same rules as Tap to Pay — the `pending` row (channel `keyed`) is written ' +
  'FIRST, then a `card` PaymentIntent for `amount + tipAmount + feeAmount` is created AND confirmed in one call ' +
  '(automatic capture, idempotency key `keyed_<attemptId>`). **HTTP 200 for every Stripe outcome**, by `status` — ' +
  'Stripe’s own: `succeeded` → the payment is settled already; `requires_action` → `handleNextAction(clientSecret)` ' +
  'on the phone, then `POST /terminal-intents/:paymentId/sync`; `requires_payment_method` → declined, the payment ' +
  'failed, `declineMessage` is Stripe’s words — ask for another card under a NEW `attemptId`. The same `attemptId` ' +
  'answers the same payment and intent (a decline answers the same decline; 409 if it is re-used for a different ' +
  'amount, document or user, or for Tap to Pay). → `{ paymentId, intentId, clientSecret, status, amount, tipAmount, ' +
  'feeAmount, total, currency, declineMessage? }`. 409 "A signature is required before payment" until the client’s ' +
  'signature is on the document; 400 above what is owed, when nothing is, for a PaymentMethod Stripe does not know; ' +
  '403 off the job’s roster; 503 without Stripe, or when Stripe did not answer (retry the SAME `attemptId`).';

/** `POST /invoices/:id/terminal-intent` — deeper than every InvoicesController route, so nothing shadows it. */
@ApiTags(TAG)
@ApiBearerAuth()
@Controller('invoices')
export class InvoiceTerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @Post(':id/terminal-intent')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tap to Pay on the job’s invoice',
    description: `**Guard:** \`payments.collect\` (technicians: \`assigned_only\`). ${INTENT_DESCRIPTION} 409 for a client invoice (no job).`,
  })
  async open(@Param('id') id: string, @Body() dto: TerminalIntentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.openForInvoice(id, dto, caller) };
  }

  @Post(':id/card-intent')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A typed card on the job’s invoice',
    description: `**Guard:** \`payments.collect\` (technicians: \`assigned_only\`). ${CARD_INTENT_DESCRIPTION} 409 for a client invoice (no job).`,
  })
  async card(@Param('id') id: string, @Body() dto: CardIntentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.openCardForInvoice(id, dto, caller) };
  }
}

/** `POST /estimates/:id/terminal-intent` — the estimate's deposit by card. */
@ApiTags(TAG)
@ApiBearerAuth()
@Controller('estimates')
export class EstimateTerminalController {
  constructor(private readonly terminal: TerminalService) {}

  @Post(':id/terminal-intent')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tap to Pay for an estimate’s deposit',
    description:
      `**Guard:** \`payments.collect\` (technicians: \`assigned_only\`). The deposit lands on the JOB’s ledger, ` +
      `tagged with the estimate, up to what is still owed of it. ${INTENT_DESCRIPTION} 400 when the estimate asks ` +
      'for no deposit; 409 for a client estimate (no job).',
  })
  async open(@Param('id') id: string, @Body() dto: TerminalIntentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.openForEstimate(id, dto, caller) };
  }

  @Post(':id/card-intent')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A typed card for an estimate’s deposit',
    description:
      `**Guard:** \`payments.collect\` (technicians: \`assigned_only\`). The deposit lands on the JOB’s ledger, ` +
      `tagged with the estimate, up to what is still owed of it. ${CARD_INTENT_DESCRIPTION} 400 when the estimate ` +
      'asks for no deposit; 409 for a client estimate (no job).',
  })
  async card(@Param('id') id: string, @Body() dto: CardIntentDto, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.openCardForEstimate(id, dto, caller) };
  }
}

/** After the tap. Its own prefix: no `/payments/:paymentId/...` route can take it. */
@ApiTags(TAG)
@ApiBearerAuth()
@Controller('terminal-intents')
export class TerminalIntentsController {
  constructor(private readonly terminal: TerminalService) {}

  @Post(':paymentId/cancel')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a phone card attempt (Tap to Pay or a typed card)',
    description:
      '**Guard:** `payments.collect`. For a payment of channel `terminal` or `keyed`. Cancels the PaymentIntent at ' +
      'Stripe so it can never be charged; the payment fails as "Cancelled on the device". → `{ payment, ledger }` ' +
      '(the job’s ledger). 409 when it already went through (refund it instead) or was not taken on a phone.',
  })
  async cancel(@Param('paymentId') paymentId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.cancel(paymentId, caller) };
  }

  @Post(':paymentId/sync')
  @RequirePermission('payments', 'collect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Settle a phone card attempt from Stripe now (after the tap, or a typed card’s 3-D Secure step)',
    description:
      '**Guard:** `payments.collect`. For a payment of channel `terminal` or `keyed`. Reads the PaymentIntent and ' +
      'asserts its outcome exactly as the webhook would ' +
      '(whichever lands first wins): `succeeded` → settled (card brand + last 4 recorded), a decline → failed with ' +
      'the reason (the same intent may still be retried), still waiting for the card → unchanged. → `{ payment, ' +
      'ledger }`. 409 when the payment was not taken on a phone.',
  })
  async sync(@Param('paymentId') paymentId: string, @CallerCtx() caller: Caller) {
    return { success: true, data: await this.terminal.sync(paymentId, caller) };
  }
}

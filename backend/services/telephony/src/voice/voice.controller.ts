import {
  Body,
  Controller,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import {
  VoiceService,
  type InboundBody,
  type OutboundBody,
} from './voice.service';
import { ConferenceService } from './conference.service';
import { CallsService, type TwilioStatusParams } from '../calls/calls.service';
import { TwilioSignatureGuard } from '../common/twilio-signature.guard';

/**
 * Twilio voice webhooks. These are called by Twilio (not the SPA), so they are
 * `@Public()` (no Cognito) but protected by the Twilio signature guard — the
 * signature covers the full URL including query strings, so the ?conf&role
 * routing params on status callbacks are tamper-proof. All return TwiML.
 */
@ApiTags('Telephony')
@Public()
@UseGuards(TwilioSignatureGuard)
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly conferenceService: ConferenceService,
    private readonly callsService: CallsService,
  ) {}

  @Post('outbound')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  outbound(@Body() body: OutboundBody): Promise<string> {
    return this.voiceService.buildOutbound(body);
  }

  @Post('inbound')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  inbound(@Body() body: InboundBody): Promise<string> {
    return this.voiceService.buildInbound(body);
  }

  /** Answer webhook for inbound agent ring legs — first answer wins here. */
  @Post('agent-join')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  agentJoin(
    @Query('conf') conf: string,
    @Body() body: { CallSid?: string; To?: string },
  ): Promise<string> {
    return this.voiceService.buildAgentJoin(conf ?? '', body);
  }

  /** Conference lifecycle events (start/end/join/leave). */
  @Post('conference-events')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async conferenceEvents(
    @Body()
    body: {
      StatusCallbackEvent?: string;
      FriendlyName?: string;
      ConferenceSid?: string;
      CallSid?: string;
    },
  ): Promise<string> {
    const name = body.FriendlyName ?? '';
    if (body.StatusCallbackEvent === 'participant-join' && body.ConferenceSid) {
      // The outbound customer leg is spawned from the agent's join — a lone
      // participant never triggers conference-start (see ConferenceService).
      await this.conferenceService.onParticipantJoin(
        name,
        body.ConferenceSid,
        body.CallSid,
      );
    } else if (
      body.StatusCallbackEvent === 'conference-start' &&
      body.ConferenceSid
    ) {
      await this.conferenceService.onConferenceStart(name, body.ConferenceSid);
    } else if (body.StatusCallbackEvent === 'conference-end') {
      await this.conferenceService.onConferenceEnd(name);
    }
    return '<Response/>';
  }

  /** Conference recording ready. */
  @Post('recording-status')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async recordingStatus(
    @Body()
    body: {
      RecordingSid?: string;
      RecordingStatus?: string;
      RecordingDuration?: string;
      ConferenceSid?: string;
    },
  ): Promise<string> {
    await this.conferenceService.onRecordingStatus(body);
    return '<Response/>';
  }

  /**
   * Call-status callbacks. Conference legs carry ?conf=<name>&role=… and route
   * through the orchestration; the bare form is the legacy path kept for any
   * in-flight pre-conference calls during a deploy.
   */
  @Post('status')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async status(
    @Body() body: TwilioStatusParams,
    @Query('conf') conf?: string,
    @Query('role') role?: string,
  ): Promise<string> {
    if (conf && (role === 'customer' || role === 'agent')) {
      await this.conferenceService.onLegStatus(conf, role, body);
    } else {
      await this.callsService.recordStatus(body);
    }
    return '<Response/>';
  }
}

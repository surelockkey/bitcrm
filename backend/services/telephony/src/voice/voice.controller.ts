import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Response } from 'express';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import {
  VoiceService,
  type InboundBody,
  type OutboundBody,
} from './voice.service';
import { ConferenceService } from './conference.service';
import { FlowRunnerService } from './flow-runner.service';
import { FlowAudioService } from '../call-flows/flow-audio.service';
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
    private readonly flowRunner: FlowRunnerService,
    private readonly flowAudio: FlowAudioService,
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

  /**
   * The next step of a call flow. Twilio comes back here after a greeting
   * finishes, or when nobody answered a ring step. A step that can't run
   * returns the legacy inbound answer rather than silence.
   */
  @Post('flow')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async flowStep(
    @Query('node') node: string,
    @Query('after') after: string | undefined,
    @Body() body: InboundBody & { Digits?: string; CallStatus?: string },
  ): Promise<string> {
    const fromFlow = body.CallSid
      ? await this.flowRunner.resume(
          body.CallSid,
          node ?? '',
          body.Digits,
          body.CallStatus,
          after === '1',
        )
      : null;
    return fromFlow ?? this.voiceService.buildInbound(body);
  }

  /**
   * A recorded greeting, streamed to whoever asks.
   *
   * Deliberately unauthenticated: Twilio fetches this itself while the call is
   * ringing and cannot carry a token. The id is an unguessable uuid, and the
   * content is a greeting a caller is about to hear anyway.
   */
  @Get('audio/:id')
  @Public()
  @ApiExcludeEndpoint()
  async audio(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const found = await this.flowAudio.read(id);
    if (!found) {
      res.status(404).end();
      return;
    }
    res.set({
      'Content-Type': found.contentType,
      // Greetings change rarely, and Twilio re-fetches on every call.
      'Cache-Control': 'public, max-age=3600',
    });
    (found.body as unknown as NodeJS.ReadableStream).pipe(res);
  }

  /** A voicemail finished recording. */
  @Post('voicemail-recording')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async voicemailRecording(
    @Body()
    body: {
      CallSid?: string;
      RecordingSid?: string;
      RecordingStatus?: string;
      RecordingDuration?: string;
    },
  ): Promise<string> {
    await this.flowRunner.onVoicemailRecording(body);
    return '<Response/>';
  }

  /** Answer webhook for inbound agent ring legs — first answer wins here. */
  @Post('agent-join')
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  agentJoin(
    @Query('conf') conf: string,
    @Query('whisper') whisper: string | undefined,
    @Body() body: { CallSid?: string; To?: string; Digits?: string },
  ): Promise<string> {
    return this.voiceService.buildAgentJoin(conf ?? '', body, whisper === '1');
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
      body.StatusCallbackEvent === 'participant-leave' &&
      body.ConferenceSid
    ) {
      // Subscribed since the conference was introduced, but never acted on —
      // which is how a customer could be left alone on the line.
      await this.conferenceService.onParticipantLeave(name, body.ConferenceSid);
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

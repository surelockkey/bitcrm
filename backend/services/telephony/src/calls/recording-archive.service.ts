import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { S3Service } from '@bitcrm/shared';
import { CallsRepository } from './calls.repository';
import { WebhookQueue } from '../common/webhook-queue';
import { TELEPHONY_CONFIG, type TelephonyConfig } from '../telephony/telephony.config';

/**
 * Where a copied Twilio recording lives in the app bucket — under `calls/`,
 * beside the audio imported from Workiz (which sits at the key its own row
 * names). One object per recording: a call re-recorded keeps both.
 */
export const recordingS3Key = (callSid: string, recordingSid: string) =>
  `calls/recordings/${callSid}/${recordingSid}.mp3`;

/** Twilio sometimes answers 404 for a moment after its own "completed" callback. */
const ATTEMPTS = 3;
const RETRY_MS = 2_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Copies a finished call recording from Twilio into our bucket and stores the
 * key on the call (`recordingKey`), so `GET /calls/:sid/recording` serves it
 * from S3 (presigned URL / Range) instead of proxying Twilio on every play.
 *
 * Runs in the background on the webhook queue (key `recording:<callSid>`) —
 * the recording-status webhook never waits for the download. A copy that
 * fails is logged and the call keeps playing through the Twilio path; nothing
 * about the call depends on the copy.
 */
@Injectable()
export class RecordingArchiveService {
  private readonly logger = new Logger(RecordingArchiveService.name);

  constructor(
    private readonly repo: CallsRepository,
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly queue?: WebhookQueue,
    @Optional() @Inject('RECORDING_ARCHIVE_SLEEP') private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /** Copy in the background. Never throws, never blocks the caller. */
  schedule(callSid: string, recordingSid: string): void {
    if (!this.s3) return;
    const job = () => this.archive(callSid, recordingSid);
    if (this.queue) {
      this.queue.enqueue(`recording:${callSid}`, 'recording-archive', job);
      return;
    }
    void job().catch((err) =>
      this.logger.warn(`Recording ${recordingSid} of ${callSid} not copied: ${err instanceof Error ? err.message : err}`),
    );
  }

  /** Download from Twilio, upload to S3, stamp the key. Returns the key. */
  async archive(callSid: string, recordingSid: string): Promise<string> {
    if (!this.s3) throw new Error('No bucket configured');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Recordings/${recordingSid}.mp3`;
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');

    let body: Buffer | undefined;
    let lastStatus: number | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) {
        body = Buffer.from(await res.arrayBuffer());
        break;
      }
      lastStatus = res.status;
      if (attempt < ATTEMPTS) await this.sleep(RETRY_MS * attempt);
    }
    if (!body) throw new Error(`Twilio recording ${recordingSid} returned ${lastStatus}`);

    const key = recordingS3Key(callSid, recordingSid);
    await this.s3.putObject(key, body, {
      // What the browser is told when it streams the presigned URL — an mp3
      // with the right type is what lets <audio> seek.
      contentType: 'audio/mpeg',
      metadata: { recordingSid, callSid, source: 'twilio' },
    });
    await this.repo.setRecordingKey(callSid, key);
    this.logger.log(`Recording ${recordingSid} of ${callSid} copied to ${key} (${body.length} bytes)`);
    return key;
  }
}

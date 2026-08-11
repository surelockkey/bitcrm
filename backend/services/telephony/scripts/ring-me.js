/**
 * Dev utility — ring your own softphone to test INBOUND for free.
 *
 *   cd backend/services/telephony
 *   node scripts/ring-me.js
 *
 * Your own phone can't dial the US Twilio number (carrier blocks the
 * international leg), and calling the number from Twilio loops back on itself.
 * So instead this finds whoever is currently ONLINE (softphone toggled on) and
 * places a Twilio call straight to that browser client — exactly what a real
 * inbound call does to your device. A client (WebRTC) call has no PSTN leg, so
 * it costs ~nothing. Toggle the phone ON in the app first, then run this.
 */
const { config } = require('dotenv');
const { resolve } = require('path');
config({ path: resolve(__dirname, '../../../.env') });

const twilio = require('twilio');
const Redis = require('ioredis');

(async () => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, REDIS_URL } =
    process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in backend/.env');
    process.exit(1);
  }

  // Read the online-agent set exactly like the inbound webhook does.
  const redis = new Redis(REDIS_URL || 'redis://localhost:6379');
  const now = Date.now();
  await redis.zremrangebyscore('telephony:online', 0, now);
  const online = await redis.zrange('telephony:online', 0, -1);
  await redis.quit();

  if (online.length === 0) {
    console.error(
      'No agents online. In the app: switch the phone ON (green dot), then rerun.',
    );
    process.exit(1);
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // Caller id: TWILIO_CALLER_ID when set, else the account's first owned number.
  let from = TWILIO_CALLER_ID;
  if (!from) {
    const owned = await client.incomingPhoneNumbers.list({ limit: 1 });
    from = owned[0]?.phoneNumber;
  }
  if (!from) {
    console.error('No caller id: set TWILIO_CALLER_ID or buy a number first.');
    process.exit(1);
  }

  console.log(`Ringing ${online.length} online client(s): ${online.join(', ')}`);

  for (const identity of online) {
    try {
      const call = await client.calls.create({
        to: `client:${identity}`,
        from,
        twiml:
          '<Response><Say voice="alice">This is a test inbound call from your Bit C R M softphone. It works.</Say><Pause length="10"/></Response>',
      });
      console.log(`  ${identity}: ringing → ${call.sid}`);
    } catch (e) {
      console.error(`  ${identity}: FAILED ${e.code || ''} ${e.message}`);
    }
  }

  console.log('\nWatch your browser — accept the incoming-call popup.');
})();

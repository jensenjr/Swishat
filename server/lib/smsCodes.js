// Storage for one-time SMS recovery codes. Codes are hashed (argon2), expire
// after a short TTL, allow a limited number of verify attempts, and there is
// at most one outstanding code per Swish number (re-requesting replaces it).
//
// DB-backed so codes survive a restart and work across multiple instances.
// The table is bootstrapped on startup (CREATE TABLE IF NOT EXISTS).

import sql from '../db.js';
import argon2 from 'argon2';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// Per-number send limits (IP-independent) so a number can't be SMS-bombed even
// from rotating IPs. Configurable via env so they can be tuned per deployment.
// Uses a default only when unset/invalid — an explicit 0 is honoured.
function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}
const RESEND_COOLDOWN_MS = envInt('SMS_RESEND_COOLDOWN_SEC', 60) * 1000;
const MAX_PER_HOUR = envInt('SMS_MAX_PER_HOUR', 3);
const MAX_PER_DAY = envInt('SMS_MAX_PER_DAY', 10);

// Periodically prune the send log so it can't grow unbounded.
const sendsSweep = setInterval(() => {
  sql`DELETE FROM sms_sends WHERE created_at < NOW() - INTERVAL '25 hours'`.catch(
    (err) => console.error('sms_sends sweep failed:', err.message),
  );
}, 60 * 60 * 1000);
sendsSweep.unref?.();

export async function ensureSmsSchema() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS sms_codes (
        swish_number TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    // Append-only log of actual sends, used for the per-number rate caps.
    await sql`
      CREATE TABLE IF NOT EXISTS sms_sends (
        id BIGSERIAL PRIMARY KEY,
        swish_number TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS sms_sends_number_time_idx
      ON sms_sends (swish_number, created_at DESC)
    `;
  } catch (err) {
    console.error('SMS recovery storage unavailable:', err.message);
  }
}

// Whether another code may be sent to this number now: enforces a short
// cooldown plus rolling hourly and daily caps. Counts actual sends only.
export async function canSend(swishNumber) {
  const [s] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS last_hour,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')  AS last_day,
      MAX(created_at) AS last_sent
    FROM sms_sends
    WHERE swish_number = ${swishNumber}
  `;
  if (!s || !s.last_sent) return true;
  if (Date.now() - new Date(s.last_sent).getTime() < RESEND_COOLDOWN_MS) return false;
  if (Number(s.last_hour) >= MAX_PER_HOUR) return false;
  if (Number(s.last_day) >= MAX_PER_DAY) return false;
  return true;
}

// Record an actual send (after the SMS was accepted by the provider).
export async function recordSend(swishNumber) {
  await sql`INSERT INTO sms_sends (swish_number) VALUES (${swishNumber})`;
  await sql`
    DELETE FROM sms_sends
    WHERE swish_number = ${swishNumber} AND created_at < NOW() - INTERVAL '25 hours'
  `;
}

export async function storeCode(swishNumber, code) {
  const code_hash = await argon2.hash(code);
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await sql`
    INSERT INTO sms_codes (swish_number, code_hash, attempts, expires_at, created_at)
    VALUES (${swishNumber}, ${code_hash}, 0, ${expires_at}, NOW())
    ON CONFLICT (swish_number) DO UPDATE
      SET code_hash = ${code_hash}, attempts = 0, expires_at = ${expires_at}, created_at = NOW()
  `;
}

export async function clearCode(swishNumber) {
  await sql`DELETE FROM sms_codes WHERE swish_number = ${swishNumber}`;
}

// Verifies and consumes the code. Returns true on success (and deletes it),
// false otherwise (incrementing the attempt counter on a wrong code).
export async function verifyCode(swishNumber, code) {
  const [row] = await sql`
    SELECT code_hash, attempts, expires_at FROM sms_codes WHERE swish_number = ${swishNumber}
  `;
  if (!row) return false;
  if (new Date(row.expires_at) < new Date() || row.attempts >= MAX_ATTEMPTS) {
    await clearCode(swishNumber);
    return false;
  }
  const match = await argon2.verify(row.code_hash, code);
  if (!match) {
    await sql`UPDATE sms_codes SET attempts = attempts + 1 WHERE swish_number = ${swishNumber}`;
    return false;
  }
  await clearCode(swishNumber);
  return true;
}

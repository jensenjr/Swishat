// Storage for one-time SMS recovery codes. Codes are hashed (argon2), expire
// after a short TTL, allow a limited number of verify attempts, and there is
// at most one outstanding code per Swish number (re-requesting replaces it).
//
// DB-backed so codes survive a restart and work across multiple instances.
// The table is bootstrapped on startup (CREATE TABLE IF NOT EXISTS).

import sql from '../db.js';
import argon2 from 'argon2';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // min gap between sends to one number
const MAX_ATTEMPTS = 5;

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
  } catch (err) {
    console.error('SMS recovery storage unavailable:', err.message);
  }
}

// True if no code was sent to this number within the cooldown window. Prevents
// using the request endpoint to flood a victim's phone.
export async function canSend(swishNumber) {
  const [row] = await sql`
    SELECT created_at FROM sms_codes WHERE swish_number = ${swishNumber}
  `;
  if (!row) return true;
  return Date.now() - new Date(row.created_at).getTime() > RESEND_COOLDOWN_MS;
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

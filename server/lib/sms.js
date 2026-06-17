// 46elks SMS transport. Credentials come from the environment and are never
// committed — see .env.example (ELKS_API_USERNAME / ELKS_API_PASSWORD / ELKS_FROM).

// Overridable so tests can point at a local mock instead of the live API.
const ELKS_API_URL = process.env.ELKS_API_URL || 'https://api.46elks.com/a1/sms';

export function smsConfigured() {
  return Boolean(process.env.ELKS_API_USERNAME && process.env.ELKS_API_PASSWORD);
}

// Normalise a Swedish number to E.164 (+46...), which 46elks requires for `to`.
export function toE164Swedish(raw) {
  const n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) return n;
  if (n.startsWith('00')) return '+' + n.slice(2);
  if (n.startsWith('0')) return '+46' + n.slice(1);
  if (n.startsWith('46')) return '+' + n;
  return '+' + n; // best effort for already-international input
}

export async function sendSms(to, message) {
  if (!smsConfigured()) throw new Error('SMS is not configured');
  const from = process.env.ELKS_FROM || 'Swishat';
  const auth = Buffer.from(
    `${process.env.ELKS_API_USERNAME}:${process.env.ELKS_API_PASSWORD}`,
  ).toString('base64');

  const res = await fetch(ELKS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ from, to, message }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`46elks responded ${res.status}: ${detail}`);
  }
  return res.json().catch(() => ({}));
}

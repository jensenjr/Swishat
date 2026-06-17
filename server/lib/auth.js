// Admin authentication helpers.

import { timingSafeEqual } from 'node:crypto';

// Extract the admin token from the Authorization header (preferred). Falls back
// to the legacy ?token= query param for backward compatibility, but clients
// should send the header so the token never lands in server/proxy access logs.
export function getAdminToken(c) {
  const auth = c.req.header('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null;
  }
  return c.req.query('token') || null;
}

// Constant-time token comparison to avoid leaking length/prefix via timing.
export function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

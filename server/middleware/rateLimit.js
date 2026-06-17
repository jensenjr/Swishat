// In-memory rate limiting and brute-force lockout.
//
// State lives in this process's memory, which is correct for the current
// single-instance deployment. When the app scales horizontally (multiple
// instances behind a load balancer), swap the Map-backed stores here for a
// shared store such as Redis — only this file needs to change; the middleware
// and AttemptLimiter signatures stay the same.

const WINDOW_STORE = new Map(); // `${path}:${id}` -> { count, resetAt }

// Periodically drop expired windows so the map can't grow unbounded.
const windowSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of WINDOW_STORE) {
    if (entry.resetAt <= now) WINDOW_STORE.delete(key);
  }
}, 60_000);
windowSweep.unref?.();

// Client IP, trusting the reverse proxy (Coolify/Traefik) that terminates TLS
// and sets these headers. Only safe because the app is not exposed directly.
function getClientIp(c) {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}

// Fixed-window rate limiter middleware.
export function rateLimit({
  windowMs,
  max,
  message = 'För många förfrågningar. Försök igen om en stund.',
  keyGenerator,
} = {}) {
  return async (c, next) => {
    const id = keyGenerator ? keyGenerator(c) : getClientIp(c);
    const key = `${c.req.path}:${id}`;
    const now = Date.now();
    const entry = WINDOW_STORE.get(key);

    if (!entry || entry.resetAt <= now) {
      WINDOW_STORE.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count += 1;
      if (entry.count > max) {
        c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return c.json({ error: message }, 429);
      }
    }
    await next();
  };
}

// Per-identifier failed-attempt lockout, e.g. brute force on PIN recovery.
// Complements rateLimit: the IP limiter slows a single source, this locks a
// specific target (a Swish number) even across rotating IPs.
export class AttemptLimiter {
  constructor({ maxFailures, lockMs }) {
    this.maxFailures = maxFailures;
    this.lockMs = lockMs;
    this.store = new Map(); // id -> { failures, lockedUntil, lastFailure }

    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, e] of this.store) {
        const locked = e.lockedUntil && e.lockedUntil > now;
        const recent = e.lastFailure && now - e.lastFailure < lockMs;
        if (!locked && !recent) this.store.delete(id);
      }
    }, lockMs);
    sweep.unref?.();
  }

  isLocked(id) {
    const e = this.store.get(id);
    if (!e || !e.lockedUntil) return false;
    if (e.lockedUntil > Date.now()) return true;
    this.store.delete(id); // lock expired
    return false;
  }

  recordFailure(id) {
    const e = this.store.get(id) || { failures: 0, lockedUntil: 0, lastFailure: 0 };
    e.failures += 1;
    e.lastFailure = Date.now();
    if (e.failures >= this.maxFailures) {
      e.lockedUntil = Date.now() + this.lockMs;
      e.failures = 0;
    }
    this.store.set(id, e);
  }

  clear(id) {
    this.store.delete(id);
  }
}

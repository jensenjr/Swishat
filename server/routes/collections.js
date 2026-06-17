import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import sql from '../db.js';
import argon2 from 'argon2';
import { rateLimit, AttemptLimiter } from '../middleware/rateLimit.js';
import { getAdminToken, tokensMatch } from '../lib/auth.js';
import {
  ValidationError,
  requireText,
  optionalText,
  optionalAmount,
  MAX_TARGET,
  LIMITS,
} from '../lib/validate.js';

const app = new Hono();

// Columns safe to return to a client. Never includes pin_hash; admin_token is
// added explicitly only on the create response (the owner needs it once).
const PUBLIC_COLLECTION_COLUMNS = sql`
  id, title, description, target_amount, swish_number, suggested_amount,
  require_proof, is_active, expires_at, hard_cap_at,
  last_admin_activity_at, last_contribution_at, created_at
`;

// Brute-force lockout for credential recovery, keyed on the targeted Swish
// number. Designed to also cover the planned SMS-code recovery endpoint.
const recoveryLockout = new AttemptLimiter({
  maxFailures: 5,
  lockMs: 15 * 60 * 1000,
});

// IP-based limiters. Recovery and creation are the abuse-prone endpoints.
const recoverRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const createRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

// POST /api/collections/recover — must be before /:id
app.post('/collections/recover', recoverRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { swish_number, pin } = body;

    if (!swish_number || !pin) {
      return c.json({ error: 'Swish-nummer och PIN-kod krävs' }, 400);
    }

    const lockKey = String(swish_number).trim();
    if (recoveryLockout.isLocked(lockKey)) {
      return c.json(
        { error: 'För många misslyckade försök. Försök igen om en stund.' },
        429,
      );
    }

    const collections = await sql`
      SELECT id, title, admin_token, pin_hash, expires_at, is_active
      FROM collections
      WHERE swish_number = ${swish_number}
        AND pin_hash IS NOT NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;

    for (const collection of collections) {
      const match = await argon2.verify(collection.pin_hash, pin.toString());
      if (match) {
        recoveryLockout.clear(lockKey);
        return c.json({
          id: collection.id,
          title: collection.title,
          admin_token: collection.admin_token,
        });
      }
    }

    // Single generic response whether the number is unknown or the PIN is
    // wrong, so the endpoint can't be used to enumerate Swish numbers.
    recoveryLockout.recordFailure(lockKey);
    return c.json({ error: 'Felaktigt Swish-nummer eller PIN-kod' }, 401);
  } catch (error) {
    console.error('Error recovering collection:', error);
    return c.json({ error: 'Återställning misslyckades' }, 500);
  }
});

// POST /api/collections
app.post('/collections', createRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { require_proof, pin } = body;

    const title = requireText(body.title, 'Titel', LIMITS.title);
    const swish_number = requireText(body.swish_number, 'Swish-nummer', LIMITS.swishNumber);
    const description = optionalText(body.description, 'Beskrivning', LIMITS.description);
    const target_amount = optionalAmount(body.target_amount, { field: 'Målbelopp', max: MAX_TARGET });
    const suggested_amount = optionalAmount(body.suggested_amount, { field: 'Rekommenderat belopp' });

    const admin_token = randomUUID();

    let pin_hash = null;
    if (pin && String(pin).length >= 4) {
      pin_hash = await argon2.hash(String(pin));
    }

    const [collection] = await sql`
      INSERT INTO collections (
        title, description, target_amount, swish_number, suggested_amount,
        require_proof, admin_token, pin_hash, expires_at, hard_cap_at, last_admin_activity_at
      ) VALUES (
        ${title},
        ${description},
        ${target_amount},
        ${swish_number},
        ${suggested_amount},
        ${require_proof === true},
        ${admin_token},
        ${pin_hash},
        NOW() + INTERVAL '14 days',
        NOW() + INTERVAL '30 days',
        NOW()
      ) RETURNING ${PUBLIC_COLLECTION_COLUMNS}, admin_token
    `;

    return c.json(collection);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    console.error('Error creating collection:', error);
    return c.json({ error: 'Kunde inte skapa insamlingen' }, 500);
  }
});

// GET /api/collections/:id
app.get('/collections/:id', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);

  try {
    const [collection] = await sql`
      SELECT id, title, description, target_amount, swish_number, suggested_amount,
             is_active, created_at, require_proof, expires_at, hard_cap_at,
             last_admin_activity_at, last_contribution_at
      FROM collections
      WHERE id = ${id}
    `;

    if (!collection) {
      return c.json({ error: 'Insamlingen hittades inte' }, 404);
    }

    const [stats] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'verified') AS verified_count,
        COUNT(*) AS total_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0) AS total_collected
      FROM contributions
      WHERE collection_id = ${id}
    `;

    const now = new Date();
    const expiresAt = new Date(collection.expires_at);
    const hardCapAt = new Date(collection.hard_cap_at);
    const daysUntilExpiry = Math.max(
      0,
      Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)),
    );
    const daysUntilHardCap = Math.max(
      0,
      Math.ceil((hardCapAt - now) / (1000 * 60 * 60 * 24)),
    );
    const isExpired = expiresAt < now;

    const result = {
      ...collection,
      stats: {
        verified_count: parseInt(stats.verified_count || 0),
        total_count: parseInt(stats.total_count || 0),
        total_collected: parseFloat(stats.total_collected || 0),
      },
      expiry: {
        daysUntilExpiry,
        daysUntilHardCap,
        isExpired,
        isAtHardCap: daysUntilHardCap <= 0,
        isNearHardCap: daysUntilHardCap <= 7,
      },
    };

    const [adminRow] = await sql`
      SELECT admin_token FROM collections WHERE id = ${id}
    `;

    if (token && adminRow && tokensMatch(token, adminRow.admin_token)) {
      const contributions = await sql`
        SELECT * FROM contributions
        WHERE collection_id = ${id}
        ORDER BY created_at DESC
      `;
      result.contributions = contributions;
      result.isAdmin = true;
    }

    return c.json(result);
  } catch (error) {
    console.error('Error fetching collection:', error);
    return c.json({ error: 'Kunde inte hämta insamlingen' }, 500);
  }
});

// PATCH /api/collections/:id
app.patch('/collections/:id', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);

  try {
    const [adminRow] = await sql`
      SELECT admin_token, expires_at, hard_cap_at FROM collections WHERE id = ${id}
    `;

    if (!token || !adminRow || !tokensMatch(token, adminRow.admin_token)) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    const body = await c.req.json();
    const { is_active, extend } = body;

    if (extend) {
      const now = new Date();
      const newExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const hardCapAt = new Date(adminRow.hard_cap_at);
      const finalExpiry = newExpiry > hardCapAt ? hardCapAt : newExpiry;

      const [updated] = await sql`
        UPDATE collections
        SET expires_at = ${finalExpiry.toISOString()}, last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING ${PUBLIC_COLLECTION_COLUMNS}
      `;
      return c.json(updated);
    }

    if (is_active !== undefined) {
      const [updated] = await sql`
        UPDATE collections
        SET is_active = ${is_active === true}, last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING ${PUBLIC_COLLECTION_COLUMNS}
      `;
      return c.json(updated);
    }

    return c.json({ error: 'Inga fält att uppdatera' }, 400);
  } catch (error) {
    console.error('Error updating collection:', error);
    return c.json({ error: 'Kunde inte uppdatera insamlingen' }, 500);
  }
});

export default app;

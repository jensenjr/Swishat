import { Hono } from 'hono';
import { randomInt } from 'node:crypto';
import sql from '../db.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getAdminToken, tokensMatch } from '../lib/auth.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAudit } from '../lib/audit.js';
import {
  ValidationError,
  requireText,
  optionalAmount,
  isValidStatus,
  LIMITS,
} from '../lib/validate.js';

const app = new Hono();

const contributionRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 60 });

// POST /api/contributions
app.post('/contributions', contributionRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { collection_id, status: requestedStatus } = body;
    // Admin token may arrive via the Authorization header or (legacy) the body.
    const token = getAdminToken(c) || body.token;

    if (!collection_id) {
      return c.json({ error: 'Insamlings-ID krävs' }, 400);
    }

    const name = requireText(body.name, 'Namn', LIMITS.name);
    const amount = optionalAmount(body.amount, { field: 'Belopp' });

    const [collection] = await sql`
      SELECT id, is_active, expires_at, hard_cap_at, suggested_amount, admin_token
      FROM collections
      WHERE id = ${collection_id}
    `;

    if (!collection) {
      return c.json({ error: 'Insamlingen hittades inte' }, 404);
    }

    // Admin bypass: valid token skips active/expiry checks and allows custom status
    const isAdmin = token && tokensMatch(token, collection.admin_token);

    if (!isAdmin) {
      if (!collection.is_active) {
        return c.json({ error: 'Insamlingen är stängd' }, 403);
      }
      if (new Date(collection.expires_at) < new Date()) {
        return c.json({ error: 'Insamlingen har gått ut' }, 403);
      }
    }

    // Reference code: drawn from a CSPRNG so it can't be predicted from other
    // generated values, uniformly over the alphabet.
    const generateRef = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const part = () =>
        Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('');
      return `${part()}-${part()}`;
    };

    const reference_code = generateRef();

    let status = 'unverified';
    if (isAdmin && requestedStatus !== undefined) {
      if (!isValidStatus(requestedStatus)) {
        return c.json({ error: 'Ogiltig status' }, 400);
      }
      status = requestedStatus;
    }

    const [contribution] = await sql`
      INSERT INTO contributions (collection_id, name, amount, reference_code, status)
      VALUES (
        ${collection_id},
        ${name},
        ${amount ?? collection.suggested_amount ?? null},
        ${reference_code},
        ${status}
      ) RETURNING *
    `;

    // Audit only admin-created (manual) entries; public contributions are
    // already self-recorded as their own row.
    if (isAdmin) {
      await recordAudit({
        collectionId: collection_id,
        contributionId: contribution.id,
        action: 'contribution.create_manual',
        detail: { name: contribution.name, amount: contribution.amount, status },
        ip: getClientIp(c),
      });
    }

    // Auto-extend if less than 7 days remain
    const now = new Date();
    const expiresAt = new Date(collection.expires_at);
    const hardCapAt = new Date(collection.hard_cap_at);
    const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

    if (daysUntilExpiry < 7) {
      const newExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const finalExpiry = newExpiry > hardCapAt ? hardCapAt : newExpiry;
      await sql`
        UPDATE collections
        SET expires_at = ${finalExpiry.toISOString()}, last_contribution_at = NOW()
        WHERE id = ${collection_id}
      `;
    } else {
      await sql`
        UPDATE collections SET last_contribution_at = NOW() WHERE id = ${collection_id}
      `;
    }

    return c.json(contribution);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    console.error('Error creating contribution:', error);
    return c.json({ error: 'Kunde inte registrera betalningen' }, 500);
  }
});

// PATCH /api/contributions/:id
app.patch('/contributions/:id', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);

  try {
    const collectionId = await verifyAdmin(id, token);
    if (!collectionId) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    const body = await c.req.json();
    const { status } = body;

    if (status === undefined && body.amount === undefined) {
      return c.json({ error: 'Inga fält att uppdatera' }, 400);
    }

    if (status !== undefined && !isValidStatus(status)) {
      return c.json({ error: 'Ogiltig status' }, 400);
    }

    const amount =
      body.amount === undefined ? undefined : optionalAmount(body.amount, { field: 'Belopp' });

    let updated;
    if (status !== undefined && amount !== undefined) {
      [updated] = await sql`
        UPDATE contributions SET status = ${status}, amount = ${amount}
        WHERE id = ${id} RETURNING *
      `;
    } else if (status !== undefined) {
      [updated] = await sql`
        UPDATE contributions SET status = ${status}
        WHERE id = ${id} RETURNING *
      `;
    } else {
      [updated] = await sql`
        UPDATE contributions SET amount = ${amount}
        WHERE id = ${id} RETURNING *
      `;
    }

    await sql`
      UPDATE collections SET last_admin_activity_at = NOW() WHERE id = ${collectionId}
    `;

    const detail = {};
    if (status !== undefined) detail.status = status;
    if (amount !== undefined) detail.amount = amount;
    await recordAudit({
      collectionId,
      contributionId: id,
      action: 'contribution.update',
      detail,
      ip: getClientIp(c),
    });

    return c.json(updated);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    console.error('Error updating contribution:', error);
    return c.json({ error: 'Kunde inte uppdatera bidraget' }, 500);
  }
});

// DELETE /api/contributions/:id
app.delete('/contributions/:id', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);

  try {
    const collectionId = await verifyAdmin(id, token);
    if (!collectionId) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    // Capture the row before deleting so the audit entry retains what was removed.
    const [removed] = await sql`
      SELECT name, amount, reference_code, status FROM contributions WHERE id = ${id}
    `;

    await sql`DELETE FROM contributions WHERE id = ${id}`;
    await sql`
      UPDATE collections SET last_admin_activity_at = NOW() WHERE id = ${collectionId}
    `;

    await recordAudit({
      collectionId,
      contributionId: id,
      action: 'contribution.delete',
      detail: removed || null,
      ip: getClientIp(c),
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting contribution:', error);
    return c.json({ error: 'Kunde inte ta bort bidraget' }, 500);
  }
});

async function verifyAdmin(contributionId, token) {
  const [row] = await sql`
    SELECT c.admin_token, c.id AS collection_id
    FROM collections c
    JOIN contributions con ON con.collection_id = c.id
    WHERE con.id = ${contributionId}
  `;
  if (!token || !row || !tokensMatch(token, row.admin_token)) return null;
  return row.collection_id;
}

export default app;

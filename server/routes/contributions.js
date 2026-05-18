import { Hono } from 'hono';
import sql from '../db.js';

const app = new Hono();

// POST /api/contributions
app.post('/contributions', async (c) => {
  try {
    const body = await c.req.json();
    const { collection_id, name, amount } = body;

    if (!collection_id || !name) {
      return c.json({ error: 'Insamlings-ID och namn krävs' }, 400);
    }

    const [collection] = await sql`
      SELECT id, is_active, expires_at, hard_cap_at, suggested_amount
      FROM collections
      WHERE id = ${collection_id}
    `;

    if (!collection) {
      return c.json({ error: 'Insamlingen hittades inte' }, 404);
    }
    if (!collection.is_active) {
      return c.json({ error: 'Insamlingen är stängd' }, 403);
    }
    if (new Date(collection.expires_at) < new Date()) {
      return c.json({ error: 'Insamlingen har gått ut' }, 403);
    }

    const generateRef = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const part = () =>
        Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      return `${part()}-${part()}`;
    };

    const reference_code = generateRef();

    const [contribution] = await sql`
      INSERT INTO contributions (collection_id, name, amount, reference_code, status)
      VALUES (
        ${collection_id},
        ${name},
        ${amount || collection.suggested_amount || null},
        ${reference_code},
        'unverified'
      ) RETURNING *
    `;

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
    console.error('Error creating contribution:', error);
    return c.json({ error: 'Kunde inte registrera betalningen' }, 500);
  }
});

// PATCH /api/contributions/:id
app.patch('/contributions/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

  try {
    const collectionId = await verifyAdmin(id, token);
    if (!collectionId) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    const body = await c.req.json();
    const { status, amount } = body;

    if (status === undefined && amount === undefined) {
      return c.json({ error: 'Inga fält att uppdatera' }, 400);
    }

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

    return c.json(updated);
  } catch (error) {
    console.error('Error updating contribution:', error);
    return c.json({ error: 'Kunde inte uppdatera bidraget' }, 500);
  }
});

// DELETE /api/contributions/:id
app.delete('/contributions/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

  try {
    const collectionId = await verifyAdmin(id, token);
    if (!collectionId) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    await sql`DELETE FROM contributions WHERE id = ${id}`;
    await sql`
      UPDATE collections SET last_admin_activity_at = NOW() WHERE id = ${collectionId}
    `;

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
  if (!token || row?.admin_token !== token) return null;
  return row.collection_id;
}

export default app;

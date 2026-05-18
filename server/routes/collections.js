import { Hono } from 'hono';
import sql from '../db.js';
import argon2 from 'argon2';

const app = new Hono();

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// POST /api/collections/recover — must be before /:id
app.post('/collections/recover', async (c) => {
  try {
    const body = await c.req.json();
    const { swish_number, pin } = body;

    if (!swish_number || !pin) {
      return c.json({ error: 'Swish-nummer och PIN-kod krävs' }, 400);
    }

    const collections = await sql`
      SELECT id, title, admin_token, pin_hash, expires_at, is_active
      FROM collections
      WHERE swish_number = ${swish_number}
        AND pin_hash IS NOT NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;

    if (!collections.length) {
      return c.json(
        { error: 'Ingen insamling hittades med detta Swish-nummer och PIN-kod' },
        404,
      );
    }

    for (const collection of collections) {
      const match = await argon2.verify(collection.pin_hash, pin.toString());
      if (match) {
        return c.json({
          id: collection.id,
          title: collection.title,
          admin_token: collection.admin_token,
        });
      }
    }

    return c.json({ error: 'Felaktigt Swish-nummer eller PIN-kod' }, 401);
  } catch (error) {
    console.error('Error recovering collection:', error);
    return c.json({ error: 'Återställning misslyckades' }, 500);
  }
});

// POST /api/collections
app.post('/collections', async (c) => {
  try {
    const body = await c.req.json();
    const { title, description, target_amount, swish_number, suggested_amount, require_proof, pin } = body;

    if (!title || !swish_number) {
      return c.json({ error: 'Titel och Swish-nummer krävs' }, 400);
    }

    const admin_token = generateUUID();

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
        ${description || null},
        ${target_amount ? Number(target_amount) : null},
        ${swish_number},
        ${suggested_amount ? Number(suggested_amount) : null},
        ${require_proof || false},
        ${admin_token},
        ${pin_hash},
        NOW() + INTERVAL '14 days',
        NOW() + INTERVAL '30 days',
        NOW()
      ) RETURNING *
    `;

    return c.json(collection);
  } catch (error) {
    console.error('Error creating collection:', error);
    return c.json({ error: 'Kunde inte skapa insamlingen' }, 500);
  }
});

// GET /api/collections/:id
app.get('/collections/:id', async (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

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

    if (token && adminRow?.admin_token === token) {
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
  const token = c.req.query('token');

  try {
    const [adminRow] = await sql`
      SELECT admin_token, expires_at, hard_cap_at FROM collections WHERE id = ${id}
    `;

    if (!token || adminRow?.admin_token !== token) {
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
        RETURNING *
      `;
      return c.json(updated);
    }

    if (is_active !== undefined) {
      const [updated] = await sql`
        UPDATE collections
        SET is_active = ${is_active}, last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING *
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

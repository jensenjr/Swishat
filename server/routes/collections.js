import { Hono } from 'hono';
import { randomUUID, randomInt } from 'node:crypto';
import sql from '../db.js';
import argon2 from 'argon2';
import { rateLimit, AttemptLimiter } from '../middleware/rateLimit.js';
import { getAdminToken, tokensMatch } from '../lib/auth.js';
import { getClientIp } from '../lib/clientIp.js';
import { recordAudit, getAuditLog } from '../lib/audit.js';
import { smsConfigured, sendSms, toE164Swedish } from '../lib/sms.js';
import { canSend, storeCode, verifyCode, recordSend } from '../lib/smsCodes.js';
import { saveImage, removeImage, extForType } from '../lib/storage.js';
import { getUpdates } from '../lib/updates.js';
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
  require_proof, is_active, expires_at, hard_cap_at, cover_image,
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
// SMS request is tightly limited — each call can send a (paid) SMS.
const smsRequestRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const smsVerifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

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

// POST /api/collections/recover/sms/request — send a one-time code by SMS.
// Proves control of the Swish phone number, so it recovers any collection on
// that number (even those created without a PIN). Must be before /:id.
app.post('/collections/recover/sms/request', smsRequestRateLimit, async (c) => {
  try {
    const { swish_number } = await c.req.json();
    if (!swish_number) {
      return c.json({ error: 'Swish-nummer krävs' }, 400);
    }
    if (!smsConfigured()) {
      return c.json({ error: 'SMS-återställning är inte aktiverad' }, 503);
    }

    const number = String(swish_number).trim();
    // Same response regardless of outcome so the endpoint can't be used to
    // enumerate numbers or probe whether a collection exists.
    const generic = { ok: true, message: 'Om numret finns har en kod skickats via SMS.' };

    if (!(await canSend(number))) return c.json(generic);

    const [collection] = await sql`
      SELECT id FROM collections
      WHERE swish_number = ${number} AND expires_at > NOW()
      LIMIT 1
    `;
    if (collection) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await sendSms(
          toE164Swedish(number),
          `Swishat återställningskod: ${code}. Gäller i 10 minuter. Dela aldrig koden med någon.`,
        );
        // Only persist once the SMS was accepted by the provider.
        await storeCode(number, code);
        await recordSend(number);
      } catch (err) {
        console.error('SMS send failed:', err.message);
      }
    }

    return c.json(generic);
  } catch (error) {
    console.error('SMS recovery request error:', error);
    return c.json({ error: 'Kunde inte skicka kod' }, 500);
  }
});

// POST /api/collections/recover/sms/verify — exchange a valid code for the
// admin link(s) of every active collection on that number. Must be before /:id.
app.post('/collections/recover/sms/verify', smsVerifyRateLimit, async (c) => {
  try {
    const { swish_number, code } = await c.req.json();
    if (!swish_number || !code) {
      return c.json({ error: 'Swish-nummer och kod krävs' }, 400);
    }

    const number = String(swish_number).trim();
    if (recoveryLockout.isLocked(number)) {
      return c.json(
        { error: 'För många misslyckade försök. Försök igen om en stund.' },
        429,
      );
    }

    const valid = await verifyCode(number, String(code).trim());
    if (!valid) {
      recoveryLockout.recordFailure(number);
      return c.json({ error: 'Felaktig eller utgången kod' }, 401);
    }

    recoveryLockout.clear(number);
    const collections = await sql`
      SELECT id, title, admin_token FROM collections
      WHERE swish_number = ${number} AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    return c.json({ collections });
  } catch (error) {
    console.error('SMS recovery verify error:', error);
    return c.json({ error: 'Verifiering misslyckades' }, 500);
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
             cover_image, last_admin_activity_at, last_contribution_at
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
      updates: await getUpdates(id),
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
      result.audit = await getAuditLog(id);
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
      await recordAudit({
        collectionId: id,
        action: 'collection.extend',
        detail: { expires_at: finalExpiry.toISOString() },
        ip: getClientIp(c),
      });
      return c.json(updated);
    }

    if (is_active !== undefined) {
      const [updated] = await sql`
        UPDATE collections
        SET is_active = ${is_active === true}, last_admin_activity_at = NOW()
        WHERE id = ${id}
        RETURNING ${PUBLIC_COLLECTION_COLUMNS}
      `;
      await recordAudit({
        collectionId: id,
        action: is_active === true ? 'collection.reopen' : 'collection.close',
        ip: getClientIp(c),
      });
      return c.json(updated);
    }

    return c.json({ error: 'Inga fält att uppdatera' }, 400);
  } catch (error) {
    console.error('Error updating collection:', error);
    return c.json({ error: 'Kunde inte uppdatera insamlingen' }, 500);
  }
});

// Magic-byte sniff so a renamed/disguised file can't pass the type check.
function looksLikeImage(buf, contentType) {
  if (buf.length < 12) return false;
  if (contentType === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (contentType === 'image/png')
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (contentType === 'image/webp')
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

// POST /api/collections/:id/cover — admin uploads a cover image (multipart).
app.post('/collections/:id/cover', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);
  try {
    const [adminRow] = await sql`
      SELECT admin_token, cover_image FROM collections WHERE id = ${id}
    `;
    if (!token || !adminRow || !tokensMatch(token, adminRow.admin_token)) {
      return c.json({ error: 'Obehörig' }, 401);
    }

    const body = await c.req.parseBody();
    const file = body['image'];
    if (!file || typeof file === 'string') {
      return c.json({ error: 'Ingen bild bifogad' }, 400);
    }
    const contentType = file.type;
    if (!extForType(contentType)) {
      return c.json({ error: 'Endast JPG, PNG eller WEBP tillåts' }, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) return c.json({ error: 'Tom fil' }, 400);
    if (buffer.length > 3 * 1024 * 1024) {
      return c.json({ error: 'Bilden är för stor (max 3 MB)' }, 400);
    }
    if (!looksLikeImage(buffer, contentType)) {
      return c.json({ error: 'Filen verkar inte vara en giltig bild' }, 400);
    }

    const url = await saveImage(buffer, { contentType });
    const [updated] = await sql`
      UPDATE collections SET cover_image = ${url}, last_admin_activity_at = NOW()
      WHERE id = ${id} RETURNING cover_image
    `;
    if (adminRow.cover_image && adminRow.cover_image !== url) {
      removeImage(adminRow.cover_image).catch(() => {});
    }
    await recordAudit({ collectionId: id, action: 'collection.cover_update', ip: getClientIp(c) });
    return c.json({ cover_image: updated.cover_image });
  } catch (error) {
    console.error('Cover upload error:', error);
    return c.json({ error: 'Kunde inte ladda upp bilden' }, 500);
  }
});

// DELETE /api/collections/:id/cover — admin removes the cover image.
app.delete('/collections/:id/cover', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);
  try {
    const [adminRow] = await sql`
      SELECT admin_token, cover_image FROM collections WHERE id = ${id}
    `;
    if (!token || !adminRow || !tokensMatch(token, adminRow.admin_token)) {
      return c.json({ error: 'Obehörig' }, 401);
    }
    if (adminRow.cover_image) removeImage(adminRow.cover_image).catch(() => {});
    await sql`
      UPDATE collections SET cover_image = NULL, last_admin_activity_at = NOW() WHERE id = ${id}
    `;
    await recordAudit({ collectionId: id, action: 'collection.cover_remove', ip: getClientIp(c) });
    return c.json({ success: true });
  } catch (error) {
    console.error('Cover delete error:', error);
    return c.json({ error: 'Kunde inte ta bort bilden' }, 500);
  }
});

// POST /api/collections/:id/updates — admin publishes a campaign update.
app.post('/collections/:id/updates', async (c) => {
  const id = c.req.param('id');
  const token = getAdminToken(c);
  try {
    const [coll] = await sql`SELECT admin_token FROM collections WHERE id = ${id}`;
    if (!token || !coll || !tokensMatch(token, coll.admin_token)) {
      return c.json({ error: 'Obehörig' }, 401);
    }
    const reqBody = await c.req.json();
    const title = optionalText(reqBody.title, 'Rubrik', LIMITS.updateTitle);
    const body = requireText(reqBody.body, 'Text', LIMITS.updateBody);

    const [update] = await sql`
      INSERT INTO campaign_updates (collection_id, title, body)
      VALUES (${id}, ${title}, ${body})
      RETURNING id, title, body, created_at
    `;
    await sql`UPDATE collections SET last_admin_activity_at = NOW() WHERE id = ${id}`;
    await recordAudit({ collectionId: id, action: 'update.create', ip: getClientIp(c) });
    return c.json(update);
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    console.error('Create update error:', error);
    return c.json({ error: 'Kunde inte publicera uppdateringen' }, 500);
  }
});

// DELETE /api/collections/:id/updates/:updateId — admin removes an update.
app.delete('/collections/:id/updates/:updateId', async (c) => {
  const id = c.req.param('id');
  const updateId = c.req.param('updateId');
  const token = getAdminToken(c);
  try {
    const [coll] = await sql`SELECT admin_token FROM collections WHERE id = ${id}`;
    if (!token || !coll || !tokensMatch(token, coll.admin_token)) {
      return c.json({ error: 'Obehörig' }, 401);
    }
    await sql`
      DELETE FROM campaign_updates WHERE id = ${updateId} AND collection_id = ${id}
    `;
    await recordAudit({ collectionId: id, action: 'update.delete', ip: getClientIp(c) });
    return c.json({ success: true });
  } catch (error) {
    console.error('Delete update error:', error);
    return c.json({ error: 'Kunde inte ta bort uppdateringen' }, 500);
  }
});

export default app;

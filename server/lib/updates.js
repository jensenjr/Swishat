// Campaign updates — short news posts an organizer publishes on a campaign,
// shown on the public page so contributors have a reason to come back.
// DB-backed; table bootstrapped on startup (CREATE TABLE IF NOT EXISTS).

import sql from '../db.js';

let enabled = true;

export async function ensureUpdatesSchema() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS campaign_updates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS campaign_updates_collection_idx
      ON campaign_updates (collection_id, created_at DESC)
    `;
    enabled = true;
  } catch (err) {
    enabled = false;
    console.error('Campaign updates unavailable:', err.message);
  }
}

export async function getUpdates(collectionId, limit = 50) {
  if (!enabled) return [];
  try {
    return await sql`
      SELECT id, title, body, created_at
      FROM campaign_updates
      WHERE collection_id = ${collectionId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } catch (err) {
    console.error('Failed to read updates:', err.message);
    return [];
  }
}

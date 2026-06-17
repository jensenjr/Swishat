// Append-only audit log of admin actions that change recorded money state
// (verifying, editing, deleting, manually adding contributions; closing,
// reopening, extending a collection).
//
// Design notes:
// - The table is bootstrapped on startup with CREATE TABLE IF NOT EXISTS, so a
//   deploy needs no manual migration step.
// - collection_id / contribution_id are plain UUIDs (no foreign keys): the log
//   must survive deletion of the row it describes — auditing a delete is the
//   whole point — and the bootstrap stays independent of table creation order.
// - Audit is supplementary: if the table is unavailable, the app keeps working
//   and writes/reads degrade to no-ops rather than failing the user's action.

import sql from '../db.js';

let auditEnabled = true;

export async function ensureAuditSchema() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID,
        contribution_id UUID,
        action TEXT NOT NULL,
        detail JSONB,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS audit_log_collection_idx
      ON audit_log (collection_id, created_at DESC)
    `;
    auditEnabled = true;
  } catch (err) {
    auditEnabled = false;
    console.error('Audit log unavailable (continuing without it):', err.message);
  }
}

export async function recordAudit({
  collectionId,
  contributionId = null,
  action,
  detail = null,
  ip = null,
}) {
  if (!auditEnabled) return;
  try {
    await sql`
      INSERT INTO audit_log (collection_id, contribution_id, action, detail, ip)
      VALUES (${collectionId}, ${contributionId}, ${action}, ${detail}, ${ip})
    `;
  } catch (err) {
    console.error('Failed to write audit entry:', err.message);
  }
}

export async function getAuditLog(collectionId, limit = 100) {
  if (!auditEnabled) return [];
  try {
    return await sql`
      SELECT action, contribution_id, detail, created_at
      FROM audit_log
      WHERE collection_id = ${collectionId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } catch (err) {
    console.error('Failed to read audit log:', err.message);
    return [];
  }
}

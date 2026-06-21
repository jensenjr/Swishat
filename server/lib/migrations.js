// Idempotent schema migrations run at startup, alongside the table bootstraps.
// Safe to run on every boot; each statement is a no-op once applied.

import sql from '../db.js';

export async function ensureSchemaMigrations() {
  try {
    await sql`ALTER TABLE collections ADD COLUMN IF NOT EXISTS cover_image TEXT`;
  } catch (err) {
    console.error('Schema migration failed:', err.message);
  }
}

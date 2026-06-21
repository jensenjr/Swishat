import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import collectionsRouter from './routes/collections.js';
import contributionsRouter from './routes/contributions.js';
import { ensureAuditSchema } from './lib/audit.js';
import { ensureSmsSchema } from './lib/smsCodes.js';
import { ensureSchemaMigrations } from './lib/migrations.js';
import sql from './db.js';
import { buildOgTags, escapeHtml } from './lib/ogMeta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Idempotent schema bootstrap (CREATE TABLE IF NOT EXISTS / ALTER ... IF NOT
// EXISTS). Non-fatal — if it fails the app still serves; audit logging degrades
// to a no-op and SMS recovery returns an error until the table is available.
await ensureAuditSchema();
await ensureSmsSchema();
await ensureSchemaMigrations();

const app = new Hono();

// When serving cover images from an S3-compatible store, allow that origin in
// the CSP so on-page <img> tags can load (local uploads are same-origin).
let s3ImgOrigin = null;
if (process.env.STORAGE_DRIVER === 's3' && process.env.S3_PUBLIC_BASE_URL) {
  try {
    s3ImgOrigin = new URL(process.env.S3_PUBLIC_BASE_URL).origin;
  } catch {
    /* ignore malformed URL */
  }
}

// Security headers on every response. The CSP allows the app's own bundle plus
// the Google Fonts it loads; inline styles are permitted because React/Tailwind
// emit style attributes. frame-ancestors 'none' blocks clickjacking of the
// admin panel; no-referrer keeps the admin token (currently in the URL) out of
// the Referer header on outbound navigations.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', ...(s3ImgOrigin ? [s3ImgOrigin] : [])],
      connectSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
  }),
);

// Reject oversized request bodies. JSON endpoints are capped tightly; the cover
// upload endpoint gets a larger limit for the image payload.
const jsonLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'Förfrågan är för stor' }, 413),
});
const uploadLimit = bodyLimit({
  maxSize: 4 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Bilden är för stor (max 3 MB)' }, 413),
});
app.use('/api/*', (c, next) => {
  const isUpload = c.req.method === 'POST' && /\/cover$/.test(c.req.path);
  return (isUpload ? uploadLimit : jsonLimit)(c, next);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

// Serve locally-stored cover images (no-op when STORAGE_DRIVER=s3, which serves
// images from the object store directly).
const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
app.get('/uploads/*', async (c) => {
  const rel = decodeURIComponent(c.req.path.replace(/^\/uploads\//, ''));
  if (rel.includes('..') || rel.startsWith('/')) return c.notFound();
  try {
    const buf = await readFile(join(UPLOAD_DIR, rel));
    const ext = rel.split('.').pop().toLowerCase();
    c.header('Content-Type', IMG_MIME[ext] || 'application/octet-stream');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(buf);
  } catch {
    return c.notFound();
  }
});

app.route('/api', collectionsRouter);
app.route('/api', contributionsRouter);

if (process.env.NODE_ENV === 'production') {
  const indexHtml = readFileSync(join(__dirname, '../dist/index.html'), 'utf-8');

  app.use('/*', serveStatic({ root: './dist' }));

  app.get('/*', async (c) => {
    // Public campaign page → inject per-campaign OpenGraph tags so shared links
    // render a rich card. Crawlers don't run the SPA's JS, so this is server-side.
    // Matches /c/:id but not /c/:id/admin.
    const match = c.req.path.match(/^\/c\/([^/]+)\/?$/);
    if (match) {
      try {
        const [col] = await sql`
          SELECT title, description, target_amount, cover_image
          FROM collections WHERE id = ${match[1]}
        `;
        if (col) {
          const [stats] = await sql`
            SELECT COUNT(*) AS count,
                   COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0) AS collected
            FROM contributions WHERE collection_id = ${match[1]}
          `;
          // Canonical URL from forwarded headers (TLS terminates at the proxy,
          // so c.req.url would otherwise report http://).
          const proto = c.req.header('x-forwarded-proto') || 'https';
          const host = c.req.header('x-forwarded-host') || c.req.header('host');
          const origin = host ? `${proto}://${host}` : '';
          const url = `${origin}${c.req.path}`;
          // og:image must be absolute; local covers are stored as /uploads/...
          const image = col.cover_image
            ? col.cover_image.startsWith('/')
              ? `${origin}${col.cover_image}`
              : col.cover_image
            : null;

          const tags = buildOgTags({
            title: col.title,
            description: col.description,
            collected: stats.collected,
            target: col.target_amount,
            count: stats.count,
            url,
            image,
          });
          const html = indexHtml
            .replace(
              '<title>Swish Insamling</title>',
              `<title>${escapeHtml(col.title)} · Swish Insamling</title>`,
            )
            .replace('</head>', `    ${tags}\n  </head>`);
          return c.html(html);
        }
      } catch (err) {
        console.error('OG injection failed:', err.message);
      }
    }
    return c.html(indexHtml);
  });
}

const port = parseInt(process.env.PORT || '5000');
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});

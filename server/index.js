import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import collectionsRouter from './routes/collections.js';
import contributionsRouter from './routes/contributions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();

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
      imgSrc: ["'self'", 'data:'],
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

// Reject oversized request bodies before they reach the route handlers.
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: 'Förfrågan är för stor' }, 413),
  }),
);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api', collectionsRouter);
app.route('/api', contributionsRouter);

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('/*', (c) => {
    const html = readFileSync(join(__dirname, '../dist/index.html'), 'utf-8');
    return c.html(html);
  });
}

const port = parseInt(process.env.PORT || '5000');
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on port ${port}`);
});

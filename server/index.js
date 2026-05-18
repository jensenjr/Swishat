import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import collectionsRouter from './routes/collections.js';
import contributionsRouter from './routes/contributions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono();

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

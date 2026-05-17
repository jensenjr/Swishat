import { build } from 'esbuild';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, 'src');
const apiDir = join(srcDir, 'app/api');
const outBaseDir = join(__dirname, 'build/server/src/app/api');

const aliasPlugin = {
  name: 'path-alias',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => ({
      path: join(srcDir, args.path.slice(2)),
    }));
  },
};

async function findRouteFiles(dir) {
  const entries = await readdir(dir);
  const results = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) results.push(...(await findRouteFiles(full)));
    else if (entry === 'route.js') results.push(full);
  }
  return results;
}

const routeFiles = await findRouteFiles(apiDir);

for (const routeFile of routeFiles) {
  const rel = routeFile.slice(apiDir.length);
  const outFile = join(outBaseDir, rel);
  await mkdir(dirname(outFile), { recursive: true });
  await build({
    entryPoints: [routeFile],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: outFile,
    plugins: [aliasPlugin],
    external: ['argon2', '@neondatabase/serverless', 'hono', 'ws'],
  });
  console.log(`compiled: ${outFile}`);
}

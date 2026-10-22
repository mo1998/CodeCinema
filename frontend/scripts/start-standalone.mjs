/**
 * Run the production build from Next.js's standalone output.
 *
 * `output: 'standalone'` emits a self-contained server in `.next/standalone`,
 * but it deliberately excludes `.next/static` and `public/` — the Docker
 * image copies them in separately. This script does the same thing for local
 * production runs and for the E2E suite, so the thing you test is the thing
 * that ships.
 */
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error('[start-standalone] no standalone build found. Run `npm run build` first.');
  process.exit(1);
}

await mkdir(join(standalone, '.next'), { recursive: true });
await cp(join(root, '.next', 'static'), join(standalone, '.next', 'static'), {
  recursive: true,
});
if (existsSync(join(root, 'public'))) {
  await cp(join(root, 'public'), join(standalone, 'public'), { recursive: true });
}

const child = spawn(process.execPath, [join(standalone, 'server.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '3000',
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
  },
});

const forward = (signal) => () => child.kill(signal);
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));

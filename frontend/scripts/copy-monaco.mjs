/**
 * Copies the Monaco Editor distribution into `public/monaco/vs` so that the
 * editor (and its language workers) are served from our own origin instead of
 * a CDN.
 *
 * Why this matters for CodeCinema specifically: the video export renderer runs
 * a headless browser inside a container with restricted egress. A CDN-hosted
 * Monaco would make every export fail with a blank editor.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const target = join(root, 'public', 'monaco', 'vs');

if (!existsSync(source)) {
  console.warn('[copy-monaco] monaco-editor is not installed yet; skipping.');
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`[copy-monaco] copied Monaco to ${target}`);

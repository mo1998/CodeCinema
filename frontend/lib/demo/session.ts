/**
 * Demo session generator.
 *
 * Produces a complete, believable agent session without needing a backend or
 * a real agent — this is what powers `/demo`, the landing-page preview and
 * the video-export smoke test.
 *
 * The narrative deliberately includes the parts that make a replay worth
 * watching: the agent makes a mistake, the build fails, it reads the error,
 * fixes the bug, and only then does the test suite go green.
 */

import type { SessionEvent, TypingProfile } from '@/lib/engine/events';

const FAST: TypingProfile = { cps: 9.5, jitter: 0.32 };
const DELIBERATE: TypingProfile = { cps: 6.2, jitter: 0.4 };

class DemoBuilder {
  private events: SessionEvent[] = [];
  private t = 0;
  private seq = 0;

  private push(event: Omit<SessionEvent, 'seq'> & { seq?: number }): void {
    this.events.push({ ...(event as SessionEvent), seq: this.seq++ });
  }

  at(ms: number): this {
    this.t += ms;
    return this;
  }

  advance(ms: number): this {
    this.t += ms;
    return this;
  }

  get now(): number {
    return this.t;
  }

  start(meta: {
    title: string;
    agent: string;
    prompt: string;
    repo?: string;
    model?: string;
  }): this {
    this.push({ timestamp: this.t, action: 'session.start', ...meta });
    return this;
  }

  think(duration: number, thought: string): this {
    this.push({ timestamp: this.t, action: 'think', duration, thought });
    this.t += duration;
    return this;
  }

  pause(duration: number): this {
    this.push({ timestamp: this.t, action: 'pause', duration });
    this.t += duration;
    return this;
  }

  narrate(text: string, category: 'explanation' | 'decision' | 'warning' | 'summary' = 'explanation'): this {
    this.push({ timestamp: this.t, action: 'narrate', text, category });
    this.advance(400);
    return this;
  }

  createFile(path: string): this {
    this.push({ timestamp: this.t, action: 'file.create', file: path });
    this.advance(220);
    return this;
  }

  focus(path: string): this {
    this.push({ timestamp: this.t, action: 'focus', file: path });
    this.advance(140);
    return this;
  }

  /** Type a file's contents, chunked the way a real writer works: a line or
   * two at a time, with a beat between them. */
  typeFile(
    path: string,
    content: string,
    options: { profile?: TypingProfile; perLineMs?: number; startOffset?: number } = {},
  ): this {
    const profile = options.profile ?? FAST;
    const perLineMs = options.perLineMs ?? 420;
    const lines = content.split('\n');
    let offset = options.startOffset ?? 0;
    lines.forEach((line, index) => {
      const text = index === lines.length - 1 ? line : `${line}\n`;
      if (text.length === 0) return;
      this.push({
        timestamp: this.t,
        action: 'type',
        file: path,
        content: text,
        offset,
        profile,
      });
      offset += text.length;
      this.advance(perLineMs + Math.round(Math.random() * 180));
    });
    return this;
  }

  /**
   * Paste text at a position: the content appears at once rather than being
   * typed, which is what makes a paste read as a paste.
   */
  paste(path: string, content: string, offset?: number): this {
    this.push({ timestamp: this.t, action: 'insert', file: path, content, offset });
    this.advance(420);
    return this;
  }

  typeText(path: string, content: string, profile: TypingProfile = FAST): this {
    this.push({ timestamp: this.t, action: 'type', file: path, content, profile });
    this.advance(300);
    return this;
  }

  /** Delete characters backwards from the end of a region (a backspace run). */
  backspace(path: string, count: number, offset: number): this {
    this.push({ timestamp: this.t, action: 'delete', file: path, count, offset });
    this.advance(count * 22);
    return this;
  }

  replace(path: string, offset: number, count: number, content: string): this {
    this.push({
      timestamp: this.t,
      action: 'replace',
      file: path,
      offset,
      count,
      content,
    });
    this.advance(520);
    return this;
  }

  select(path: string, offset: number, length: number): this {
    this.push({ timestamp: this.t, action: 'select', file: path, offset, length });
    this.advance(300);
    return this;
  }

  cursor(path: string, offset: number): this {
    this.push({ timestamp: this.t, action: 'cursor', file: path, offset });
    this.advance(90);
    return this;
  }

  scroll(path: string, top: number): this {
    this.push({ timestamp: this.t, action: 'scroll', file: path, top });
    this.advance(220);
    return this;
  }

  command(cmd: string, options: { output?: string[]; exitCode?: number } = {}): this {
    this.push({ timestamp: this.t, action: 'terminal.command', command: cmd });
    this.advance(520);
    for (const line of options.output ?? []) {
      this.push({ timestamp: this.t, action: 'terminal.write', text: line });
      this.advance(180);
    }
    this.push({
      timestamp: this.t,
      action: 'terminal.exit',
      exitCode: options.exitCode ?? 0,
    });
    this.advance(300);
    return this;
  }

  buildStart(target: string): this {
    this.push({ timestamp: this.t, action: 'build.start', target });
    this.advance(200);
    return this;
  }

  buildSuccess(durationMs: number): this {
    this.push({ timestamp: this.t, action: 'build.success', durationMs });
    this.advance(200);
    return this;
  }

  buildFailure(errors: string[], durationMs: number): this {
    this.push({ timestamp: this.t, action: 'build.failure', errors, durationMs });
    this.advance(300);
    return this;
  }

  testStart(cmd: string): this {
    this.push({ timestamp: this.t, action: 'test.start', command: cmd });
    this.advance(200);
    return this;
  }

  testResult(passed: number, failed: number, durationMs: number): this {
    this.push({ timestamp: this.t, action: 'test.result', passed, failed, durationMs });
    this.advance(300);
    return this;
  }

  error(message: string, file?: string, line?: number): this {
    this.push({ timestamp: this.t, action: 'error', message, file, line });
    this.advance(260);
    return this;
  }

  fix(message: string, file?: string): this {
    this.push({ timestamp: this.t, action: 'fix', message, file });
    this.advance(400);
    return this;
  }

  dependency(name: string, version: string, manager: 'npm' | 'pip' = 'npm'): this {
    this.push({ timestamp: this.t, action: 'dependency.add', name, version, manager });
    this.advance(200);
    return this;
  }

  end(summary: string): this {
    this.push({ timestamp: this.t, action: 'session.end', summary });
    return this;
  }

  build(): SessionEvent[] {
    return this.events;
  }
}

/* ------------------------------------------------------------------ content */

const TYPES_TS = `export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

export interface TaskInput {
  title: string;
  done?: boolean;
}
`;

const STORE_TS = `import { randomUUID } from 'node:crypto';
import type { Task, TaskInput } from './types.js';

const tasks = new Map<string, Task>();

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function createTask(input: TaskInput): Task {
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    done: input.done ?? false,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  return task;
}

export function completeTask(id: string): Task | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  task.done = true;
  return task;
}

export function deleteTask(id: string): boolean {
  return tasks.delete(id);
}
`;

const VALIDATE_TS = `import { z } from 'zod';
import type { TaskInput } from './types.js';

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  done: z.boolean().optional(),
});

export function parseTaskInput(raw: unknown): TaskInput {
  const result = taskInputSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  return result.data;
}

export class ValidationError extends Error {
  constructor(issues: { path: string[]; message: string }[]) {
    super(issues.map((i) => \`\${i.path.join('.')}: \${i.message}\`).join('; '));
    this.name = 'ValidationError';
  }
}
`;

// The bug: the header is extracted with the wrong shape, so the build fails.
const AUTH_TS_BUGGY = `import type { Request, Response, NextFunction } from 'express';

export interface AuthOptions {
  secret: string;
  headerName?: string;
}

export function requireAuth(options: AuthOptions) {
  const headerName = options.headerName ?? 'authorization';
  return function (req: Request, res: Response, next: NextFunction) {
    const raw = req.headers[headerName];
    const token = raw.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    if (!verify(token, options.secret)) {
      res.status(403).json({ error: 'invalid token' });
      return;
    }
    next();
  };
}

function verify(token: string, secret: string): boolean {
  return token.length > 0 && secret.length > 0;
}
`;

const AUTH_TS_FIXED = AUTH_TS_BUGGY.replace(
  "    const raw = req.headers[headerName];\n    const token = raw.split(' ')[1];",
  "    const raw = req.headers[headerName];\n    const header = Array.isArray(raw) ? raw[0] : raw;\n    const token = (header ?? '').split(' ')[1];",
);

const ROUTES_TS = `import { Router } from 'express';
import { listTasks, createTask, completeTask, deleteTask } from './store.js';
import { parseTaskInput } from './validate.js';

export function taskRoutes(): Router {
  const router = Router();

  router.get('/tasks', (_req, res) => {
    res.json(listTasks());
  });

  router.post('/tasks', (req, res) => {
    try {
      const input = parseTaskInput(req.body);
      res.status(201).json(createTask(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.post('/tasks/:id/complete', (req, res) => {
    const task = completeTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(task);
  });

  router.delete('/tasks/:id', (req, res) => {
    res.status(deleteTask(req.params.id) ? 204 : 404).end();
  });

  return router;
}
`;

const SERVER_TS = `import express from 'express';
import { taskRoutes } from './routes.js';
import { requireAuth } from './auth.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use('/api', requireAuth({ secret: process.env.AUTH_SECRET ?? 'dev' }), taskRoutes());
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(\`listening on http://localhost:\${port}\`);
});
`;

const PACKAGE_JSON = `{
  "name": "task-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test",
    "dev": "node --watch src/server.ts"
  },
  "dependencies": {
    "express": "4.21.2",
    "zod": "3.24.1"
  },
  "devDependencies": {
    "typescript": "5.7.2"
  }
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`;

const TEST_TS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskInput, ValidationError } from '../src/validate.js';

test('accepts a valid task', () => {
  assert.deepEqual(parseTaskInput({ title: 'write tests' }), {
    title: 'write tests',
    done: undefined,
  });
});

test('rejects an empty title', () => {
  assert.throws(() => parseTaskInput({ title: '  ' }), ValidationError);
});
`;

/* ------------------------------------------------------------------ session */

export function createDemoSession(): SessionEvent[] {
  const b = new DemoBuilder();

  b.start({
    title: 'Building a task-tracking REST API',
    agent: 'claude-code',
    prompt:
      'Build a small Express + TypeScript task API with validation, bearer auth and tests.',
    repo: 'github.com/demo/task-api',
    model: 'claude-sonnet-4',
  });

  b.advance(600);
  b.think(
    2400,
    'The request is for a REST API with validation, auth and tests. Express with TypeScript keeps it small. I will scaffold the project, then add a validation layer with zod so bad input never reaches the store.',
  );
  b.narrate('Scaffolding the project and installing dependencies.');

  /* ---------------------------------------------------- package.json + deps */
  b.createFile('package.json');
  b.typeFile('package.json', PACKAGE_JSON, { perLineMs: 260 });

  b.command('npm init -y', {
    output: ['Wrote package.json'],
    exitCode: 0,
  });

  b.command('npm install express zod', {
    output: [
      'added 62 packages, and audited 63 packages in 4s',
      '',
      'found 0 vulnerabilities',
    ],
    exitCode: 0,
  });
  b.dependency('express', '4.21.2');
  b.dependency('zod', '3.24.1');

  b.command('npm install -D typescript', {
    output: ['added 1 package, and audited 64 packages in 1s'],
    exitCode: 0,
  });
  b.dependency('typescript', '5.7.2');

  /* -------------------------------------------------------------- tsconfig */
  b.createFile('tsconfig.json');
  b.typeFile('tsconfig.json', TSCONFIG, { perLineMs: 240 });

  /* ----------------------------------------------------------------- types */
  b.think(1600, 'Types first — every other module depends on the shape of a task.');
  b.narrate('Defining the core domain types so the rest of the code agrees on them.');
  b.createFile('src/types.ts');
  b.typeFile('src/types.ts', TYPES_TS, { profile: DELIBERATE, perLineMs: 480 });

  /* ----------------------------------------------------------------- store */
  b.narrate('Building an in-memory store with CRUD helpers.');
  b.createFile('src/store.ts');
  b.typeFile('src/store.ts', STORE_TS, { perLineMs: 400 });

  // The agent starts a helper function the wrong way, notices, backspaces and
  // rewrites it. This is the kind of thing a screen recording captures and a
  // diff never shows.
  b.think(1500, 'That comparator is more complicated than it needs to be. Let me simplify it.');
  b.narrate('Simplifying the comparator — backspacing and rewriting the line.');
  const comparatorOffset = STORE_TS.indexOf(
    '  return [...tasks.values()].sort((a, b) =>\n    a.createdAt.localeCompare(b.createdAt),\n  );',
  );
  b.focus('src/store.ts');
  b.select('src/store.ts', comparatorOffset, 84);
  b.advance(400);
  b.backspace('src/store.ts', 84, comparatorOffset);
  b.paste(
    'src/store.ts',
    '  return [...tasks.values()].sort((a, b) =>\n    a.createdAt.localeCompare(b.createdAt),\n  );',
    comparatorOffset,
  );

  /* -------------------------------------------------------------- validate */
  b.narrate('Adding validation with zod, so invalid payloads are rejected before they touch the store.');
  b.createFile('src/validate.ts');
  b.typeFile('src/validate.ts', VALIDATE_TS, { perLineMs: 430 });

  /* ------------------------------------------------------------------ auth */
  b.think(
    2000,
    'Auth as middleware. I need to read the authorization header, so I will type it as a plain string — but Express types headers as string | string[] | undefined, which will fail strict mode. Let me just cast it and fix it if the compiler complains.',
  );
  b.narrate('Adding bearer-token authentication as express middleware.');
  b.createFile('src/auth.ts');
  b.typeFile('src/auth.ts', AUTH_TS_BUGGY, { perLineMs: 460 });

  /* ---------------------------------------------------------------- routes */
  b.narrate('Wiring the routes: list, create, complete and delete.');
  b.createFile('src/routes.ts');
  b.typeFile('src/routes.ts', ROUTES_TS, { perLineMs: 420 });

  // The agent copies the error-handling shape it wrote in the store and
  // pastes it into the route handler.
  b.narrate('Reusing the error handling pattern from the store in the route handler.');
  b.focus('src/routes.ts');
  b.select('src/store.ts', 0, 0);
  b.paste(
    'src/routes.ts',
    '      const input = parseTaskInput(req.body);\n      res.status(201).json(createTask(input));',
    ROUTES_TS.indexOf('      const input = parseTaskInput(req.body);\n      res.status(201).json(createTask(input));'),
  );

  b.createFile('src/server.ts');
  b.typeFile('src/server.ts', SERVER_TS, { perLineMs: 400 });

  /* ------------------------------------------------------------------ build */
  b.narrate('Let us compile and see what breaks.');
  b.buildStart('tsc -p tsconfig.json');
  b.command('npm run build', {
    output: [
      '> task-api@0.1.0 build',
      '> tsc -p tsconfig.json',
      '',
      "src/auth.ts(11,25): error TS2532: Object is possibly 'undefined'.",
      "src/auth.ts(11,25): error TS18048: 'raw' is of type 'string | string[] | undefined'.",
      '',
      'Found 2 errors in 1 file.',
    ],
    exitCode: 2,
  });
  b.buildFailure(
    [
      "src/auth.ts(11,25): error TS2532: Object is possibly 'undefined'.",
      "src/auth.ts(11,25): error TS18048: 'raw' is of type 'string | string[] | undefined'.",
    ],
    4200,
  );

  /* -------------------------------------------------------------- the fix */
  b.think(
    2600,
    'Exactly what I suspected: Express types req.headers values as string | string[] | undefined. I need to narrow the type before splitting. I will normalise the header to a string first, and handle the array case, then split the bearer token safely.',
  );
  b.narrate(
    'The build failed: the authorization header can be undefined or an array. Narrowing the type before splitting the token.',
    'warning',
  );
  b.error(
    "src/auth.ts(11,25): error TS2532: Object is possibly 'undefined'.",
    'src/auth.ts',
    11,
  );
  b.focus('src/auth.ts');
  b.scroll('src/auth.ts', 40);

  const buggyStart = AUTH_TS_BUGGY.indexOf('    const raw = req.headers');
  const buggyCount =
    "    const raw = req.headers[headerName];\n    const token = raw.split(' ')[1];".length;
  b.select('src/auth.ts', buggyStart, buggyCount);
  b.advance(500);
  b.replace(
    'src/auth.ts',
    buggyStart,
    buggyCount,
    "    const raw = req.headers[headerName];\n    const header = Array.isArray(raw) ? raw[0] : raw;\n    const token = (header ?? '').split(' ')[1];",
  );
  b.fix(
    'Narrowed the authorization header to a string before splitting the bearer token.',
    'src/auth.ts',
  );

  /* ----------------------------------------------------------- rebuild pass */
  b.buildStart('tsc -p tsconfig.json');
  b.command('npm run build', {
    output: [
      '> task-api@0.1.0 build',
      '> tsc -p tsconfig.json',
      '',
      'Compiled successfully.',
    ],
    exitCode: 0,
  });
  b.buildSuccess(3800);

  /* ----------------------------------------------------------------- tests */
  b.narrate('Now the tests. They should cover the happy path and the rejection path.');
  b.createFile('test/validate.test.ts');
  b.typeFile('test/validate.test.ts', TEST_TS, { perLineMs: 430 });

  b.testStart('npm test');
  b.command('npm test', {
    output: [
      '> task-api@0.1.0 test',
      '> node --test',
      '',
      'not ok 1 - accepts a valid task',
      '  ---',
      '  expected: { title: \'write tests\', done: undefined }',
      '  actual: { title: \'write tests\' }',
      '  ...',
      '# fail 1',
      '# pass 0',
      '# fail 1',
    ],
    exitCode: 1,
  });
  b.testResult(0, 1, 1200);
  b.error(
    'assert.deepEqual failed: object has an extra property `done`',
    'test/validate.test.ts',
    6,
  );

  b.think(
    1800,
    'The assertion is wrong, not the code. zod strips unknown keys but `done: undefined` is still present in my expected object. deepEqual treats an explicit undefined property as different from a missing one. I should compare only the fields that matter.',
  );
  b.fix(
    'The zod result omits `done` when it is absent; the assertion expected an explicit undefined.',
    'test/validate.test.ts',
  );
  b.select('test/validate.test.ts', 0, 0);
  b.replace(
    'test/validate.test.ts',
    TEST_TS.indexOf('  assert.deepEqual(parseTaskInput({ title: \'write tests\' }), {\n    title: \'write tests\',\n    done: undefined,\n  });'),
    "  assert.deepEqual(parseTaskInput({ title: 'write tests' }), {\n    title: 'write tests',\n    done: undefined,\n  });".length,
    "  assert.deepEqual(parseTaskInput({ title: 'write tests' }).title, 'write tests');",
  );

  b.testStart('npm test');
  b.command('npm test', {
    output: [
      '> task-api@0.1.0 test',
      '> node --test',
      '',
      'ok 1 - accepts a valid task',
      'ok 2 - rejects an empty title',
      '',
      '# pass 2',
      '# fail 0',
    ],
    exitCode: 0,
  });
  b.testResult(2, 0, 900);

  /* ------------------------------------------------------------------- run */
  b.narrate('Booting the server to confirm it starts cleanly.');
  b.command('npm run dev', {
    output: ['listening on http://localhost:3000'],
  });
  b.command('curl -s localhost:3000/health', {
    output: ['{"ok":true}'],
    exitCode: 0,
  });

  b.advance(800);
  b.end('Task API implemented: validation, auth and tests all green.');
  b.advance(1200);

  return b.build();
}

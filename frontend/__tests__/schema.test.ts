import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_ACTIONS } from '@/lib/engine/events';

const SCHEMA_PATH = join(
  process.cwd(),
  '..',
  'shared',
  'schemas',
  'event.schema.json',
);

interface EventSchema {
  properties: {
    action: { enum: string[] };
  };
  allOf: {
    if: { properties: { action: { enum?: string[]; const?: string } } };
    then: { required?: string[] };
  }[];
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as EventSchema;

/**
 * The schema is the contract. If the TypeScript projection and the JSON
 * Schema disagree, one of them is wrong — and CI should say which.
 */
describe('event schema contract', () => {
  it('the TypeScript action list matches the JSON Schema enum exactly', () => {
    const fromSchema = [...schema.properties.action.enum].sort();
    const fromTypeScript = [...EVENT_ACTIONS].sort();
    expect(fromTypeScript).toEqual(fromSchema);
  });

  it('every action-specific requirement is satisfiable', () => {
    for (const branch of schema.allOf) {
      const actions = branch.if.properties.action.enum ?? [
        branch.if.properties.action.const as string,
      ];
      for (const action of actions) {
        expect(EVENT_ACTIONS).toContain(action);
      }
    }
  });
});

describe('shared fixture', () => {
  const fixture = JSON.parse(
    readFileSync(
      join(process.cwd(), '..', 'shared', 'fixtures', 'sample-session.json'),
      'utf8',
    ),
  ) as Record<string, unknown>[];

  it('contains only known actions', () => {
    for (const event of fixture) {
      expect(EVENT_ACTIONS).toContain(event.action as never);
    }
  });

  it('has non-decreasing timestamps', () => {
    let previous = -1;
    for (const event of fixture) {
      expect(event.timestamp as number).toBeGreaterThanOrEqual(previous);
      previous = event.timestamp as number;
    }
  });

  it('satisfies the required fields of its action', () => {
    for (const event of fixture) {
      for (const branch of schema.allOf) {
        const actions = branch.if.properties.action.enum ?? [
          branch.if.properties.action.const as string,
        ];
        if (!actions.includes(event.action as string)) continue;
        for (const required of branch.then.required ?? []) {
          expect(event, `${event.action} requires "${required}"`).toHaveProperty(
            required,
          );
        }
      }
    }
  });
});

/**
 * Validate every event fixture against the shared JSON Schema.
 *
 *   node scripts/validate-schema.mjs
 *
 * Used by CI (the schema contract job) and available locally so a contributor
 * can check a new fixture before pushing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const schemaPath = join(root, 'shared', 'schemas', 'event.schema.json');
const fixturesDir = join(root, 'shared', 'fixtures');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

/**
 * A focused JSON Schema validator.
 *
 * Implements exactly the subset the event schema uses: type, enum, required,
 * properties, additionalProperties, minimum, exclusiveMinimum, maximum, items,
 * allOf/if/then, $ref (local), $defs. Keeping it dependency-free means the
 * check runs anywhere Node runs.
 */
function validate(schemaNode, data, rootSchema, path = '$') {
  const errors = [];

  if (schemaNode.$ref) {
    const resolved = resolveRef(schemaNode.$ref, rootSchema);
    if (!resolved) {
      errors.push(`${path}: cannot resolve $ref ${schemaNode.$ref}`);
      return errors;
    }
    return validate(resolved, data, rootSchema, path);
  }

  if (schemaNode.allOf) {
    for (const sub of schemaNode.allOf) {
      errors.push(...validate(sub, data, rootSchema, path));
    }
  }
  if (schemaNode.if) {
    const conditionHolds =
      validate(schemaNode.if, data, rootSchema, path).length === 0;
    if (conditionHolds && schemaNode.then) {
      errors.push(...validate(schemaNode.then, data, rootSchema, path));
    }
    if (!conditionHolds && schemaNode.else) {
      errors.push(...validate(schemaNode.else, data, rootSchema, path));
    }
  }

  if (schemaNode.type) {
    const types = Array.isArray(schemaNode.type)
      ? schemaNode.type
      : [schemaNode.type];
    if (!types.some((type) => matchesType(type, data))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${typeOf(data)}`);
      return errors;
    }
  }

  if (schemaNode.enum && !schemaNode.enum.some((value) => deepEqual(value, data))) {
    errors.push(`${path}: ${JSON.stringify(data)} is not one of ${schemaNode.enum.join(', ')}`);
  }

  if (schemaNode.const !== undefined && !deepEqual(schemaNode.const, data)) {
    errors.push(`${path}: ${JSON.stringify(data)} is not ${JSON.stringify(schemaNode.const)}`);
  }

  if (typeof data === 'number') {
    if (schemaNode.minimum !== undefined && data < schemaNode.minimum) {
      errors.push(`${path}: ${data} < minimum ${schemaNode.minimum}`);
    }
    if (
      schemaNode.exclusiveMinimum !== undefined &&
      data <= schemaNode.exclusiveMinimum
    ) {
      errors.push(`${path}: ${data} <= exclusiveMinimum ${schemaNode.exclusiveMinimum}`);
    }
    if (schemaNode.maximum !== undefined && data > schemaNode.maximum) {
      errors.push(`${path}: ${data} > maximum ${schemaNode.maximum}`);
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const key of schemaNode.required ?? []) {
      if (!(key in data)) errors.push(`${path}: missing required property "${key}"`);
    }
    const properties = schemaNode.properties ?? {};
    for (const [key, value] of Object.entries(data)) {
      if (properties[key]) {
        errors.push(...validate(properties[key], value, rootSchema, `${path}.${key}`));
      } else if (schemaNode.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      } else if (
        schemaNode.additionalProperties &&
        typeof schemaNode.additionalProperties === 'object'
      ) {
        errors.push(
          ...validate(
            schemaNode.additionalProperties,
            value,
            rootSchema,
            `${path}.${key}`,
          ),
        );
      }
    }
  }

  if (Array.isArray(data)) {
    if (schemaNode.items) {
      data.forEach((item, index) => {
        errors.push(
          ...validate(schemaNode.items, item, rootSchema, `${path}[${index}]`),
        );
      });
    }
  }

  return errors;
}

function resolveRef(ref, rootSchema) {
  if (!ref.startsWith('#/')) return null;
  let node = rootSchema;
  for (const segment of ref.slice(2).split('/')) {
    node = node?.[segment];
    if (!node) return null;
  }
  return node;
}

function matchesType(type, data) {
  switch (type) {
    case 'object':
      return typeof data === 'object' && data !== null && !Array.isArray(data);
    case 'array':
      return Array.isArray(data);
    case 'string':
      return typeof data === 'string';
    case 'number':
      return typeof data === 'number' && Number.isFinite(data);
    case 'integer':
      return Number.isInteger(data);
    case 'boolean':
      return typeof data === 'boolean';
    case 'null':
      return data === null;
    default:
      return true;
  }
}

function typeOf(data) {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  return typeof data;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let failures = 0;
let checked = 0;

for (const file of readdirSync(fixturesDir)) {
  if (!file.endsWith('.json')) continue;
  const events = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  if (!Array.isArray(events)) {
    console.error(`${file}: expected an array of events`);
    failures += 1;
    continue;
  }
  events.forEach((event, index) => {
    const errors = validate(schema, event, schema, `$[${index}]`);
    checked += 1;
    if (errors.length > 0) {
      failures += 1;
      console.error(`✗ ${file}[${index}]`);
      for (const error of errors) console.error(`    ${error}`);
    }
  });
  console.log(`✓ ${file} (${events.length} events)`);
}

console.log(`\n${checked} events validated, ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);

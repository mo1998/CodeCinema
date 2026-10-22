/**
 * Architecture view.
 *
 * Recovers the module graph of the session from the final file contents:
 * which files were created, what each one imports, and which third-party
 * packages the session pulled in.
 */

export interface ModuleInfo {
  path: string;
  language: string;
  lines: number;
  /** Raw import specifiers found in the file. */
  imports: string[];
  /** Non-relative specifiers — i.e. real dependencies. */
  external: string[];
  /** Repo-relative modules this file imports. */
  internal: string[];
  /** True when the agent created this file during the session. */
  created: boolean;
  bytes: number;
}

export interface DependencyInfo {
  name: string;
  usedBy: string[];
  count: number;
}

export interface ArchitectureView {
  modules: ModuleInfo[];
  dependencies: DependencyInfo[];
  /** Internal edges: from → to (repo-relative). */
  edges: { from: string; to: string }[];
  createdCount: number;
  totalLines: number;
}

const IMPORT_PATTERNS: { language: string; pattern: RegExp }[] = [
  { language: 'javascript', pattern: /(?:^|\n)\s*import\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g },
  { language: 'javascript', pattern: /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g },
  { language: 'javascript', pattern: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g },
  { language: 'javascript', pattern: /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g },
  { language: 'typescript', pattern: /(?:^|\n)\s*import\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g },
  { language: 'typescript', pattern: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g },
  { language: 'typescript', pattern: /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g },
  { language: 'python', pattern: /(?:^|\n)\s*from\s+([A-Za-z_][\w.]*)\s+import\s/g },
  { language: 'python', pattern: /(?:^|\n)\s*import\s+([A-Za-z_][\w.]*)/g },
  { language: 'rust', pattern: /(?:^|\n)\s*use\s+([a-zA-Z_][\w:]*)/g },
  { language: 'rust', pattern: /(?:^|\n)\s*(?:pub\s+)?mod\s+([a-zA-Z_]\w*)/g },
  { language: 'go', pattern: /(?:^|\n)\s*(?:import\s+)?(?:\w+\s+)?"([^"]+)"/g },
  { language: 'java', pattern: /(?:^|\n)\s*import\s+(?:static\s+)?([\w.]+);/g },
  { language: 'kotlin', pattern: /(?:^|\n)\s*import\s+([\w.]+)/g },
  { language: 'ruby', pattern: /(?:^|\n)\s*require(?:_relative)?\s*['"]([^'"]+)['"]/g },
  { language: 'php', pattern: /(?:^|\n)\s*(?:use|require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g },
  { language: 'csharp', pattern: /(?:^|\n)\s*using\s+(?:static\s+)?([\w.]+);/g },
];

/** Extract import specifiers from a source file. */
export function extractImports(path: string, content: string): string[] {
  const found = new Set<string>();
  for (const { pattern } of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const value = match[1];
      if (value) found.add(value.trim());
    }
  }
  return [...found];
}

function isRelative(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/');
}

/**
 * Resolve a relative import to a repo-relative module path, guessing the file
 * extension from the set of known modules.
 */
function resolveInternal(
  fromPath: string,
  spec: string,
  known: Set<string>,
): string | null {
  if (!isRelative(spec)) return null;
  const baseDir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  const segments = (baseDir ? `${baseDir}/${spec}` : spec).split('/');
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  const joined = stack.join('/');
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.py`,
    `${joined}.rs`,
    `${joined}.go`,
    `${joined}.rb`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
    `${joined}/__init__.py`,
  ];
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

export function buildArchitecture(
  files: { path: string; text: string; language: string }[],
  createdPaths: string[] = [],
): ArchitectureView {
  const known = new Set(files.map((f) => f.path));
  const created = new Set(createdPaths);
  const modules: ModuleInfo[] = [];
  const dependencyMap = new Map<string, { usedBy: string[]; count: number }>();
  const edges: { from: string; to: string }[] = [];

  for (const file of files) {
    const imports = extractImports(file.path, file.text);
    const external: string[] = [];
    const internal: string[] = [];

    for (const spec of imports) {
      if (isRelative(spec)) {
        const resolved = resolveInternal(file.path, spec, known);
        if (resolved) {
          internal.push(resolved);
          edges.push({ from: file.path, to: resolved });
        }
        continue;
      }
      // Strip sub-paths for package names: "lodash/fp" → "lodash".
      const pkg = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      if (!pkg || pkg.startsWith('node:')) continue;
      external.push(pkg);
      const entry = dependencyMap.get(pkg) ?? { usedBy: [], count: 0 };
      entry.count += 1;
      if (!entry.usedBy.includes(file.path)) entry.usedBy.push(file.path);
      dependencyMap.set(pkg, entry);
    }

    modules.push({
      path: file.path,
      language: file.language,
      lines: file.text.length ? file.text.split('\n').length : 0,
      bytes: file.text.length,
      imports,
      external: [...new Set(external)],
      internal: [...new Set(internal)],
      created: created.has(file.path),
    });
  }

  const dependencies: DependencyInfo[] = [...dependencyMap.entries()]
    .map(([name, value]) => ({ name, usedBy: value.usedBy, count: value.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    modules: modules.sort((a, b) => a.path.localeCompare(b.path)),
    dependencies,
    edges,
    createdCount: modules.filter((m) => m.created).length,
    totalLines: modules.reduce((sum, m) => sum + m.lines, 0),
  };
}

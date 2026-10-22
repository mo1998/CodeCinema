/**
 * Language detection for syntax highlighting and the project explorer.
 */

const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cshtml: 'razor',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  mdx: 'mdx',
  ipynb: 'jupyter',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'proto',
  tf: 'hcl',
  hcl: 'hcl',
  dockerfile: 'dockerfile',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  scala: 'scala',
  pl: 'perl',
  vuehtml: 'html',
  txt: 'plaintext',
  env: 'ini',
  gitignore: 'plaintext',
  lock: 'plaintext',
};

const FILENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmakelists: 'cmake',
  'cmakelists.txt': 'cmake',
  pipfile: 'toml',
  'gemfile': 'ruby',
  rakefile: 'ruby',
  '.gitignore': 'plaintext',
  '.env': 'ini',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
  'vite.config.ts': 'typescript',
  'next.config.js': 'javascript',
};

export function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);

  if (FILENAME_MAP[base]) return FILENAME_MAP[base];
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile') return 'makefile';

  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return 'plaintext';
  const ext = base.slice(dot + 1);
  return EXTENSION_MAP[ext] ?? 'plaintext';
}

/** Human label used in the explorer / architecture view. */
export const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript React',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript React',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  php: 'PHP',
  csharp: 'C#',
  c: 'C',
  cpp: 'C++',
  razor: 'Razor',
  sql: 'SQL',
  shell: 'Shell',
  powershell: 'PowerShell',
  json: 'JSON',
  jsonc: 'JSON with Comments',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'Ini',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  vue: 'Vue',
  svelte: 'Svelte',
  markdown: 'Markdown',
  mdx: 'MDX',
  jupyter: 'Jupyter',
  graphql: 'GraphQL',
  proto: 'Protocol Buffers',
  hcl: 'HCL',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  cmake: 'CMake',
  lua: 'Lua',
  r: 'R',
  dart: 'Dart',
  elixir: 'Elixir',
  scala: 'Scala',
  perl: 'Perl',
  plaintext: 'Plain Text',
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

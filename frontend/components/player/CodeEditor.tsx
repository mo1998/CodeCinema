'use client';

import { useCallback, useEffect, useRef } from 'react';
import Editor, { loader, type Monaco } from '@monaco-editor/react';
import { useEngineDisplayEffect, useEngine } from '@/lib/engine/usePlayback';
import type { EngineDisplay } from '@/lib/engine/engine';
import { detectLanguage } from '@/lib/engine/languages';
import { clsx } from 'clsx';

// Serve Monaco (and its language workers) from our own origin. A CDN would
// break the headless video-export renderer inside restricted containers.
loader.config({ paths: { vs: '/monaco/vs' } });

/** Map our language ids onto Monaco's built-in language ids. */
const MONACO_LANGUAGE: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'typescript',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  python: 'python',
  rust: 'rust',
  go: 'go',
  java: 'java',
  kotlin: 'kotlin',
  swift: 'swift',
  ruby: 'ruby',
  php: 'php',
  csharp: 'csharp',
  c: 'c',
  cpp: 'cpp',
  razor: 'razor',
  sql: 'sql',
  shell: 'shell',
  powershell: 'powershell',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  vue: 'html',
  svelte: 'html',
  markdown: 'markdown',
  mdx: 'markdown',
  jupyter: 'python',
  graphql: 'graphql',
  proto: 'proto',
  hcl: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'shell',
  cmake: 'shell',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  elixir: 'plaintext',
  scala: 'plaintext',
  perl: 'perl',
  plaintext: 'plaintext',
};

interface Diff {
  start: number;
  end: number;
  text: string;
}

/**
 * Minimal single-splice diff.
 *
 * The engine already tells us *what* changed at a byte level; the editor only
 * needs to know where to splice it into the Monaco model. A common
 * prefix/suffix scan is O(n) with native string comparison and avoids the
 * cost of a full diff library on every frame.
 */
function computeDiff(oldText: string, newText: string): Diff | null {
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return { start, end: oldEnd, text: newText.slice(start, newEnd) };
}

export interface CodeEditorProps {
  className?: string;
}

export function CodeEditor({ className }: CodeEditorProps) {
  const engine = useEngine();
  const editorRef = useRef<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0] | null>(
    null,
  );
  const monacoRef = useRef<Monaco | null>(null);
  const models = useRef(new Map<string, ReturnType<Monaco['editor']['createModel']>>());
  const activePathRef = useRef<string | null>(null);
  const lastTextRef = useRef('');

  const disposeModels = useCallback(() => {
    for (const model of models.current.values()) model.dispose();
    models.current.clear();
  }, []);

  useEffect(() => disposeModels, [disposeModels]);

  const handleMount = useCallback(
    (editor: NonNullable<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0]>, monaco: Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      monaco.editor.defineTheme('codecinema-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6A7280', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'C792EA' },
          { token: 'string', foreground: 'C3E88D' },
          { token: 'number', foreground: 'F78C6C' },
          { token: 'type', foreground: '82AAFF' },
          { token: 'function', foreground: '82AAFF' },
          { token: 'variable', foreground: 'E7E9EE' },
          { token: 'delimiter', foreground: '99A1AE' },
        ],
        colors: {
          'editor.background': '#0D0F13',
          'editor.foreground': '#E7E9EE',
          'editorLineNumber.foreground': '#3C424D',
          'editorLineNumber.activeForeground': '#99A1AE',
          'editorCursor.foreground': '#7C6CFF',
          'editor.selectionBackground': '#7C6CFF33',
          'editor.inactiveSelectionBackground': '#7C6CFF1A',
          'editor.lineHighlightBackground': '#FFFFFF08',
          'editorIndentGuide.background1': '#23272F',
          'editorIndentGuide.activeBackground1': '#3C424D',
          'editorWhitespace.foreground': '#23272F',
          'editorGutter.background': '#0D0F13',
          'editorWidget.background': '#15181D',
          'editorWidget.border': '#23272F',
          'scrollbarSlider.background': '#333A4540',
          'scrollbarSlider.hoverBackground': '#333A4570',
          'scrollbarSlider.activeBackground': '#454D5A90',
          'editorOverviewRuler.border': '#00000000',
          'minimap.background': '#00000000',
        },
      });

      monaco.editor.setTheme('codecinema-dark');
      editor.updateOptions({
        readOnly: true,
        domReadOnly: true,
        fontSize: 13,
        lineHeight: 20,
        fontFamily:
          "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
        fontLigatures: true,
        minimap: { enabled: true, maxColumn: 60, renderCharacters: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        padding: { top: 12, bottom: 24 },
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
        stickyScroll: { enabled: false },
        occurrencesHighlight: 'singleFile',
        unicodeHighlight: { ambiguousCharacters: false },
      });

      // The engine may already be sitting at a seeked-to position; pull that
      // state into the editor now rather than waiting for the next frame.
      syncRef.current(engine.getDisplay());
    },
    [engine],
  );

  /**
   * Push the engine's current view of the document into Monaco.
   *
   * Kept as a callback (rather than inline in the effect) so that it can also
   * be invoked the moment the editor mounts: the engine may already be paused
   * at a position the viewer seeked to, in which case no further display
   * notification would ever arrive and the editor would stay empty.
   */
  const syncDisplay = useCallback((display: EngineDisplay) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const doc = display.document;
    if (!doc) {
      if (activePathRef.current) {
        editor.setModel(null);
        activePathRef.current = null;
        lastTextRef.current = '';
      }
      return;
    }

    if (doc.path !== activePathRef.current) {
      let model = models.current.get(doc.path);
      if (!model) {
        model = monaco.editor.createModel('', MONACO_LANGUAGE[doc.language] ?? 'plaintext');
        models.current.set(doc.path, model);
      }
      editor.setModel(model);
      activePathRef.current = doc.path;
      lastTextRef.current = model.getValue();
    }

    const model = editor.getModel();
    if (!model) return;

    const current = model.getValue();
    if (current !== doc.text) {
      const diff = computeDiff(current, doc.text);
      if (diff) {
        const start = model.getPositionAt(diff.start);
        const end = model.getPositionAt(diff.end);
        model.applyEdits([
          {
            range: new monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: diff.text,
          },
        ]);
      }
      lastTextRef.current = doc.text;
    }

    // Follow the agent's cursor. `revealPositionInCenterIfOutsideViewport`
    // gives the scrolling behaviour a human would have.
    const cursor = model.getPositionAt(Math.min(doc.cursor, model.getValueLength()));
    const selection = doc.selection
      ? model.getPositionAt(Math.min(doc.selection.start + doc.selection.length, model.getValueLength()))
      : null;

    if (selection && doc.selection && doc.selection.length > 0) {
      const start = model.getPositionAt(Math.min(doc.selection.start, model.getValueLength()));
      const end = model.getPositionAt(
        Math.min(doc.selection.start + doc.selection.length, model.getValueLength()),
      );
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      });
      editor.revealPositionInCenterIfOutsideViewport(end, 0);
    } else {
      editor.setPosition(cursor);
      editor.revealPositionInCenterIfOutsideViewport(cursor, 0);
    }
  }, []);

  const syncRef = useRef(syncDisplay);
  syncRef.current = syncDisplay;

  useEngineDisplayEffect((display) => syncRef.current(display));

  // Re-apply the whole document when the session changes underneath us.
  useEffect(() => {
    disposeModels();
    activePathRef.current = null;
    lastTextRef.current = '';
  }, [engine, disposeModels]);

  return (
    <div className={clsx('h-full w-full min-h-0 bg-[#0D0F13]', className)}>
      <Editor
        height="100%"
        language="plaintext"
        theme="codecinema-dark"
        onMount={handleMount}
        loading={
          <div className="flex h-full w-full items-center justify-center bg-[#0D0F13]">
            <div className="flex items-center gap-2 text-xs text-faint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Loading editor…
            </div>
          </div>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          automaticLayout: true,
        }}
      />
    </div>
  );
}

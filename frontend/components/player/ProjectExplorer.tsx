'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  File as FileIcon,
  FileCode2,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react';
import { useEngine } from '@/lib/engine/usePlayback';
import { useEngineState } from '@/lib/engine/usePlayback';
import {
  allFolderPaths,
  buildProjectTree,
  flattenTree,
  type TreeNode,
} from '@/lib/engine/projectTree';
import { clsx } from 'clsx';

const FILE_ICON: Record<string, string> = {
  typescript: 'text-[#3178C6]',
  typescriptreact: 'text-[#3178C6]',
  javascript: 'text-[#E8D44D]',
  javascriptreact: 'text-[#61DAFB]',
  python: 'text-[#4B8BBE]',
  rust: 'text-[#E7A15C]',
  go: 'text-[#00ADD8]',
  json: 'text-[#CBCB41]',
  markdown: 'text-[#8B949E]',
  yaml: 'text-[#CB8B61]',
  shell: 'text-[#7EE787]',
  dockerfile: 'text-[#2496ED]',
  html: 'text-[#E34F26]',
  css: 'text-[#563D7C]',
};

export function ProjectExplorer({
  className,
}: {
  className?: string;
}) {
  const engine = useEngine();
  const files = useEngineState((state) => state.fileOrder);
  const languages = useEngineState((state) => state.languages);
  const activeFile = useEngineState((state) => state.activeFile);
  const createdFiles = useEngineState((state) => state.createdFiles);

  const tree = useMemo(
    () =>
      buildProjectTree(files, {
        activePath: activeFile,
        languages,
        createdPaths: new Set(createdFiles),
      }),
    [files, languages, activeFile, createdFiles],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState('');

  // Auto-expand the folders that contain something interesting on first paint.
  const effectiveExpanded = useMemo(() => {
    if (manual || expanded.size > 0) return expanded;
    return new Set(allFolderPaths(tree));
  }, [manual, expanded, tree]);

  const rows = useMemo(() => {
    const all = flattenTree(tree, effectiveExpanded);
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) => row.node.path.toLowerCase().includes(needle));
  }, [tree, effectiveExpanded, query]);

  const toggle = (node: TreeNode) => {
    setManual(true);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };

  const open = (node: TreeNode) => {
    if (node.type === 'file') {
      engine.seekToFile(node.path);
    } else {
      toggle(node);
    }
  };

  return (
    <div
      data-testid="project-explorer"
      className={clsx('flex min-h-0 flex-col bg-surface', className)}
    >
      <div className="flex h-8 shrink-0 items-center px-3 text-[11px] font-medium tracking-wide text-muted uppercase">
        Explorer
        <span className="ml-auto font-mono text-[10px] text-faint normal-case">
          {files.length}
        </span>
      </div>
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find file…"
            className="h-7 w-full rounded-sm border border-border bg-surface-2 pl-7 pr-2 text-[12px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {rows.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-faint">No files yet</div>
        ) : (
          rows.map((row) => {
            const { node, depth } = row;
            const isActive = node.type === 'file' && node.path === activeFile;
            const color = FILE_ICON[languages[node.path] ?? ''] ?? 'text-[#7D8590]';
            return (
              <button
                key={node.path}
                aria-expanded={node.type === 'folder' ? row.expanded : undefined}
                onClick={() => open(node)}
                className={clsx(
                  'flex h-[22px] w-full items-center gap-1.5 pr-2 text-left text-[12.5px] transition-colors',
                  isActive
                    ? 'bg-accent-soft text-text'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
                style={{ paddingLeft: 8 + depth * 12 }}
                title={node.path}
              >
                {node.type === 'folder' ? (
                  row.expanded ? (
                    <ChevronRight className="h-3 w-3 shrink-0 rotate-90 text-faint" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                  )
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                {node.type === 'folder' ? (
                  row.expanded ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#7D8590]" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-[#7D8590]" />
                  )
                ) : (
                  <FileCode2 className={clsx('h-3.5 w-3.5 shrink-0', color)} />
                )}
                <span className="truncate">{node.name}</span>
                {node.created && (
                  <span className="ml-auto rounded-sm bg-accent-soft px-1 text-[9px] font-medium text-accent">
                    NEW
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

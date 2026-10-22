'use client';

import { useMemo, useState } from 'react';
import { Box, FileCode2, GitBranch, Package, Plus } from 'lucide-react';
import { useSessionOverview } from '@/lib/engine/usePlayback';
import { buildArchitecture } from '@/lib/engine/architecture';
import { clsx } from 'clsx';

export function ArchitecturePanel() {
  const [selected, setSelected] = useState<string | null>(null);

  const overview = useSessionOverview();
  const architecture = useMemo(
    () =>
      buildArchitecture(overview?.modules ?? [], overview?.createdFiles ?? []),
    [overview],
  );

  const selectedModule = architecture.modules.find((m) => m.path === selected);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
            <FileCode2 className="h-3 w-3" />
            Modules
          </div>
          <div className="mt-0.5 font-mono text-[15px] tabular-nums text-text">
            {architecture.modules.length}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10.5px] text-faint">
            <Plus className="h-3 w-3" />
            Created
          </div>
          <div className="mt-0.5 font-mono text-[15px] tabular-nums text-accent">
            {architecture.createdCount}
          </div>
        </div>
      </div>

      {architecture.dependencies.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
            <Package className="h-3 w-3" />
            Dependencies
          </h3>
          <div className="flex flex-wrap gap-1">
            {architecture.dependencies.map((dependency) => (
              <span
                key={dependency.name}
                title={dependency.usedBy.join('\n')}
                className="rounded-sm border border-[#C792EA]/30 bg-[#C792EA]/10 px-1.5 py-0.5 font-mono text-[11px] text-[#C792EA]"
              >
                {dependency.name}
                <span className="ml-1 text-[10px] opacity-60">{dependency.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
          <Box className="h-3 w-3" />
          Modules
        </h3>
        <ul className="space-y-0.5">
          {architecture.modules.map((module) => (
            <li key={module.path}>
              <button
                onClick={() =>
                  setSelected(selected === module.path ? null : module.path)
                }
                className={clsx(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors',
                  selected === module.path
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface-2',
                )}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="truncate text-[12px] text-text">{module.path}</span>
                {module.created && (
                  <span className="ml-auto rounded-sm bg-accent-soft px-1 text-[9px] font-medium text-accent">
                    NEW
                  </span>
                )}
                <span className="ml-auto font-mono text-[10.5px] tabular-nums text-faint">
                  {module.lines}
                </span>
              </button>
              {selected === module.path && (
                <div className="ml-5 border-l border-border py-1 pl-3">
                  {module.external.length > 0 && (
                    <div className="mb-1.5">
                      <div className="text-[10px] tracking-wide text-faint uppercase">
                        Imports
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {module.external.map((name) => (
                          <span
                            key={name}
                            className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {module.internal.length > 0 && (
                    <div>
                      <div className="text-[10px] tracking-wide text-faint uppercase">
                        Depends on
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {module.internal.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent"
                          >
                            <GitBranch className="h-2.5 w-2.5" />
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

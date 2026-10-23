'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { API_BASE, api, type ExportJob } from '@/lib/api/client';
import { formatBytes } from '@/lib/format';

export function ExportsPanel({ sessionId }: { sessionId?: string }) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      setJobs(await api.listExports(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exports');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (type: ExportJob['type']) => {
    if (!sessionId) return;
    try {
      await api.createExport(sessionId, type);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue export');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p className="text-[12px] text-faint">Loading exports…</p>}
        {!loading && jobs.length === 0 && (
          <p className="text-[12px] text-faint">No exports yet.</p>
        )}
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-md border border-border bg-surface-2 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-text uppercase">{job.type}</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {job.status}
                    {typeof job.progress === 'number' ? ` · ${Math.round(job.progress * 100)}%` : ''}
                    {job.file_size ? ` · ${formatBytes(job.file_size)}` : ''}
                  </div>
                  {job.error && (
                    <div className="mt-1 text-[11px] text-danger">{job.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {job.status === 'succeeded' && (
                    <a
                      href={`${API_BASE}/v1/exports/${job.id}/download`}
                      className="rounded-sm border border-border bg-surface-3 p-1.5 text-muted transition-colors hover:text-text"
                      aria-label="Download export"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {job.status === 'failed' && (
                    <button
                      onClick={() => void retry(job.type)}
                      className="rounded-sm border border-border bg-surface-3 px-2 py-1 text-[11px] text-muted transition-colors hover:text-text"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  );
}

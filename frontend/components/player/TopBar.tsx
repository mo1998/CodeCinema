'use client';

import { useState } from 'react';
import {
  Clapperboard,
  Copy,
  Download,
  FileJson,
  Film,
  GitBranch,
  Loader2,
  PanelRightOpen,
  Share2,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { api, API_BASE, type ExportType } from '@/lib/api/client';
import { clsx } from 'clsx';

export function TopBar({
  title,
  agent,
  prompt,
  sessionId,
  onToggleRight,
  rightOpen,
  onToggleTerminal,
  terminalOpen,
}: {
  title?: string;
  agent?: string;
  prompt?: string;
  sessionId?: string;
  onToggleRight?: () => void;
  rightOpen?: boolean;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const share = async () => {
    if (!sessionId) return;
    const url = `${window.location.origin}/share/${sessionId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.open(url, '_blank');
    }
  };

  const runExport = async (type: ExportType) => {
    if (!sessionId) return;
    setExporting(type);
    setExportError(null);
    try {
      const job = await api.createExport(sessionId, type);
      const poll = setInterval(async () => {
        const status = await api.getExport(job.id);
        if (status.status === 'succeeded') {
          clearInterval(poll);
          window.open(`${API_BASE}/v1/exports/${job.id}/download`, '_blank');
          setExporting(null);
        } else if (status.status === 'failed') {
          clearInterval(poll);
          setExportError(status.error ?? 'Export failed');
          setExporting(null);
        }
      }, 2000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
      setExporting(null);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
          <Clapperboard className="h-3.5 w-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-text">
          CodeCinema
        </span>
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[13px] text-text" title={title}>
          {title ?? 'Untitled session'}
        </span>
        {agent && (
          <Badge tone="accent" mono>
            {agent}
          </Badge>
        )}
        {prompt && (
          <span className="hidden min-w-0 truncate text-[11.5px] text-faint lg:inline">
            {prompt}
          </span>
        )}
      </div>

      {exportError && (
        <span className="max-w-[220px] truncate text-[11px] text-danger">
          {exportError}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <Tooltip label="Export JSON session">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runExport('json')}
            disabled={!sessionId || exporting !== null}
          >
            {exporting === 'json' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileJson className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">JSON</span>
          </Button>
        </Tooltip>
        <Tooltip label="Render MP4 video">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runExport('mp4')}
            disabled={!sessionId || exporting !== null}
          >
            {exporting === 'mp4' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Film className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">MP4</span>
          </Button>
        </Tooltip>
        <Tooltip label="Export GIF">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runExport('gif')}
            disabled={!sessionId || exporting !== null}
          >
            {exporting === 'gif' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">GIF</span>
          </Button>
        </Tooltip>

        <div className="mx-1 h-4 w-px bg-border" />

        <Tooltip label={copied ? 'Link copied' : 'Copy share link'}>
          <Button size="sm" variant="secondary" onClick={share} disabled={!sessionId}>
            {copied ? (
              <Copy className="h-3.5 w-3.5 text-success" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </Button>
        </Tooltip>

        {onToggleTerminal && (
          <Tooltip label={terminalOpen ? 'Hide terminal' : 'Show terminal'}>
            <IconButton
              label={terminalOpen ? 'Hide terminal' : 'Show terminal'}
              active={terminalOpen}
              onClick={onToggleTerminal}
            >
              <TerminalIcon className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
        )}
        {onToggleRight && (
          <Tooltip label={rightOpen ? 'Hide side panel' : 'Show side panel'}>
            <IconButton
              label={rightOpen ? 'Hide side panel' : 'Show side panel'}
              active={rightOpen}
              onClick={onToggleRight}
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

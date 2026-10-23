'use client';

import Image from 'next/image';

import { useEffect, useState } from 'react';
import {
  Copy,
  Download,
  FileJson,
  Film,
  GitBranch,
  Loader2,
  PanelLeft,
  PanelRightOpen,
  Moon,
  Share2,
  Star,
  Sun,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { api, API_BASE, type ExportType } from '@/lib/api/client';
import type { LiveStatus } from '@/lib/api/live';
import { clsx } from 'clsx';

export function TopBar({
  title,
  agent,
  prompt,
  sessionId,
  liveStatus,
  viewers,
  leftOpen,
  onToggleLeft,
  onToggleRight,
  rightOpen,
  onToggleTerminal,
  terminalOpen,
}: {
  title?: string;
  agent?: string;
  prompt?: string;
  sessionId?: string;
  liveStatus?: LiveStatus;
  viewers?: number;
  leftOpen?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
  rightOpen?: boolean;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [stars, setStars] = useState(0);
  const [starred, setStarred] = useState(false);
  const [starBusy, setStarBusy] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const saved = window.localStorage.getItem('codecinema:theme');
    const initial = saved === 'light' ? 'light' : 'dark';
    setTheme(initial);
    document.documentElement.dataset.theme = initial === 'light' ? 'light' : '';
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next === 'light' ? 'light' : '';
    window.localStorage.setItem('codecinema:theme', next);
  };

  const share = async () => {
    if (!sessionId) return;
    try {
      const published = await api.publishSession(sessionId);
      const slug = published.share_slug || sessionId;
      const url = `${window.location.origin}/share/${slug}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const url = `${window.location.origin}/share/${sessionId}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        window.open(url, '_blank');
      }
    }
  };

  const runExport = async (type: ExportType) => {
    if (!sessionId) return;
    setExporting(type);
    setExportError(null);
    setExportProgress(0);
    try {
      const job = await api.createExport(sessionId, type);
      const poll = setInterval(async () => {
        const status = await api.getExport(job.id);
        setExportProgress(typeof status.progress === 'number' ? status.progress : null);
        if (status.status === 'succeeded') {
          clearInterval(poll);
          setExportProgress(1);
          window.open(`${API_BASE}/v1/exports/${job.id}/download`, '_blank');
          setExporting(null);
          setExportProgress(null);
        } else if (status.status === 'failed') {
          clearInterval(poll);
          setExportError(status.error ?? 'Export failed');
          setExporting(null);
          setExportProgress(null);
        }
      }, 2000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
      setExporting(null);
      setExportProgress(null);
    }
  };

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api
      .getStars(sessionId)
      .then((result) => {
        if (cancelled) return;
        setStars(result.stars);
        setStarred(result.starred);
      })
      .catch(() => {
        /* stars are best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const toggleStar = async () => {
    if (!sessionId || starBusy) return;
    const token = window.localStorage.getItem('codecinema:token') ?? undefined;
    setStarBusy(true);
    try {
      const result = token
        ? starred
          ? await api.unstarSession(sessionId, token)
          : await api.starSession(sessionId, token)
        : null;
      if (result) {
        setStars(result.stars);
        setStarred(result.starred);
      }
    } catch {
      /* ignore */
    } finally {
      setStarBusy(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2">
        <Image
          src="/logo.png"
          alt="CodeCinema"
          width={24}
          height={24}
          className="h-6 w-6 rounded-md"
        />
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
        {liveStatus && (
          <Badge tone={liveStatus === 'live' ? 'success' : 'warn'} mono>
            {liveStatus === 'live' ? 'LIVE' : liveStatus.toUpperCase()}
            {typeof viewers === 'number' && viewers > 0 ? ` · ${viewers}` : ''}
          </Badge>
        )}
        {!liveStatus && typeof viewers === 'number' && viewers > 0 && (
          <Badge tone="info" mono>
            {viewers} viewing
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
      {exporting && exportProgress !== null && (
        <span className="font-mono text-[11px] text-muted">
          {Math.round(exportProgress * 100)}%
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

        <Tooltip label={starred ? 'Unstar session' : 'Star session'}>
          <Button size="sm" variant="ghost" onClick={() => void toggleStar()} disabled={!sessionId || starBusy}>
            <Star className={clsx('h-3.5 w-3.5', starred && 'fill-current text-warn')} />
            <span className="hidden sm:inline">{stars}</span>
          </Button>
        </Tooltip>

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

        <Tooltip label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          <IconButton label="Toggle theme" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </IconButton>
        </Tooltip>

        {onToggleLeft && (
          <Tooltip label={leftOpen ? 'Hide explorer' : 'Show explorer'}>
            <IconButton
              label={leftOpen ? 'Hide explorer' : 'Show explorer'}
              active={leftOpen}
              onClick={onToggleLeft}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </IconButton>
          </Tooltip>
        )}

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

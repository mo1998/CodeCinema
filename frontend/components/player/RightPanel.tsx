'use client';

import { useState } from 'react';
import {
  Boxes,
  Brain,
  ListTree,
  TrendingUp,
} from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { TimelinePanel } from './TimelinePanel';
import { ReasoningPanel } from './ReasoningPanel';
import { ProgressPanel } from './ProgressPanel';
import { ArchitecturePanel } from './ArchitecturePanel';
import { CommentsPanel } from './CommentsPanel';
import { BookmarksPanel } from './BookmarksPanel';

type PanelId = 'timeline' | 'reasoning' | 'progress' | 'architecture' | 'comments' | 'bookmarks';

export function RightPanel({
  className,
  sessionId,
  bookmarks = [],
  onSeekBookmark,
  onRemoveBookmark,
}: {
  className?: string;
  sessionId?: string;
  bookmarks?: number[];
  onSeekBookmark?: (time: number) => void;
  onRemoveBookmark?: (time: number) => void;
}) {
  const [active, setActive] = useState<PanelId>('timeline');

  return (
    <div className={`flex min-h-0 flex-col bg-surface ${className ?? ''}`}>
      <div className="flex h-9 shrink-0 items-center border-b border-border px-2">
        <Tabs
          size="sm"
          active={active}
          onChange={setActive}
          items={[
            { id: 'timeline', label: 'Timeline', icon: <ListTree className="h-3.5 w-3.5" /> },
            { id: 'reasoning', label: 'Reasoning', icon: <Brain className="h-3.5 w-3.5" /> },
            { id: 'progress', label: 'Progress', icon: <TrendingUp className="h-3.5 w-3.5" /> },
            { id: 'architecture', label: 'Architecture', icon: <Boxes className="h-3.5 w-3.5" /> },
            { id: 'comments', label: 'Comments', icon: <Boxes className="h-3.5 w-3.5" /> },
            { id: 'bookmarks', label: 'Bookmarks', icon: <Boxes className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>
      {active === 'timeline' && <TimelinePanel />}
      {active === 'reasoning' && <ReasoningPanel />}
      {active === 'progress' && <ProgressPanel />}
      {active === 'architecture' && <ArchitecturePanel />}
      {active === 'comments' && <CommentsPanel sessionId={sessionId} />}
      {active === 'bookmarks' && (
        <BookmarksPanel
          bookmarks={bookmarks}
          onSeek={onSeekBookmark ?? (() => {})}
          onRemove={onRemoveBookmark ?? (() => {})}
        />
      )}
    </div>
  );
}

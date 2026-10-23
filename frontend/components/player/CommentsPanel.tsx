'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { relativeTime } from '@/lib/format';
import { clsx } from 'clsx';

const TOKEN_KEY = 'codecinema:token';

export function CommentsPanel({ sessionId }: { sessionId?: string }) {
  const [comments, setComments] = useState<
    { id: string; body: string; created_at: string; author?: { display_name?: string } }[]
  >([]);
  const [body, setBody] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY) ?? '');
  }, []);

  const persistToken = (value: string) => {
    setToken(value);
    if (value) window.localStorage.setItem(TOKEN_KEY, value);
    else window.localStorage.removeItem(TOKEN_KEY);
  };

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      setComments(await api.comments(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!sessionId || !body.trim()) return;
    setError(null);
    try {
      await api.addComment(sessionId, body.trim(), token || undefined);
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    }
  };

  const remove = async (commentId: string) => {
    if (!sessionId) return;
    try {
      await api.deleteComment(sessionId, commentId, token || undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete comment');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <input
          value={token}
          onChange={(event) => persistToken(event.target.value)}
          placeholder="API token (optional)"
          className="h-7 w-full rounded-sm border border-border bg-surface-2 px-2 text-[12px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p className="text-[12px] text-faint">Loading comments…</p>}
        {!loading && comments.length === 0 && (
          <p className="text-[12px] text-faint">No comments yet.</p>
        )}
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md border border-border bg-surface-2 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted">
                    {comment.author?.display_name ?? 'Anonymous'} ·{' '}
                    {relativeTime(comment.created_at)}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text">
                    {comment.body}
                  </p>
                </div>
                <button
                  onClick={() => void remove(comment.id)}
                  aria-label="Delete comment"
                  className="rounded-sm p-1 text-faint transition-colors hover:bg-surface-3 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a comment…"
            rows={2}
            className="min-h-[42px] flex-1 resize-none rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
          />
          <button
            onClick={() => void submit()}
            disabled={!body.trim()}
            aria-label="Post comment"
            className="flex h-[42px] w-9 items-center justify-center rounded-sm bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Trash2, Plus, Save } from 'lucide-react';
import { api } from '@/lib/api/client';

export default function ManagePage() {
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.listSessions>>['items']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState('claude-code');
  const [visibility, setVisibility] = useState('private');
  const [tags, setTags] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions((await api.listSessions({ limit: 100 })).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    try {
      const session = await api.createSession({
        title: title.trim(),
        prompt: prompt.trim() || undefined,
        agent,
        visibility,
      });
      if (tags.trim()) {
        await api.updateSession?.(session.id, { title: session.title, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      }
      setTitle('');
      setPrompt('');
      setTags('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  const saveEdit = async (id: string) => {
    try {
      await api.updateSession?.(id, { title: editTitle.trim() });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update session');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteSession?.(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  const publish = async (id: string) => {
    try {
      await api.publishSession(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish session');
    }
  };

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-12 items-center gap-3 border-b border-border bg-surface px-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="CodeCinema" width={24} height={24} className="h-6 w-6 rounded-md" />
          <span className="text-[13px] font-semibold tracking-tight text-text">CodeCinema</span>
        </Link>
        <span className="ml-2 text-[12px] text-faint">Manage</span>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Session management</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Create, edit, publish and delete recorded sessions.
        </p>

        <section className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-[14px] font-medium text-text">Create session</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
            />
            <input
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              placeholder="Agent"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
            />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Prompt"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none sm:col-span-2"
            />
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text focus:border-accent-border focus:outline-none"
            >
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (comma separated)"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
            />
          </div>
          <button
            onClick={() => void create()}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Create
          </button>
        </section>

        {error && <p className="mt-4 text-[12px] text-danger">{error}</p>}

        <section className="mt-6 space-y-2">
          {loading && <p className="text-[13px] text-muted">Loading…</p>}
          {!loading &&
            sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="min-w-0 flex-1">
                  {editing === session.id ? (
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-text focus:border-accent-border focus:outline-none"
                    />
                  ) : (
                    <div className="truncate text-[14px] font-medium text-text">{session.title}</div>
                  )}
                  <div className="mt-1 text-[11px] text-faint">
                    {session.agent} · {session.visibility} · {session.event_count} events
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {editing === session.id ? (
                    <button
                      onClick={() => void saveEdit(session.id)}
                      className="rounded-md border border-border bg-surface-2 p-2 text-muted transition-colors hover:text-text"
                      aria-label="Save"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(session.id);
                        setEditTitle(session.title);
                      }}
                      className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted transition-colors hover:text-text"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => void publish(session.id)}
                    className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted transition-colors hover:text-text"
                  >
                    Publish
                  </button>
                  <Link
                    href={`/session/${session.id}`}
                    className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-muted transition-colors hover:text-text"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => void remove(session.id)}
                    className="rounded-md border border-danger/30 bg-danger-soft p-2 text-danger transition-colors hover:bg-danger/20"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
        </section>
      </div>
    </main>
  );
}

import Link from 'next/link';
import {
  Activity,
  Braces,
  Clapperboard,
  Command,
  FileCode2,
  GitBranch,
  Play,
  Radio,
  TerminalSquare,
} from 'lucide-react';

const AGENTS = [
  'OpenCode',
  'Claude Code',
  'Cursor',
  'Gemini CLI',
  'Aider',
  'Cline',
  'Roo Code',
];

const FEATURES = [
  {
    icon: Activity,
    title: 'Character-by-character playback',
    body: 'Every keystroke is replayed at human typing speed, with micro-pauses on punctuation and a deliberate beat before each function body.',
  },
  {
    icon: GitBranch,
    title: 'Real mistakes, real fixes',
    body: 'The agent’s actual edits are recorded — the failing build, the error it read, the line it rewrote. That is the part worth learning from.',
  },
  {
    icon: TerminalSquare,
    title: 'A terminal that streams',
    body: 'npm install, tsc, pytest, git — commands appear character by character, with real exit codes and output.',
  },
  {
    icon: FileCode2,
    title: 'Multi-file, multi-tab',
    body: 'The project tree grows as the agent works. Tabs switch, files scroll, selections highlight.',
  },
  {
    icon: Braces,
    title: 'Architecture recovered',
    body: 'Import graphs and dependency lists are extracted from the finished code, so you can see the shape of what was built.',
  },
  {
    icon: Radio,
    title: 'Educational mode',
    body: 'Explanations sit beside the code: what is being created, why, and what the agent is thinking about.',
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-bg">
      {/* ----------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(900px 380px at 50% -10%, rgba(124,108,255,0.16), transparent 70%), radial-gradient(600px 300px at 85% 10%, rgba(88,166,255,0.08), transparent 70%)',
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-14 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-[12px] text-accent">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            The GitHub of coding replays
          </div>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-text sm:text-6xl">
            Watch AI code
            <br />
            <span className="bg-gradient-to-r from-accent via-[#8FA5FF] to-[#58A6FF] bg-clip-text text-transparent">
              being written.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-muted sm:text-base">
            CodeCinema records everything an AI coding agent actually does — the
            edits, the commands, the failed build, the bug it fixes — then
            replays the whole session like a senior engineer working live in
            VS&nbsp;Code.
          </p>

          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              href="/demo"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              <Play className="h-4 w-4" />
              Watch the demo
            </Link>
            <Link
              href="/explore"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-5 text-sm font-medium text-text transition-colors hover:bg-[#232833]"
            >
              <Clapperboard className="h-4 w-4" />
              Browse sessions
            </Link>
          </div>

          <p className="mt-5 font-mono text-[11px] text-faint">
            opencode · claude-code · cursor · gemini-cli · aider · cline · roo-code
          </p>
        </div>

        {/* ------------------------------------------------- editor preview */}
        <div className="relative mx-auto max-w-5xl px-6 pb-16">
          <div className="overflow-hidden rounded-xl border border-border-strong bg-[#0D0F13] shadow-float">
            <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
              </span>
              <span className="ml-3 font-mono text-[11px] text-faint">
                src/auth.ts
              </span>
              <span className="ml-auto flex items-center gap-1.5 rounded border border-danger/30 bg-danger-soft px-1.5 py-0.5 font-mono text-[10px] text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                1 error
              </span>
            </div>
            <div className="grid grid-cols-[1fr_260px]">
              <pre className="overflow-hidden p-4 font-mono text-[12px] leading-[19px]">
                <code>
                  <span className="text-faint">{'  9  '}</span>
                  <span className="text-[#C792EA]">return</span>
                  <span className="text-text"> </span>
                  <span className="text-[#82AAFF]">function</span>
                  <span className="text-text"> (</span>
                  <span className="text-[#E7E9EE]">req</span>
                  <span className="text-text">: </span>
                  <span className="text-[#82AAFF]">Request</span>
                  <span className="text-text">, </span>
                  <span className="text-[#E7E9EE]">res</span>
                  <span className="text-text">: </span>
                  <span className="text-[#82AAFF]">Response</span>
                  <span className="text-text">) {'{'}</span>
                  {'\n'}
                  <span className="text-faint">{' 10  '}</span>
                  <span className="text-[#C792EA]">const</span>
                  <span className="text-text"> </span>
                  <span className="text-[#E7E9EE]">raw</span>
                  <span className="text-text"> = </span>
                  <span className="text-[#E7E9EE]">req</span>
                  <span className="text-text">.</span>
                  <span className="text-[#E7E9EE]">headers</span>
                  <span className="text-text">[</span>
                  <span className="text-[#E7E9EE]">headerName</span>
                  <span className="text-text">];</span>
                  {'\n'}
                  <span className="bg-danger/10 text-faint">{' 11  '}</span>
                  <span className="bg-danger/10 text-[#E7E9EE]">const</span>
                  <span className="bg-danger/10 text-[#E7E9EE]"> token</span>
                  <span className="bg-danger/10 text-text"> = </span>
                  <span className="bg-danger/10 text-[#E7E9EE]">raw</span>
                  <span className="bg-danger/10 text-[#82AAFF]">.</span>
                  <span className="bg-danger/10 text-[#E7E9EE]">split</span>
                  <span className="bg-danger/10 text-text">(</span>
                  <span className="bg-danger/10 text-[#C3E88D]">' '</span>
                  <span className="bg-danger/10 text-text">)[</span>
                  <span className="bg-danger/10 text-[#F78C6C]">1</span>
                  <span className="bg-danger/10 text-text">];</span>
                  <span className="bg-danger/10 text-danger">  ← possibly undefined</span>
                  {'\n'}
                  <span className="text-faint">{' 12  '}</span>
                  <span className="text-[#C792EA]">if</span>
                  <span className="text-text"> (!</span>
                  <span className="text-[#E7E9EE]">token</span>
                  <span className="text-text">) {'{'}</span>
                  {'\n'}
                  <span className="text-faint">{' 13  '}</span>
                  <span className="text-text">  </span>
                  <span className="text-[#E7E9EE]">res</span>
                  <span className="text-text">.</span>
                  <span className="text-[#E7E9EE]">status</span>
                  <span className="text-text">(</span>
                  <span className="text-[#F78C6C]">401</span>
                  <span className="text-text">).</span>
                  <span className="text-[#E7E9EE]">json</span>
                  <span className="text-text">{'({ '}</span>
                  <span className="text-[#E7E9EE]">error</span>
                  <span className="text-text">: </span>
                  <span className="text-[#C3E88D]">'missing bearer token'</span>
                  <span className="text-text">{' });'}</span>
                </code>
              </pre>
              <div className="border-l border-border bg-[#0B0D10] p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted uppercase">
                  <Command className="h-3 w-3" />
                  Terminal
                </div>
                <div className="font-mono text-[11px] leading-[17px]">
                  <div className="text-[#7C6CFF]">$ npm run build</div>
                  <div className="text-[#4B5261]">&gt; tsc -p tsconfig.json</div>
                  <div className="text-danger">
                    src/auth.ts(11,25): error TS2532:
                  </div>
                  <div className="text-danger">
                    &nbsp;&nbsp;Object is possibly &apos;undefined&apos;.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-text">
          Not a video. An actual replay.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[14px] text-muted">
          The session is stored as an event log and reconstructed in the
          browser, so every replay is frame-accurate, seekable and scrubbable.
        </p>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-surface p-6">
              <feature.icon className="h-5 w-5 text-accent" />
              <h3 className="mt-3 text-[14px] font-medium text-text">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-text">
            How it works
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Record',
                body: 'A recorder watches the working tree and the agent’s tool calls, turning real file mutations, shell commands and build results into a canonical event stream.',
              },
              {
                step: '02',
                title: 'Store',
                body: 'Events are appended to an immutable log in Postgres. The session is fully described by that log — no rendered artefacts, no lost history.',
              },
              {
                step: '03',
                title: 'Replay',
                body: 'The browser folds the log back into state at 60fps, animating typing, cursor movement, terminal output and the mistakes along the way.',
              },
            ].map((item) => (
              <div key={item.step}>
                <div className="font-mono text-[11px] text-accent">{item.step}</div>
                <h3 className="mt-2 text-[15px] font-medium text-text">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- integrations */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-text">
          Every agent, one format
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[14px] text-muted">
          Adapters normalise each agent’s native output into the same canonical
          event stream, so a session recorded with one agent replays exactly
          like any other.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {AGENTS.map((agent) => (
            <span
              key={agent}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-muted"
            >
              {agent}
            </span>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- cta */}
      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-text">
            See an agent work
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-muted">
            The demo session includes a failing build, a type error and the fix
            that makes the tests pass.
          </p>
          <Link
            href="/demo"
            className="mt-8 inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Play className="h-4 w-4" />
            Play the demo session
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-[12px] text-faint sm:flex-row">
          <span>CodeCinema — replays of real AI coding sessions.</span>
          <span className="font-mono">event sourcing · deterministic replay · 60fps</span>
        </div>
      </footer>
    </main>
  );
}

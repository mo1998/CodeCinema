import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'CodeCinema — watch AI code being written',
    template: '%s · CodeCinema',
  },
  description:
    'CodeCinema records how AI coding agents actually work — every keystroke, command, mistake and fix — and replays it like a senior engineer working live in VS Code.',
  applicationName: 'CodeCinema',
  keywords: [
    'AI coding agent',
    'code replay',
    'agent observability',
    'VS Code',
    'developer tool',
  ],
  openGraph: {
    title: 'CodeCinema — watch AI code being written',
    description:
      'High-fidelity replays of AI coding sessions: real edits, real commands, real mistakes and real fixes.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

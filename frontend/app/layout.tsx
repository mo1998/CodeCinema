import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';

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
      <body className="min-h-screen antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-sm focus:text-text"
        >
          Skip to content
        </a>
        <I18nProvider>
          <div id="main-content">{children}</div>
        </I18nProvider>
      </body>
    </html>
  );
}
